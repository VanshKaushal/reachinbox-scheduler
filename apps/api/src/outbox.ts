import { setTimeout as sleep } from 'node:timers/promises';
import { env } from './config.js';
import { execute, rows, transaction } from './db.js';
import { emailQueue, publishChange } from './queue.js';
import { indexEmail } from './search.js';
import { decrypt } from './crypto.js';
import { logger } from './logger.js';
import type { EmailRow } from './models.js';

interface Event {
  id: number;
  kind: 'enqueue' | 'index' | 'slack';
  user_id: string;
  email_id: string | null;
  payload: Record<string, unknown> | string;
  attempts: number;
}
async function dispatch(event: Event) {
  const payload =
    typeof event.payload === 'string'
      ? (JSON.parse(event.payload) as Record<string, unknown>)
      : event.payload;
  if (event.kind === 'enqueue') {
    const [email] = await rows<EmailRow>('SELECT * FROM emails WHERE id = ?', [event.email_id]);
    if (email && ['scheduled', 'deferred'].includes(email.status)) {
      await emailQueue.add(
        'send-email',
        { emailId: email.id, generation: email.generation },
        {
          jobId: `${email.id}-${email.generation}`,
          delay: Math.max(0, email.scheduled_at.getTime() - Date.now()),
        },
      );
    }
  } else if (event.kind === 'index') {
    await indexEmail(event.email_id!);
  } else {
    const [connection] = await rows<{ webhook_secret: string; channel_name: string }>(
      'SELECT webhook_secret, channel_name FROM slack_connections WHERE user_id = ?',
      [event.user_id],
    );
    // Disconnected users never cause email delivery to fail. Connection is read live.
    if (connection) {
      const webhook = decrypt(connection.webhook_secret);
      const url = new URL(webhook);
      if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com')
        throw new Error('Invalid Slack webhook host');
      const reset = new Date((Number(payload.hour) + 1) * 3600000);
      const text = `📬 ReachInbox · Hourly limit reached\n${String(payload.senderEmail)} has allocated all ${Number(payload.limit)} email slots for this UTC hour.\nRemaining emails are safely queued and will resume after ${reset.toISOString()}. No jobs were dropped.`;
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Slack notification failed (HTTP ${response.status})`);
    }
  }
  await execute(
    'UPDATE outbox SET delivered_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?',
    [event.id],
  );
  await publishChange(event.user_id);
}

export function startOutboxRelay() {
  let stopping = false;
  const done = (async () => {
    while (!stopping) {
      try {
        // A committed lease makes crashed relay work reclaimable. SKIP LOCKED permits several relay instances.
        const events = await transaction(async (conn) => {
          const batch = await rows<Event>(
            `SELECT * FROM outbox WHERE delivered_at IS NULL AND available_at <= UTC_TIMESTAMP(3)
            ORDER BY FIELD(kind, 'slack', 'enqueue', 'index'), id LIMIT 32 FOR UPDATE SKIP LOCKED`,
            [],
            conn,
          );
          if (batch.length)
            await execute(
              `UPDATE outbox SET available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 SECOND), attempts = attempts + 1 WHERE id IN (${batch.map(() => '?').join(',')})`,
              batch.map((e) => e.id),
              conn,
            );
          return batch;
        });
        if (!events.length) {
          await sleep(env.OUTBOX_POLL_MS);
          continue;
        }
        await Promise.all(
          events.map(async (event) => {
            try {
              await dispatch(event);
            } catch (error) {
              const waitMs = Math.min(60000, 1000 * 2 ** Math.min(event.attempts, 6));
              // Never store credential-bearing exception messages in the database.
              await execute('UPDATE outbox SET available_at = ?, last_error = ? WHERE id = ?', [
                new Date(Date.now() + waitMs),
                `${event.kind} dispatch failed; retry pending`,
                event.id,
              ]);
              logger.warn(
                { outboxId: event.id, kind: event.kind, errorType: (error as Error).name },
                'Outbox dispatch will retry',
              );
            }
          }),
        );
      } catch (error) {
        logger.error({ err: error }, 'Outbox relay temporarily unavailable');
        await sleep(2000);
      }
    }
  })();
  return {
    async stop() {
      stopping = true;
      await done;
    },
  };
}

export async function reconcileQueue() {
  let cursor = '';
  while (true) {
    const batch = await rows<EmailRow>(
      `SELECT * FROM emails WHERE status IN ('scheduled','deferred') AND id > ? ORDER BY id LIMIT 500`,
      [cursor],
    );
    if (!batch.length) break;
    await emailQueue.addBulk(
      batch.map((e) => ({
        name: 'send-email',
        data: { emailId: e.id, generation: e.generation },
        opts: {
          jobId: `${e.id}-${e.generation}`,
          delay: Math.max(0, e.scheduled_at.getTime() - Date.now()),
        },
      })),
    );
    cursor = batch.at(-1)!.id;
  }
}
