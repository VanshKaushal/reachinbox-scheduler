import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const integer = (value: number, min = 1, max = 1_000_000) =>
  z.coerce.number().int().min(min).max(max).default(value);
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: integer(4000, 1, 65535),
    APP_URL: z.string().url().default('http://localhost:5173'),
    API_URL: z.string().url().default('http://localhost:4000'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    ELASTICSEARCH_URL: z.string().url(),
    ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails'),
    SESSION_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    SLACK_CLIENT_ID: z.string().default(''),
    SLACK_CLIENT_SECRET: z.string().default(''),
    WORKER_CONCURRENCY: integer(8, 1, 100),
    MIN_SEND_DELAY_MS: integer(2000, 0, 3_600_000),
    MAX_EMAILS_PER_HOUR_PER_SENDER: integer(200, 1, 100_000),
    SMTP_TIMEOUT_MS: integer(25000, 1000, 120000),
    SEND_LEASE_MS: integer(60000, 5000, 300000),
    MAX_SEND_ATTEMPTS: integer(4, 1, 10),
    OUTBOX_POLL_MS: integer(500, 50, 10000),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    QUEUE_ADMIN_EMAILS: z.string().default(''),
  })
  .superRefine((v, ctx) => {
    if (v.SEND_LEASE_MS < v.SMTP_TIMEOUT_MS + 10000)
      ctx.addIssue({
        code: 'custom',
        message: 'SEND_LEASE_MS must exceed SMTP_TIMEOUT_MS by at least 10000ms',
      });
    if (v.NODE_ENV === 'production' && v.DEMO_MODE)
      ctx.addIssue({ code: 'custom', message: 'DEMO_MODE is forbidden in production' });
    if (v.NODE_ENV === 'production' && (!v.GOOGLE_CLIENT_ID || !v.GOOGLE_CLIENT_SECRET))
      ctx.addIssue({ code: 'custom', message: 'Production requires Google OAuth credentials' });
  });
export const env = schema.parse(process.env);
export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const slackConfigured = Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
