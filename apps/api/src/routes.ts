import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from './config.js';
import { rows, execute, transaction } from './db.js';
import { encrypt } from './crypto.js';
import { requireAuth, requireCsrf, isQueueAdmin } from './auth.js';
import { HttpError } from './errors.js';
import { EMAIL_SELECT, type EmailRow, publicEmail, type Sender } from './models.js';
import { addOutbox, scheduleCampaign } from './scheduler.js';
import { senderSchema } from './validation.js';
import { searchEmails } from './search.js';
import { senderUsage } from './rate-limit.js';
import { publishChange, emailQueue } from './queue.js';
import { transporterFor } from './mailer.js';
import { createEtherealAccount } from './ethereal.js';

export const apiRouter = Router();
apiRouter.use(requireAuth);
apiRouter.get('/overview', async (req, res) => {
  const userId = req.session.user!.id;
  const [totals] = await rows<{
    total: number;
    scheduled: number;
    sent: number;
    sentToday: number;
    failed: number;
    uncertain: number;
    cancelled: number;
  }>(
    `SELECT
    COUNT(*) AS total,
    COALESCE(SUM(status IN ('scheduled','deferred','sending')), 0) AS scheduled,
    COALESCE(SUM(status = 'sent'), 0) AS sent,
    COALESCE(SUM(status = 'sent' AND sent_at >= UTC_DATE()), 0) AS sentToday,
    COALESCE(SUM(status = 'failed'), 0) AS failed,
    COALESCE(SUM(status = 'delivery_unknown'), 0) AS uncertain,
    COALESCE(SUM(status = 'cancelled'), 0) AS cancelled FROM emails WHERE user_id = ?`,
    [userId],
  );
  const activity = await rows<EmailRow>(
    `${EMAIL_SELECT} WHERE e.user_id = ? ORDER BY e.updated_at DESC LIMIT 8`,
    [userId],
  );
  const [outbox] = await rows<{ pending: number }>(
    'SELECT COUNT(*) AS pending FROM outbox WHERE user_id = ? AND delivered_at IS NULL',
    [userId],
  );
  const workers = await emailQueue.getWorkers();
  const numericTotals = Object.fromEntries(
    Object.entries(totals || {}).map(([key, value]) => [key, Number(value)]),
  );
  res.json({
    ...numericTotals,
    activity: activity.map(publicEmail),
    pendingSync: outbox?.pending ?? 0,
    workerOnline: workers.length > 0,
    timezone: 'UTC',
    minDelayMs: env.MIN_SEND_DELAY_MS,
    hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  });
});
apiRouter.get('/emails', async (req, res) => {
  const query = z
    .object({
      view: z.enum(['scheduled', 'sent']).default('scheduled'),
      q: z.string().trim().max(200).default(''),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(15),
      status: z
        .enum([
          'all',
          'scheduled',
          'deferred',
          'sending',
          'sent',
          'failed',
          'delivery_unknown',
          'cancelled',
        ])
        .default('all'),
    })
    .parse(req.query);
  const userId = req.session.user!.id;
  let statuses =
    query.view === 'scheduled'
      ? ['scheduled', 'deferred', 'sending']
      : ['sent', 'failed', 'delivery_unknown', 'cancelled'];
  if (query.status !== 'all') statuses = statuses.includes(query.status) ? [query.status] : [];
  if (!statuses.length)
    return res.json({
      data: [],
      total: 0,
      page: query.page,
      pageSize: query.pageSize,
      searchEngine: query.q ? 'elasticsearch' : null,
    });
  let data: EmailRow[], total: number;
  if (query.q) {
    try {
      const result = await searchEmails(userId, statuses, query.q, query.page, query.pageSize);
      total = result.total;
      data = result.ids.length
        ? await rows<EmailRow>(
            `${EMAIL_SELECT} WHERE e.user_id = ? AND e.id IN (${result.ids.map(() => '?').join(',')}) AND e.status IN (${statuses.map(() => '?').join(',')})`,
            [userId, ...result.ids, ...statuses],
          )
        : [];
      data.sort((a, b) => result.ids.indexOf(a.id) - result.ids.indexOf(b.id));
    } catch {
      throw new HttpError(
        503,
        'Search is temporarily unavailable. Clear the search to browse emails; indexing will recover automatically.',
      );
    }
  } else {
    const placeholders = statuses.map(() => '?').join(',');
    const [count] = await rows<{ total: number }>(
      `SELECT COUNT(*) AS total FROM emails WHERE user_id = ? AND status IN (${placeholders})`,
      [userId, ...statuses],
    );
    total = count?.total ?? 0;
    const order =
      query.view === 'scheduled'
        ? 'e.scheduled_at ASC, e.sequence_number ASC, e.id'
        : 'e.updated_at DESC, e.id';
    data = await rows<EmailRow>(
      `${EMAIL_SELECT} WHERE e.user_id = ? AND e.status IN (${placeholders}) ORDER BY ${order} LIMIT ? OFFSET ?`,
      [userId, ...statuses, query.pageSize, (query.page - 1) * query.pageSize],
    );
  }
  res.json({
    data: data.map(publicEmail),
    total,
    page: query.page,
    pageSize: query.pageSize,
    searchEngine: query.q ? 'elasticsearch' : null,
  });
});
apiRouter.get('/emails/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const [email] = await rows<EmailRow>(`${EMAIL_SELECT} WHERE e.id = ? AND e.user_id = ?`, [
    id,
    req.session.user!.id,
  ]);
  if (!email) throw new HttpError(404, 'Email not found.');
  res.json(publicEmail(email));
});
apiRouter.post('/campaigns', requireCsrf, async (req, res) => {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string') throw new HttpError(400, 'Provide an Idempotency-Key header.');
  const result = await scheduleCampaign(req.session.user!.id, req.body, key);
  await publishChange(req.session.user!.id);
  res.status(result.replayed ? 200 : 201).json(result);
});
apiRouter.delete('/emails/:id', requireCsrf, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id),
    userId = req.session.user!.id;
  const changed = await transaction(async (conn) => {
    const result = await execute(
      "UPDATE emails SET status = 'cancelled', revision = revision + 1 WHERE id = ? AND user_id = ? AND status IN ('scheduled','deferred')",
      [id, userId],
      conn,
    );
    if (result.affectedRows) await addOutbox(conn, 'index', userId, id);
    return result.affectedRows;
  });
  if (!changed) throw new HttpError(409, 'Only scheduled or rate-limited emails can be cancelled.');
  await publishChange(userId);
  res.status(204).end();
});
apiRouter.post('/emails/:id/retry', requireCsrf, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id),
    userId = req.session.user!.id;
  await transaction(async (conn) => {
    const result = await execute(
      `UPDATE emails SET status = 'scheduled', scheduled_at = UTC_TIMESTAMP(3), error_message = NULL,
      generation = generation + 1, revision = revision + 1 WHERE id = ? AND user_id = ? AND status = 'failed'`,
      [id, userId],
      conn,
    );
    if (!result.affectedRows)
      throw new HttpError(409, 'Only messages with a confirmed failure can be retried.');
    await addOutbox(conn, 'enqueue', userId, id);
    await addOutbox(conn, 'index', userId, id);
  });
  await publishChange(userId);
  res.json({ message: 'Email queued for retry.' });
});
apiRouter.get('/senders', async (req, res) => {
  const senders = await rows<Sender>(
    'SELECT * FROM senders WHERE user_id = ? ORDER BY created_at',
    [req.session.user!.id],
  );
  const data = await Promise.all(
    senders.map(async (s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      hourlyLimit: s.hourly_limit,
      createdAt: s.created_at.toISOString(),
      ...(await senderUsage(s.id)),
    })),
  );
  res.json({ data, maxHourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER });
});
apiRouter.post('/senders/ethereal', requireCsrf, async (req, res) => {
  const { name } = z
    .object({ name: z.string().trim().min(1).max(100).default('Outreach team') })
    .parse(req.body);
  const [count] = await rows<{ n: number }>('SELECT COUNT(*) AS n FROM senders WHERE user_id = ?', [
    req.session.user!.id,
  ]);
  if ((count?.n ?? 0) >= 10)
    throw new HttpError(400, 'This workspace already has ten test senders.');
  let account: Awaited<ReturnType<typeof createEtherealAccount>>;
  try {
    account = await createEtherealAccount();
  } catch {
    throw new HttpError(
      502,
      'Ethereal could not create an account. Try again, or add existing Ethereal credentials.',
    );
  }
  const id = randomUUID();
  await execute(
    'INSERT INTO senders (id, user_id, name, email, smtp_secret, hourly_limit) VALUES (?, ?, ?, ?, ?, ?)',
    [
      id,
      req.session.user!.id,
      name,
      account.user,
      encrypt(account.pass),
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    ],
  );
  res
    .status(201)
    .json({ id, name, email: account.user, hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER });
});
apiRouter.post('/senders', requireCsrf, async (req, res) => {
  const input = senderSchema.parse(req.body),
    id = randomUUID();
  const secret = encrypt(input.password);
  const transport = transporterFor({
    smtp_host: 'smtp.ethereal.email',
    smtp_port: 587,
    email: input.email,
    smtp_secret: secret,
  });
  try {
    await transport.verify();
  } catch {
    throw new HttpError(400, 'Could not verify these Ethereal SMTP credentials.');
  } finally {
    transport.close();
  }
  const cap = Math.min(
    input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  );
  const [existing] = await rows('SELECT id FROM senders WHERE user_id = ? AND email = ?', [
    req.session.user!.id,
    input.email,
  ]);
  if (existing)
    throw new HttpError(409, 'This Ethereal account is already connected to your workspace.');
  await execute(
    'INSERT INTO senders (id, user_id, name, email, smtp_secret, hourly_limit) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.session.user!.id, input.name, input.email, secret, cap],
  );
  res.status(201).json({ id, name: input.name, email: input.email, hourlyLimit: cap });
});
apiRouter.get('/notifications', async (req, res) => {
  const events = await rows<{
    id: number;
    payload: Record<string, unknown> | string;
    delivered_at: Date | null;
    last_error: string | null;
    created_at: Date;
  }>(
    "SELECT id, payload, delivered_at, last_error, created_at FROM outbox WHERE kind = 'slack' AND user_id = ? ORDER BY id DESC LIMIT 10",
    [req.session.user!.id],
  );
  res.json({
    data: events.map((e) => ({
      id: e.id,
      details: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      delivered: Boolean(e.delivered_at),
      error: e.last_error,
      createdAt: e.created_at.toISOString(),
    })),
  });
});
apiRouter.get('/queue', async (req, res) => {
  if (!isQueueAdmin(req.session.user!))
    throw new HttpError(403, 'Queue diagnostics are available to workspace administrators.');
  res.json({
    counts: await emailQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    workers: (await emailQueue.getWorkers()).length,
  });
});
