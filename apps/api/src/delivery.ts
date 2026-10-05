import { randomUUID } from 'node:crypto';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { env } from './config.js';
import { rows, execute, transaction } from './db.js';
import { EMAIL_SELECT, type EmailRow, type Sender } from './models.js';
import { reserveSend, releaseSend } from './rate-limit.js';
import { classifySmtpFailure, sendEmail } from './mailer.js';
import { addOutbox } from './scheduler.js';
import { publishChange } from './queue.js';

async function updateEmail(
  id: string,
  userId: string,
  status: string,
  error: string | null = null,
  nextAt?: Date,
) {
  await transaction(async (conn) => {
    await execute(
      'UPDATE emails SET status = ?, error_message = ?, revision = revision + 1, scheduled_at = COALESCE(?, scheduled_at) WHERE id = ?',
      [status, error, nextAt ?? null, id],
      conn,
    );
    await addOutbox(conn, 'index', userId, id);
  });
  await publishChange(userId);
}
async function delayJob(job: Job, at: number, token?: string): Promise<never> {
  await job.moveToDelayed(Math.max(Date.now() + 50, at), token);
  throw new DelayedError();
}
export async function processDelivery(
  job: Job<{ emailId: string; generation: number }>,
  token?: string,
) {
  const [email] = await rows<EmailRow>(`${EMAIL_SELECT} WHERE e.id = ?`, [job.data.emailId]);
  if (
    !email ||
    email.generation !== job.data.generation ||
    ['sent', 'failed', 'delivery_unknown', 'cancelled'].includes(email.status)
  )
    return;
  if (email.status === 'sending') {
    const leaseEnd = (email.send_started_at?.getTime() ?? 0) + env.SEND_LEASE_MS;
    if (Date.now() < leaseEnd) return delayJob(job, leaseEnd, token);
    await updateEmail(
      email.id,
      email.user_id,
      'delivery_unknown',
      'Worker stopped during SMTP delivery. Automatic resend prevented; check the Ethereal inbox.',
    );
    return;
  }
  if (email.scheduled_at.getTime() > Date.now() + 50)
    return delayJob(job, email.scheduled_at.getTime(), token);
  const [sender] = await rows<Sender>('SELECT * FROM senders WHERE id = ?', [email.sender_id]);
  if (!sender) throw new UnrecoverableError('Sender missing');
  const cap = Math.min(email.hourly_limit, sender.hourly_limit, env.MAX_EMAILS_PER_HOUR_PER_SENDER);
  const delayMs = Math.max(email.delay_ms, env.MIN_SEND_DELAY_MS);
  const leaseToken = randomUUID();
  const quota = await reserveSend(sender.id, cap, delayMs, leaseToken);
  if (quota.hitLimit) {
    await transaction(async (conn) => {
      const connected = await rows(
        'SELECT user_id FROM slack_connections WHERE user_id = ?',
        [email.user_id],
        conn,
      );
      if (connected.length)
        await addOutbox(
          conn,
          'slack',
          email.user_id,
          null,
          { senderEmail: sender.email, limit: cap, hour: quota.hour },
          `limit-${sender.id}-${quota.hour}`,
        );
    });
  }
  if (!quota.allowed) {
    // Small delays keep parallel contention cheap; hourly exhaustion moves jobs into the next fixed UTC window.
    const retryAt = quota.hitLimit
      ? quota.retryAt + (email.sequence_number % cap) * delayMs
      : quota.retryAt;
    if (
      quota.hitLimit &&
      (email.status !== 'deferred' || Math.abs(email.scheduled_at.getTime() - retryAt) > 50)
    )
      await updateEmail(email.id, email.user_id, 'deferred', null, new Date(retryAt));
    return delayJob(job, retryAt, token);
  }
  try {
    const claimed = await transaction(async (conn) => {
      const result = await execute(
        `UPDATE emails SET status = 'sending', send_started_at = UTC_TIMESTAMP(3), attempts = attempts + 1,
        error_message = NULL, revision = revision + 1 WHERE id = ? AND generation = ? AND status IN ('scheduled','deferred')`,
        [email.id, email.generation],
        conn,
      );
      if (result.affectedRows) await addOutbox(conn, 'index', email.user_id, email.id);
      return result.affectedRows === 1;
    });
    if (!claimed) return;
    await publishChange(email.user_id);
    let result: { messageId: string; previewUrl: string | null };
    try {
      result = await sendEmail(email, sender);
    } catch (error) {
      const classification = classifySmtpFailure(error);
      if (classification === 'uncertain') {
        await updateEmail(
          email.id,
          email.user_id,
          'delivery_unknown',
          'SMTP connection ended without a definitive delivery result. Automatic resend prevented.',
        );
        throw new UnrecoverableError('SMTP delivery outcome uncertain');
      }
      const final = classification === 'permanent' || job.attemptsMade + 1 >= env.MAX_SEND_ATTEMPTS;
      const message =
        classification === 'permanent'
          ? 'SMTP rejected the message or sender credentials. Check sender settings.'
          : 'SMTP could not connect. A retry is pending.';
      await updateEmail(
        email.id,
        email.user_id,
        final ? 'failed' : 'scheduled',
        final ? message.replace('A retry is pending.', 'Retry attempts exhausted.') : message,
        final ? undefined : new Date(Date.now() + 5000 * 2 ** job.attemptsMade),
      );
      if (final) throw new UnrecoverableError(message);
      throw new Error('Transient SMTP failure');
    }
    // Never re-send if this commit fails: the durable 'sending' state becomes delivery_unknown on recovery.
    await transaction(async (conn) => {
      await execute(
        `UPDATE emails SET status = 'sent', sent_at = UTC_TIMESTAMP(3), message_id = ?, preview_url = ?,
        error_message = NULL, revision = revision + 1 WHERE id = ? AND status = 'sending'`,
        [result.messageId, result.previewUrl, email.id],
        conn,
      );
      await addOutbox(conn, 'index', email.user_id, email.id);
    });
    await publishChange(email.user_id);
  } finally {
    await releaseSend(sender.id, leaseToken, delayMs);
  }
}

export async function recoverUncertainDeliveries() {
  const stale = await rows<EmailRow>(
    `SELECT * FROM emails WHERE status = 'sending' AND send_started_at < ?`,
    [new Date(Date.now() - env.SEND_LEASE_MS)],
  );
  for (const email of stale)
    await updateEmail(
      email.id,
      email.user_id,
      'delivery_unknown',
      'Delivery was interrupted during a previous worker session. Automatic resend prevented.',
    );
}
