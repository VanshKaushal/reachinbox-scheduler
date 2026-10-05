import type { Express, Response } from 'express';
import { redis } from './queue.js';
import { requireAuth } from './auth.js';
import { logger } from './logger.js';

export async function attachEvents(app: Express) {
  const subscriber = redis.duplicate();
  const clients = new Map<string, Set<Response>>();
  await subscriber.subscribe('reachinbox:changes');
  subscriber.on('message', (_channel, message) => {
    try {
      const { userId } = JSON.parse(message) as { userId: string };
      for (const response of clients.get(userId) ?? [])
        response.write('event: change\ndata: {}\n\n');
    } catch {
      logger.warn('Invalid change event ignored');
    }
  });
  app.get('/api/events', requireAuth, (req, res) => {
    const userId = req.session.user!.id;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('event: ready\ndata: {}\n\n');
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(res);
    // Transport heartbeat only; email scheduling never uses a timer/cron.
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.get(userId)?.delete(res);
      if (!clients.get(userId)?.size) clients.delete(userId);
    });
  });
  return async () => {
    for (const group of clients.values()) for (const res of group) res.end();
    await subscriber.quit();
  };
}
