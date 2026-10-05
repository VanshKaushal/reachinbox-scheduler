import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { env, slackConfigured } from './config.js';
import { requireAuth, requireCsrf } from './auth.js';
import { decrypt, encrypt, safeEqual } from './crypto.js';
import { rows, execute } from './db.js';
import { HttpError } from './errors.js';

export const slackRouter = Router();
slackRouter.use(requireAuth);
slackRouter.get('/', async (req, res) => {
  const [connection] = await rows<{ team_name: string; channel_name: string; connected_at: Date }>(
    'SELECT team_name, channel_name, connected_at FROM slack_connections WHERE user_id = ?',
    [req.session.user!.id],
  );
  res.json({
    configured: slackConfigured,
    connected: Boolean(connection),
    connection: connection
      ? {
          teamName: connection.team_name,
          channelName: connection.channel_name,
          connectedAt: connection.connected_at.toISOString(),
        }
      : null,
  });
});
slackRouter.get('/connect', async (req, res) => {
  if (!slackConfigured)
    throw new HttpError(503, 'Set up a Slack OAuth app first. See the setup guide.');
  const state = randomBytes(32).toString('hex');
  req.session.slack = { state, createdAt: Date.now() };
  await new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
  const query = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: 'incoming-webhook',
    state,
    redirect_uri: `${env.API_URL}/api/integrations/slack/callback`,
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${query}`);
});
slackRouter.get('/callback', async (req, res) => {
  const pending = req.session.slack;
  delete req.session.slack;
  try {
    if (
      !pending ||
      !safeEqual(pending.state, req.query.state) ||
      Date.now() - pending.createdAt > 600000 ||
      typeof req.query.code !== 'string'
    )
      throw new Error('Invalid OAuth state');
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code: req.query.code,
        redirect_uri: `${env.API_URL}/api/integrations/slack/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = (await response.json()) as {
      ok: boolean;
      access_token: string;
      team: { id: string; name: string };
      incoming_webhook?: { url: string; channel: string };
    };
    if (!result.ok || !result.incoming_webhook?.url || !result.access_token || !result.team?.id)
      throw new Error('Slack installation did not return a webhook');
    const webhook = new URL(result.incoming_webhook.url);
    if (webhook.protocol !== 'https:' || webhook.hostname !== 'hooks.slack.com')
      throw new Error('Invalid webhook');
    await execute(
      `INSERT INTO slack_connections (user_id, team_id, team_name, channel_name, webhook_secret, bot_secret)
      VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE team_id = VALUES(team_id), team_name = VALUES(team_name),
      channel_name = VALUES(channel_name), webhook_secret = VALUES(webhook_secret), bot_secret = VALUES(bot_secret), connected_at = UTC_TIMESTAMP(3)`,
      [
        req.session.user!.id,
        result.team.id,
        result.team.name,
        result.incoming_webhook.channel,
        encrypt(result.incoming_webhook.url),
        encrypt(result.access_token),
      ],
    );
    res.redirect(`${env.APP_URL}/?slack=connected`);
  } catch {
    res.redirect(`${env.APP_URL}/?error=slack_failed`);
  }
});
slackRouter.delete('/', requireCsrf, async (req, res) => {
  const [connection] = await rows<{ bot_secret: string }>(
    'SELECT bot_secret FROM slack_connections WHERE user_id = ?',
    [req.session.user!.id],
  );
  await execute('DELETE FROM slack_connections WHERE user_id = ?', [req.session.user!.id]);
  if (connection) {
    // Local disconnection is immediate, even if Slack's revocation endpoint is temporarily down.
    try {
      await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${decrypt(connection.bot_secret)}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* no further notifications */
    }
  }
  res.status(204).end();
});
