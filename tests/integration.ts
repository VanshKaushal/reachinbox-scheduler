import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = parse(await readFile(new URL('../.env', import.meta.url), 'utf8'));
const dbUrl = new URL(process.env.TEST_DATABASE_URL || local.DATABASE_URL!);
dbUrl.pathname = '/reachinbox_test';
const redisUrl = new URL(process.env.TEST_REDIS_URL || local.REDIS_URL!);
redisUrl.pathname = '/2';
const runId = randomUUID().slice(0, 8);
const testEnv = {
  ...process.env,
  ...local,
  NODE_ENV: 'test',
  DEMO_MODE: 'true',
  PORT: '4100',
  APP_URL: 'http://localhost:5174',
  API_URL: 'http://localhost:4100',
  DATABASE_URL: dbUrl.href,
  REDIS_URL: redisUrl.href,
  ELASTICSEARCH_INDEX: `reachinbox-integration-${runId}`,
  MIN_SEND_DELAY_MS: '100',
  MAX_EMAILS_PER_HOUR_PER_SENDER: '5',
  OUTBOX_POLL_MS: '100',
  GOOGLE_CLIENT_ID: 'integration-client',
  GOOGLE_CLIENT_SECRET: 'integration-secret',
  SLACK_CLIENT_ID: 'integration-client',
  SLACK_CLIENT_SECRET: 'integration-secret',
};
Object.assign(process.env, testEnv);
const { db, rows, execute } = await import('../apps/api/src/db');
const { redis, emailQueue } = await import('../apps/api/src/queue');
const { elastic } = await import('../apps/api/src/search');
const { reserveSend, releaseSend } = await import('../apps/api/src/rate-limit');
const { encrypt } = await import('../apps/api/src/crypto');
const children: ChildProcess[] = [];
const evidence: { name: string; result: string; detail?: unknown }[] = [];
const log: string[] = [];
function check(name: string, detail?: unknown) {
  evidence.push({ name, result: 'PASS', detail });
  console.log(`PASS ${name}`);
}
function child(file: string, args: string[] = []) {
  const proc = spawn(process.execPath, [...args, file], {
    cwd: root,
    env: { ...testEnv, TEST_SLACK_SINK: 'http://127.0.0.1:4101/' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (chunk) => log.push(chunk.toString()));
  proc.stderr?.on('data', (chunk) => log.push(chunk.toString()));
  children.push(proc);
  return proc;
}
async function stop(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exit = once(proc, 'exit');
  proc.kill('SIGKILL');
  await exit;
}
async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(
    `Condition timed out after ${timeout}ms${lastError ? ` (${(lastError as Error).message})` : ''}`,
  );
}
let cookie = '',
  csrf = '';
async function request(
  path: string,
  options: RequestInit = {},
  sessionCookie = cookie,
  token = csrf,
) {
  const response = await fetch(`http://127.0.0.1:4100/api${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      Cookie: sessionCookie,
      'X-CSRF-Token': token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const setCookie = response.headers.getSetCookie()[0];
  if (setCookie && sessionCookie === cookie) cookie = setCookie.split(';')[0]!;
  const data = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : null;
  return { response, data };
}
const notifications: { text: string }[] = [];
const sink = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    notifications.push(JSON.parse(body));
    res.writeHead(200);
    res.end('ok');
  });
});
await new Promise<void>((resolve) => sink.listen(4101, '127.0.0.1', resolve));
let failure: unknown;
try {
  assert.equal(dbUrl.pathname, '/reachinbox_test');
  const migration = child('apps/api/dist/scripts/migrate.js');
  const [code] = await once(migration, 'exit');
  assert.equal(code, 0, 'Migration failed; create the isolated reachinbox_test database first.');
  let apiProcess = child('apps/api/dist/server.js');
  await waitFor(async () => {
    const { response, data } = await request('/health');
    return response.ok && data.status === 'healthy';
  });
  check('Isolated MySQL / Redis / Elasticsearch services are healthy');

  assert.equal((await request('/emails')).response.status, 401);
  const login = await request('/auth/demo', { method: 'POST' });
  assert.equal(login.response.status, 200);
  csrf = login.data.csrfToken;
  const userId = login.data.user.id;
  assert.equal(
    (await request('/campaigns', { method: 'POST', body: '{}' }, cookie, 'wrong-token')).response
      .status,
    403,
  );
  check('Authentication and CSRF protection reject unauthorized writes');

  const google = await request('/auth/google');
  assert.equal(google.response.status, 302);
  const authorize = new URL(google.response.headers.get('location')!);
  assert.equal(authorize.hostname, 'accounts.google.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('nonce'));
  const rejectedGoogle = await request('/auth/google/callback?code=invalid&state=invalid');
  assert.ok(rejectedGoogle.response.headers.get('location')?.includes('google_failed'));
  const slackRedirect = await request('/integrations/slack/connect');
  assert.equal(new URL(slackRedirect.response.headers.get('location')!).hostname, 'slack.com');
  const rejectedSlack = await request('/integrations/slack/callback?code=invalid&state=invalid');
  assert.ok(rejectedSlack.response.headers.get('location')?.includes('slack_failed'));
  check(
    'Real OAuth authorization URLs, Google PKCE/nonce, and callback state rejection',
    'Full account consent flows need real OAuth app credentials.',
  );

  let workers = [
    child('apps/api/dist/worker.js', ['--import', './tests/fixtures/slack-transport.mjs']),
    child('apps/api/dist/worker.js', ['--import', './tests/fixtures/slack-transport.mjs']),
  ];
  await waitFor(async () => (await emailQueue.getWorkers()).length >= 2);
  const makeSender = async (name: string) => {
    const result = await request('/senders/ethereal', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    assert.equal(result.response.status, 201, result.data?.error);
    return result.data as { id: string; email: string };
  };
  const sender = await makeSender(`Restart proof ${runId}`),
    sender2 = await makeSender(`Throttle proof ${runId}`);
  assert.notEqual(sender.email, sender2.email);
  check('Two distinct real Ethereal SMTP sender accounts created');

  const future = new Date(Date.now() + 12000).toISOString();
  const subject = `Restart-proof conversation ${runId}`;
  const payload = {
    senderId: sender.id,
    subject,
    body: `Persistent payload needle-${runId}`,
    recipients: [
      `first-${runId}@example.com`,
      `second-${runId}@example.com`,
      `FIRST-${runId}@example.com`,
    ],
    startAt: future,
    delaySeconds: 0.1,
    hourlyLimit: 5,
  };
  const key = randomUUID();
  const schedule = () =>
    request('/campaigns', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
  const repeated = await Promise.all([schedule(), schedule()]);
  assert.deepEqual(repeated.map((r) => r.response.status).sort(), [200, 201]);
  assert.equal(repeated[0]!.data.id, repeated[1]!.data.id);
  assert.equal(repeated[0]!.data.recipientCount, 2);
  const campaignId = repeated[0]!.data.id;
  const conflicting = await request('/campaigns', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ ...payload, subject: 'Different request' }),
  });
  assert.equal(conflicting.response.status, 409);
  const saved = await rows<{ id: string; scheduled_at: Date; attempts: number }>(
    'SELECT id, scheduled_at, attempts FROM emails WHERE campaign_id = ? ORDER BY sequence_number',
    [campaignId],
  );
  assert.equal(saved.length, 2);
  assert.equal(saved[1]!.scheduled_at.getTime() - saved[0]!.scheduled_at.getTime(), 100);
  check(
    'Concurrent API idempotency, recipient deduplication, and exact delayed schedule persisted',
  );
  await waitFor(async () =>
    (await emailQueue.getJob(`${saved[0]!.id}-0`))?.getState().then((state) => state === 'delayed'),
  );
  assert.ok(Date.now() < new Date(future).getTime());
  await Promise.all(workers.map(stop));
  await stop(apiProcess);
  await sleep(Math.max(0, new Date(future).getTime() - Date.now() + 150));
  const unsent = await rows<{ status: string }>('SELECT status FROM emails WHERE campaign_id = ?', [
    campaignId,
  ]);
  assert.ok(unsent.every((e) => e.status === 'scheduled'));
  workers = [
    child('apps/api/dist/worker.js', ['--import', './tests/fixtures/slack-transport.mjs']),
    child('apps/api/dist/worker.js', ['--import', './tests/fixtures/slack-transport.mjs']),
  ];
  apiProcess = child('apps/api/dist/server.js');
  await waitFor(async () => (await request('/health')).response.ok);
  assert.equal(
    (await request('/auth/me')).response.status,
    200,
    'Redis-backed login must survive an API restart',
  );
  const delivered = await waitFor(async () => {
    const records = await rows<{
      id: string;
      status: string;
      sent_at: Date | null;
      send_started_at: Date;
      attempts: number;
      preview_url: string | null;
    }>(
      'SELECT id, status, sent_at, send_started_at, attempts, preview_url FROM emails WHERE campaign_id = ? ORDER BY sequence_number',
      [campaignId],
    );
    if (records.some((e) => ['failed', 'delivery_unknown'].includes(e.status)))
      throw new Error(`SMTP failed: ${records.map((e) => e.status).join(',')}`);
    return records.length === 2 && records.every((e) => e.status === 'sent') ? records : undefined;
  });
  assert.ok(
    delivered.every(
      (e) => e.attempts === 1 && e.preview_url?.startsWith('https://ethereal.email/message/'),
    ),
  );
  const actualOrder = [...delivered].sort(
    (a, b) => a.send_started_at.getTime() - b.send_started_at.getTime(),
  );
  const actualGap = actualOrder[1]!.send_started_at.getTime() - actualOrder[0]!.sent_at!.getTime();
  assert.ok(actualGap >= 90, `Sender cooldown was violated: ${actualGap}ms`);
  check(
    'Abrupt API/worker restart retains sessions and delayed jobs; sends once via real Ethereal SMTP',
    { recipients: 2, workers: 2, attemptsEach: 1, minimumGapMs: actualGap },
  );
  await emailQueue.add(
    'send-email',
    { emailId: saved[0]!.id, generation: 0 },
    { jobId: `replay-proof-${runId}` },
  );
  await waitFor(async () =>
    (await emailQueue.getJob(`replay-proof-${runId}`))
      ?.getState()
      .then((state) => state === 'completed'),
  );
  assert.equal(
    (
      await rows<{ attempts: number }>('SELECT attempts FROM emails WHERE id = ?', [saved[0]!.id])
    )[0]!.attempts,
    1,
  );
  check('Replayed completed delivery cannot resend an email');

  await waitFor(async () => {
    const result = await request(`/emails?view=sent&q=needle-${runId}`);
    return result.response.ok && result.data.total === 2;
  });
  check('Scheduled/sent message content is searchable via actual Elasticsearch indexing');

  const quotaId = randomUUID();
  let granted = 0;
  await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      for (let n = 0; n < 12; n++) {
        const token = `${i}-${n}`;
        const reservation = await reserveSend(quotaId, 5, 0, token);
        if (reservation.allowed) {
          granted++;
          await releaseSend(quotaId, token, 0);
        }
        await sleep(5);
      }
    }),
  );
  assert.equal(granted, 5);
  const denied = await reserveSend(quotaId, 5, 0, 'overflow');
  assert.equal(denied.allowed, false);
  assert.equal(denied.count, 5);
  assert.ok(denied.retryAt > Date.now());
  check('Atomic Redis quota cannot overshoot under 144 parallel reservation attempts', {
    allocated: granted,
    limit: 5,
  });

  await execute(
    `INSERT INTO slack_connections (user_id, team_id, team_name, channel_name, webhook_secret, bot_secret) VALUES (?, 'TEST', 'Test fixture', '#test', ?, ?)
    ON DUPLICATE KEY UPDATE webhook_secret = VALUES(webhook_secret), bot_secret = VALUES(bot_secret)`,
    [
      userId,
      encrypt('https://hooks.slack.com/services/TEST/FIXTURE/ONLY'),
      encrypt('test-only-token'),
    ],
  );
  const throttle = await request('/campaigns', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      ...payload,
      senderId: sender2.id,
      subject: `Throttle ${runId}`,
      recipients: [`a-${runId}@example.com`, `b-${runId}@example.com`, `c-${runId}@example.com`],
      startAt: new Date(Date.now() + 1000).toISOString(),
      hourlyLimit: 2,
    }),
  });
  assert.equal(throttle.response.status, 201);
  const throttled = await waitFor(async () => {
    const state = await rows<{
      id: string;
      generation: number;
      status: string;
      scheduled_at: Date;
    }>('SELECT id, generation, status, scheduled_at FROM emails WHERE campaign_id = ?', [
      throttle.data.id,
    ]);
    return state.filter((e) => e.status === 'sent').length === 2 &&
      state.filter((e) => e.status === 'deferred').length === 1
      ? state
      : undefined;
  });
  const deferred = throttled.find((e) => e.status === 'deferred')!;
  assert.equal(deferred.scheduled_at.getUTCHours(), new Date(Date.now() + 3600000).getUTCHours());
  // Repeated exhaustion must keep the displayed SQL schedule aligned with the actual delayed job.
  const deferredJob = await emailQueue.getJob(`${deferred.id}-${deferred.generation}`);
  assert.ok(deferredJob);
  await waitFor(async () => (await deferredJob.getState()) === 'delayed');
  await execute('UPDATE emails SET scheduled_at = ? WHERE id = ?', [
    new Date(Date.now() - 1000),
    deferred.id,
  ]);
  await deferredJob.changeDelay(0);
  await waitFor(async () => {
    const [record] = await rows<{ scheduled_at: Date }>(
      'SELECT scheduled_at FROM emails WHERE id = ?',
      [deferred.id],
    );
    return record && record.scheduled_at.getTime() > Date.now() + 1000;
  });
  await waitFor(async () => notifications.length === 1);
  assert.ok(notifications[0]!.text.includes(sender2.email));
  await sleep(1500);
  assert.equal(notifications.length, 1);
  check('Two workers enforce sender cap; overflow remains delayed for the next UTC hour', {
    sent: 2,
    deferred: 1,
    repeatedDeferralScheduleUpdated: true,
  });
  check(
    'Rate-limit notification transport is delivered and deduplicated',
    'Local HTTP fixture only. This is not evidence of a live Slack installation.',
  );
  await request('/integrations/slack', { method: 'DELETE' });
  assert.equal((await request('/integrations/slack')).data.connected, false);
  check('Slack disconnect updates persisted connection state without a redeploy');

  const secondUser = randomUUID(),
    secondSession = randomBytes(24).toString('hex');
  await execute('INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)', [
    secondUser,
    `fixture-${runId}`,
    `tenant-${runId}@example.com`,
    'Tenant isolation fixture',
  ]);
  await redis.set(
    `reach:session:${secondSession}`,
    JSON.stringify({
      cookie: {
        originalMaxAge: 3600000,
        expires: new Date(Date.now() + 3600000).toISOString(),
        secure: false,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      },
      user: {
        id: secondUser,
        name: 'Tenant isolation fixture',
        email: `tenant-${runId}@example.com`,
        avatar: null,
      },
      csrf: 'test-csrf',
    }),
    'EX',
    3600,
  );
  const signature = createHmac('sha256', testEnv.SESSION_SECRET!)
    .update(secondSession)
    .digest('base64')
    .replace(/=+$/, '');
  const tenantCookie = `reachinbox.sid=${encodeURIComponent(`s:${secondSession}.${signature}`)}`;
  const otherList = await request('/emails?view=sent', {}, tenantCookie, 'test-csrf');
  assert.equal(otherList.response.status, 200);
  assert.equal(otherList.data.total, 0);
  assert.equal(
    (await request(`/emails/${saved[0]!.id}`, {}, tenantCookie, 'test-csrf')).response.status,
    404,
  );
  assert.equal((await request('/queue', {}, tenantCookie, 'test-csrf')).response.status, 403);
  const otherSearch = await request(
    `/emails?view=sent&q=needle-${runId}`,
    {},
    tenantCookie,
    'test-csrf',
  );
  assert.equal(otherSearch.data.total, 0);
  check(
    'Tenant isolation protects SQL views, Elasticsearch search, details, and queue diagnostics',
  );

  const bulkStart = Date.now();
  const bulk = await request('/campaigns', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      ...payload,
      subject: `Bulk persistence ${runId}`,
      recipients: Array.from({ length: 1001 }, (_, i) => `lead-${runId}-${i}@example.com`),
      startAt: new Date(Date.now() + 5400000).toISOString(),
    }),
  });
  assert.equal(bulk.response.status, 201);
  const [bulkCount] = await rows<{ n: number }>(
    'SELECT COUNT(*) AS n FROM emails WHERE campaign_id = ?',
    [bulk.data.id],
  );
  assert.equal(bulkCount!.n, 1001);
  check('1001-recipient campaign commits complete email records and durable outbox work', {
    recipients: 1001,
    apiDurationMs: Date.now() - bulkStart,
  });
  await execute(
    "UPDATE emails SET status = 'cancelled', revision = revision + 1 WHERE campaign_id IN (?, ?) AND status IN ('scheduled','deferred')",
    [bulk.data.id, throttle.data.id],
  );
  const cancel = await request('/campaigns', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      ...payload,
      recipients: [`cancel-${runId}@example.com`],
      startAt: new Date(Date.now() + 60000).toISOString(),
    }),
  });
  assert.equal(cancel.response.status, 201);
  const [toCancel] = await rows<{ id: string }>('SELECT id FROM emails WHERE campaign_id = ?', [
    cancel.data.id,
  ]);
  assert.equal(
    (await request(`/emails/${toCancel!.id}`, { method: 'DELETE' })).response.status,
    204,
  );
  assert.equal((await request(`/emails/${toCancel!.id}`)).data.status, 'cancelled');
  assert.equal(
    (await request(`/emails/${saved[0]!.id}/retry`, { method: 'POST' })).response.status,
    409,
  );
  check('Cancellation is durable and delivered messages cannot be manually retried');
  await redis.del(`reach:session:${secondSession}`);
} catch (error) {
  failure = error;
  console.error((error as Error).stack);
} finally {
  await Promise.all(children.map(stop));
  await new Promise<void>((resolve) => sink.close(() => resolve()));
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../artifacts/integration-report.json', import.meta.url),
    JSON.stringify(
      {
        runId,
        timestamp: new Date().toISOString(),
        status: failure ? 'FAIL' : 'PASS',
        evidence,
        caveats: [
          'Google and Slack full OAuth consent flows require real credentials.',
          'Slack message transport uses a local test fixture; real SMTP and Elasticsearch are exercised.',
        ],
        failure: failure ? (failure as Error).message : null,
      },
      null,
      2,
    ),
  );
  await writeFile(new URL('../artifacts/integration-processes.log', import.meta.url), log.join(''));
  await emailQueue.close();
  await redis.quit();
  await db.end();
  await elastic.close();
}
if (failure) process.exitCode = 1;
else
  console.log(
    `All ${evidence.length} integration checks passed. Evidence: artifacts/integration-report.json`,
  );
