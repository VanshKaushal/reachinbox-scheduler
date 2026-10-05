import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from './config.js';
import { rows, execute, transaction, type Connection } from './db.js';
import { HttpError } from './errors.js';
import { scheduleSchema } from './validation.js';
import type { Sender } from './models.js';

export async function addOutbox(
  conn: Connection,
  kind: 'enqueue' | 'index' | 'slack',
  userId: string,
  emailId: string | null,
  payload: object = {},
  dedupeKey: string | null = null,
) {
  await execute(
    'INSERT IGNORE INTO outbox (kind, user_id, email_id, payload, dedupe_key) VALUES (?, ?, ?, ?, ?)',
    [kind, userId, emailId, JSON.stringify(payload), dedupeKey],
    conn,
  );
}
export async function scheduleCampaign(userId: string, raw: unknown, key: string) {
  const input = scheduleSchema.parse(raw);
  const recipients = [...new Set(input.recipients)];
  const normalized = { ...input, recipients, startAt: new Date(input.startAt).toISOString() };
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  z.string()
    .min(8)
    .max(128)
    .regex(/^[\w-]+$/)
    .parse(key);
  return transaction(async (conn) => {
    // Serializing on the user's row also handles concurrent identical idempotency keys.
    await rows('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId], conn);
    const [existing] = await rows<{ id: string; request_hash: string; recipient_count: number }>(
      'SELECT id, request_hash, recipient_count FROM campaigns WHERE user_id = ? AND idempotency_key = ?',
      [userId, key],
      conn,
    );
    if (existing) {
      if (existing.request_hash !== hash)
        throw new HttpError(409, 'This idempotency key was already used for a different request.');
      return { id: existing.id, recipientCount: existing.recipient_count, replayed: true };
    }
    const [sender] = await rows<Sender>(
      'SELECT * FROM senders WHERE id = ? AND user_id = ?',
      [input.senderId, userId],
      conn,
    );
    if (!sender) throw new HttpError(404, 'Sender not found.');
    const start = new Date(input.startAt);
    if (start.getTime() < Date.now() - 5000)
      throw new HttpError(400, 'Choose a start time in the future.');
    if (start.getTime() > Date.now() + 365 * 86400000)
      throw new HttpError(400, 'Schedule within the next year.');
    const delayMs = Math.max(env.MIN_SEND_DELAY_MS, Math.round(input.delaySeconds * 1000));
    const limit = Math.min(
      input.hourlyLimit,
      sender.hourly_limit,
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );
    const id = randomUUID();
    await execute(
      `INSERT INTO campaigns (id, user_id, sender_id, subject, body, start_at, delay_ms, hourly_limit, recipient_count, idempotency_key, request_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        sender.id,
        input.subject,
        input.body,
        start,
        delayMs,
        limit,
        recipients.length,
        key,
        hash,
      ],
      conn,
    );
    for (let offset = 0; offset < recipients.length; offset += 500) {
      const chunk = recipients.slice(offset, offset + 500).map((recipient, index) => {
        const emailId = randomUUID();
        const scheduledAt = new Date(start.getTime() + (offset + index) * delayMs);
        return { emailId, recipient, sequence: offset + index, scheduledAt };
      });
      await execute(
        `INSERT INTO emails (id, user_id, campaign_id, sender_id, recipient, sequence_number, scheduled_at, original_scheduled_at)
        VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',')}`,
        chunk.flatMap((e) => [
          e.emailId,
          userId,
          id,
          sender.id,
          e.recipient,
          e.sequence,
          e.scheduledAt,
          e.scheduledAt,
        ]),
        conn,
      );
      const events = chunk.flatMap((e) => [
        ['enqueue', userId, e.emailId, '{}', `enqueue-${e.emailId}-0`],
        ['index', userId, e.emailId, '{}', null],
      ]);
      await execute(
        `INSERT INTO outbox (kind, user_id, email_id, payload, dedupe_key) VALUES ${events.map(() => '(?, ?, ?, ?, ?)').join(',')}`,
        events.flat(),
        conn,
      );
    }
    return {
      id,
      recipientCount: recipients.length,
      replayed: false,
      effectiveDelayMs: delayMs,
      effectiveHourlyLimit: limit,
    };
  });
}
