import { Worker } from 'bullmq';
import { env } from './config.js';
import { db } from './db.js';
import { redis, emailQueue, QUEUE_NAME } from './queue.js';
import { ensureIndex, elastic } from './search.js';
import { startOutboxRelay, reconcileQueue } from './outbox.js';
import { processDelivery, recoverUncertainDeliveries } from './delivery.js';
import { logger } from './logger.js';

await db.query('SELECT 1');
await redis.ping();
try {
  await ensureIndex();
} catch {
  logger.warn('Elasticsearch unavailable; indexing will retry without blocking delivery');
}
await recoverUncertainDeliveries();
await reconcileQueue();
const relay = startOutboxRelay();
const worker = new Worker(QUEUE_NAME, processDelivery, {
  connection: redis,
  concurrency: env.WORKER_CONCURRENCY,
  lockDuration: 120000,
  maxStalledCount: 2,
});
worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Delivery job completed'));
worker.on('failed', (job, error) =>
  logger.warn({ jobId: job?.id, message: error.message }, 'Delivery job failed'),
);
worker.on('error', (error) => logger.error({ err: error }, 'Worker error'));
logger.info(
  {
    concurrency: env.WORKER_CONCURRENCY,
    minDelayMs: env.MIN_SEND_DELAY_MS,
    hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
  },
  'Email worker ready',
);
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Draining worker');
  await worker.close();
  await relay.stop();
  await emailQueue.close();
  await redis.quit();
  await db.end();
  await elastic.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
