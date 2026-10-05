import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { env } from './config.js';
import { logger } from './logger.js';
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
redis.on('error', (error) => logger.error({ err: error }, 'Redis connection error'));
export const QUEUE_NAME = 'email-delivery';
export const emailQueue = new Queue<{ emailId: string; generation: number }>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.MAX_SEND_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 7 * 86400, count: 100000 },
    removeOnFail: { age: 30 * 86400 },
  },
});
export const publishChange = (userId: string) =>
  redis.publish('reachinbox:changes', JSON.stringify({ userId }));
