import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env, googleConfigured, slackConfigured } from './config.js';
import { db } from './db.js';
import { redis, emailQueue } from './queue.js';
import { elastic } from './search.js';
import { authRouter, isQueueAdmin, requireAuth } from './auth.js';
import { slackRouter } from './slack.js';
import { apiRouter } from './routes.js';
import { attachEvents } from './events.js';
import { logger } from './logger.js';
import { HttpError } from './errors.js';
import { openapi } from './openapi.js';
import swaggerUi from 'swagger-ui-express';

const app = express();
app.disable('x-powered-by');
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ origin: new URL(env.APP_URL).origin, credentials: true }));
app.use(express.json({ limit: '3mb' }));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/events') === true },
  }),
);
const sessionRedis = createClient({ url: env.REDIS_URL });
sessionRedis.on('error', (error) => logger.error({ err: error }, 'Session Redis error'));
await sessionRedis.connect();
app.use(
  session({
    name: 'reachinbox.sid',
    store: new RedisStore({ client: sessionRedis, prefix: 'reach:session:' }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 86400000,
    },
  }),
);
app.get('/api/health', async (_req, res) => {
  const results = await Promise.allSettled([db.query('SELECT 1'), redis.ping(), elastic.ping()]);
  const dependencies = {
    database: results[0]!.status === 'fulfilled',
    redis: results[1]!.status === 'fulfilled',
    elasticsearch: results[2]!.status === 'fulfilled',
  };
  const healthy = dependencies.database && dependencies.redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? (dependencies.elasticsearch ? 'healthy' : 'degraded') : 'unavailable',
    dependencies,
  });
});
app.get('/api/auth/config', (_req, res) =>
  res.json({
    googleConfigured,
    slackConfigured,
    demoMode: env.DEMO_MODE,
    environment: env.NODE_ENV,
  }),
);
app.get('/api/openapi.json', (_req, res) => res.json(openapi));
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: 'ReachInbox · API documentation',
    swaggerOptions: { persistAuthorization: false },
  }),
);
app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.session.user?.id || ipKeyGenerator(req.ip || '127.0.0.1'),
    message: { error: 'Too many requests. Please wait a moment.' },
  }),
);
app.use('/api/auth', authRouter);
app.use('/api/integrations/slack', slackRouter);
const closeEvents = await attachEvents(app);
app.use('/api', apiRouter);
const board = new ExpressAdapter();
board.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(emailQueue, { readOnlyMode: true })],
  serverAdapter: board,
  options: { uiConfig: { boardTitle: 'ReachInbox · Delivery Queue' } },
});
app.use(
  '/admin/queues',
  requireAuth,
  (req, _res, next) =>
    isQueueAdmin(req.session.user!)
      ? next()
      : next(new HttpError(403, 'Queue administrator access required.')),
  board.getRouter(),
);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API endpoint not found.')));
const frontend = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(frontend)) {
  app.use(express.static(frontend, { maxAge: env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.get('/{*path}', (_req, res) => res.sendFile(`${frontend}/index.html`));
}
const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if ((error as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  logger.error({ requestId: req.id, errorType: (error as Error).name }, 'Request failed');
  res.status(500).json({ error: 'Something went wrong. Please try again.', requestId: req.id });
};
app.use(errorHandler);
const server = app.listen(env.PORT, '0.0.0.0', () =>
  logger.info(
    { port: env.PORT, googleConfigured, slackConfigured, demoMode: env.DEMO_MODE },
    'API ready',
  ),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await closeEvents();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await sessionRedis.quit();
  await emailQueue.close();
  await redis.quit();
  await db.end();
  await elastic.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
