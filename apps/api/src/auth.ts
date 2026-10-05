import { Router, type RequestHandler, type Request } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, randomUUID } from 'node:crypto';
import { env, googleConfigured } from './config.js';
import { rows, execute } from './db.js';
import { safeEqual } from './crypto.js';
import { HttpError } from './errors.js';
import type { User } from './models.js';
import type {} from 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: User;
    csrf?: string;
    google?: { state: string; nonce: string; verifier: string; createdAt: number };
    slack?: { state: string; createdAt: number };
  }
}
export function isQueueAdmin(user: User) {
  return (
    (env.DEMO_MODE && user.email === 'demo@reachinbox.local') ||
    env.QUEUE_ADMIN_EMAILS.split(',')
      .map((v) => v.trim().toLowerCase())
      .includes(user.email.toLowerCase())
  );
}
export const requireAuth: RequestHandler = (req, _res, next) =>
  req.session.user ? next() : next(new HttpError(401, 'Please sign in to continue.'));
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (!safeEqual(req.headers['x-csrf-token'], req.session.csrf))
    return next(new HttpError(403, 'Session verification failed. Refresh and try again.'));
  if (req.headers.origin && req.headers.origin !== new URL(env.APP_URL).origin)
    return next(new HttpError(403, 'Request origin is not allowed.'));
  next();
};
export async function establishSession(req: Request, user: User) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.user = user;
  req.session.csrf = randomBytes(32).toString('hex');
  await new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
}
const google = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  `${env.API_URL}/api/auth/google/callback`,
);
export const authRouter = Router();
authRouter.get('/google', async (req, res) => {
  if (!googleConfigured)
    throw new HttpError(503, 'Google sign-in needs OAuth credentials. See the setup guide.');
  const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
  const state = randomBytes(32).toString('hex'),
    nonce = randomBytes(32).toString('hex');
  req.session.google = { state, nonce, verifier: codeVerifier, createdAt: Date.now() };
  await new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
  const url = google.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as import('google-auth-library').CodeChallengeMethod,
    prompt: 'select_account',
  });
  res.redirect(url);
});
authRouter.get('/google/callback', async (req, res) => {
  const pending = req.session.google;
  delete req.session.google;
  try {
    if (
      !pending ||
      !safeEqual(pending.state, req.query.state) ||
      Date.now() - pending.createdAt > 600000 ||
      typeof req.query.code !== 'string'
    )
      throw new Error('Invalid OAuth state');
    const { tokens } = await google.getToken({
      code: req.query.code,
      codeVerifier: pending.verifier,
    });
    if (!tokens.id_token) throw new Error('Google did not return an identity token');
    const ticket = await google.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const profile = ticket.getPayload();
    if (
      !profile?.sub ||
      !profile.email ||
      !profile.email_verified ||
      profile.nonce !== pending.nonce
    )
      throw new Error('Identity verification failed');
    const [existing] = await rows<User>(
      'SELECT id, email, name, avatar FROM users WHERE google_sub = ?',
      [profile.sub],
    );
    const user: User = {
      id: existing?.id || randomUUID(),
      email: profile.email,
      name: profile.name || profile.email,
      avatar: profile.picture || null,
    };
    await execute(
      `INSERT INTO users (id, google_sub, email, name, avatar) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), avatar = VALUES(avatar)`,
      [user.id, profile.sub, user.email, user.name, user.avatar],
    );
    const [persisted] = await rows<User>(
      'SELECT id, email, name, avatar FROM users WHERE google_sub = ?',
      [profile.sub],
    );
    if (!persisted) throw new Error('User record missing');
    await establishSession(req, persisted);
    res.redirect(env.APP_URL);
  } catch {
    res.redirect(`${env.APP_URL}/?error=google_failed`);
  }
});
authRouter.get('/me', requireAuth, (req, res) =>
  res.json({
    user: req.session.user,
    csrfToken: req.session.csrf,
    queueAdmin: isQueueAdmin(req.session.user!),
  }),
);
authRouter.post('/demo', async (req, res) => {
  if (!env.DEMO_MODE || env.NODE_ENV === 'production') throw new HttpError(404, 'Not found.');
  if (req.headers.origin && req.headers.origin !== new URL(env.APP_URL).origin)
    throw new HttpError(403, 'Invalid origin.');
  const [existing] = await rows<User>(
    "SELECT id, email, name, avatar FROM users WHERE google_sub = 'local-demo'",
  );
  const user: User = existing || {
    id: randomUUID(),
    email: 'demo@reachinbox.local',
    name: 'Demo Workspace',
    avatar: null,
  };
  if (!existing)
    await execute(
      'INSERT IGNORE INTO users (id, google_sub, email, name, avatar) VALUES (?, ?, ?, ?, NULL)',
      [user.id, 'local-demo', user.email, user.name],
    );
  const [persisted] = await rows<User>(
    "SELECT id, email, name, avatar FROM users WHERE google_sub = 'local-demo'",
  );
  if (!persisted) throw new HttpError(500, 'Demo workspace unavailable.');
  await establishSession(req, persisted);
  res.json({ user: persisted, csrfToken: req.session.csrf, queueAdmin: true });
});
authRouter.post('/logout', requireAuth, requireCsrf, async (req, res) => {
  await new Promise<void>((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  res.clearCookie('reachinbox.sid', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });
  res.status(204).end();
});
