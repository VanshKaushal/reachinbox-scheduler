const json = (schema: object) => ({ 'application/json': { schema } });
const response = (description: string, schema?: object) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
});
const error = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] };
const protectedResponses = {
  401: response('Login required', error),
  403: response('CSRF, origin, or permission check failed', error),
};
const schedule = {
  type: 'object',
  required: ['senderId', 'subject', 'body', 'recipients', 'startAt', 'delaySeconds', 'hourlyLimit'],
  properties: {
    senderId: { type: 'string', format: 'uuid' },
    subject: { type: 'string', minLength: 1, maxLength: 300 },
    body: { type: 'string', minLength: 1, maxLength: 100000 },
    recipients: {
      type: 'array',
      minItems: 1,
      maxItems: 10000,
      items: { type: 'string', format: 'email' },
    },
    startAt: { type: 'string', format: 'date-time' },
    delaySeconds: { type: 'number', minimum: 0, maximum: 3600 },
    hourlyLimit: { type: 'integer', minimum: 1, maximum: 100000 },
  },
};
const id = { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } };
const readSecurity = [{ cookieAuth: [] }],
  writeSecurity = [{ cookieAuth: [], csrfToken: [] }];
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'ReachInbox Email Scheduler API',
    version: '1.0.0',
    description:
      'Persistent, tenant-scoped email scheduling. Sign in through /api/auth/google. Read the CSRF token from /api/auth/me and provide it on every mutation. Scheduling requires an Idempotency-Key. All timestamps use ISO 8601 with a timezone.',
  },
  servers: [{ url: '/', description: 'Current application origin' }],
  tags: ['Authentication', 'Emails', 'Senders', 'Integrations', 'Diagnostics'].map((name) => ({
    name,
  })),
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'reachinbox.sid',
        description: 'HttpOnly session issued after Google OAuth.',
      },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'Read csrfToken from /api/auth/me. Never bypass CSRF.',
      },
    },
    schemas: {
      ScheduleCampaign: schedule,
      Error: error,
      Email: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          campaignId: { type: 'string', format: 'uuid' },
          recipient: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          body: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'scheduled',
              'deferred',
              'sending',
              'sent',
              'failed',
              'delivery_unknown',
              'cancelled',
            ],
          },
          scheduledAt: { type: 'string', format: 'date-time' },
          originalScheduledAt: { type: 'string', format: 'date-time' },
          sentAt: { type: ['string', 'null'], format: 'date-time' },
          senderId: { type: 'string', format: 'uuid' },
          senderName: { type: 'string' },
          senderEmail: { type: 'string' },
          previewUrl: { type: ['string', 'null'] },
          error: { type: ['string', 'null'] },
          attempts: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Diagnostics'],
        summary: 'Service health (503 when SQL or Redis is unavailable)',
        responses: {
          200: response('Healthy, or degraded when search is unavailable'),
          503: response('Delivery dependencies unavailable'),
        },
      },
    },
    '/api/auth/config': {
      get: {
        tags: ['Authentication'],
        summary: 'OAuth availability; exposes no credentials',
        responses: { 200: response('Configuration flags') },
      },
    },
    '/api/auth/google': {
      get: {
        tags: ['Authentication'],
        summary: 'Start real Google OAuth with PKCE, state and nonce',
        responses: {
          302: response('Redirect to Google'),
          503: response('OAuth credentials not configured', error),
        },
      },
    },
    '/api/auth/google/callback': {
      get: {
        tags: ['Authentication'],
        summary: 'Verify Google code, token signature, audience, nonce and verified email',
        parameters: [
          { name: 'code', in: 'query', schema: { type: 'string' } },
          { name: 'state', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 302: response('Redirect to dashboard or login error') },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'],
        security: readSecurity,
        summary: 'Current user, CSRF token and queue permissions',
        responses: { 200: response('Session'), ...protectedResponses },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'],
        security: writeSecurity,
        summary: 'Destroy the persisted session',
        responses: { 204: response('Logged out'), ...protectedResponses },
      },
    },
    '/api/campaigns': {
      post: {
        tags: ['Emails'],
        security: writeSecurity,
        summary: 'Atomically save a campaign, recipients and durable queue/index outbox events',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 8, maxLength: 128 },
            description: 'Reuse the same key only for retries of the same request.',
          },
        ],
        requestBody: {
          required: true,
          content: json({ $ref: '#/components/schemas/ScheduleCampaign' }),
        },
        responses: {
          201: response('Campaign created'),
          200: response('Same campaign returned for idempotent replay'),
          400: response('Invalid input or past schedule', error),
          409: response('Key reused for different input', error),
          ...protectedResponses,
        },
      },
    },
    '/api/emails': {
      get: {
        tags: ['Emails'],
        security: readSecurity,
        summary: 'Paginated SQL view; q uses actual tenant-filtered Elasticsearch search',
        parameters: [
          {
            name: 'view',
            in: 'query',
            schema: { type: 'string', enum: ['scheduled', 'sent'], default: 'scheduled' },
          },
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 } },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
          },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: [
                'all',
                'scheduled',
                'deferred',
                'sending',
                'sent',
                'failed',
                'delivery_unknown',
                'cancelled',
              ],
              default: 'all',
            },
          },
        ],
        responses: {
          200: response('List', {
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/Email' } },
              total: { type: 'integer' },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              searchEngine: { type: ['string', 'null'] },
            },
          }),
          503: response('Elasticsearch temporarily unavailable', error),
          ...protectedResponses,
        },
      },
    },
    '/api/emails/{id}': {
      get: {
        tags: ['Emails'],
        security: readSecurity,
        summary: 'Email details scoped to the logged-in owner',
        parameters: [id],
        responses: {
          200: response('Email', { $ref: '#/components/schemas/Email' }),
          404: response('Not found', error),
          ...protectedResponses,
        },
      },
      delete: {
        tags: ['Emails'],
        security: writeSecurity,
        summary: 'Cancel a scheduled/deferred email with a guarded SQL state transition',
        parameters: [id],
        responses: {
          204: response('Cancelled'),
          409: response('Already sending or terminal; cannot cancel', error),
          ...protectedResponses,
        },
      },
    },
    '/api/emails/{id}/retry': {
      post: {
        tags: ['Emails'],
        security: writeSecurity,
        summary: 'Retry only a confirmed failure; sent/uncertain messages cannot be retried',
        parameters: [id],
        responses: {
          200: response('Requeued with a new delivery generation'),
          409: response('Not a confirmed failure', error),
          ...protectedResponses,
        },
      },
    },
    '/api/senders': {
      get: {
        tags: ['Senders'],
        security: readSecurity,
        summary: 'Sender identities and live Redis usage (never SMTP credentials)',
        responses: { 200: response('Senders'), ...protectedResponses },
      },
      post: {
        tags: ['Senders'],
        security: writeSecurity,
        summary: 'Verify and connect existing Ethereal credentials; provider host is fixed',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', maxLength: 100 },
              email: { type: 'string', format: 'email' },
              password: { type: 'string', format: 'password' },
              hourlyLimit: { type: 'integer', minimum: 1 },
            },
          }),
        },
        responses: {
          201: response('Sender connected; password encrypted'),
          400: response('SMTP verification failed', error),
          409: response('Sender already exists', error),
          ...protectedResponses,
        },
      },
    },
    '/api/senders/ethereal': {
      post: {
        tags: ['Senders'],
        security: writeSecurity,
        summary: 'Create a distinct real Ethereal account automatically',
        requestBody: {
          content: json({
            type: 'object',
            properties: { name: { type: 'string', maxLength: 100 } },
          }),
        },
        responses: {
          201: response('New sender'),
          502: response('Ethereal account creation unavailable', error),
          ...protectedResponses,
        },
      },
    },
    '/api/overview': {
      get: {
        tags: ['Diagnostics'],
        security: readSecurity,
        summary: 'Tenant metrics, recent activity, worker presence and pending synchronization',
        responses: { 200: response('Overview; sentToday uses UTC'), ...protectedResponses },
      },
    },
    '/api/events': {
      get: {
        tags: ['Diagnostics'],
        security: readSecurity,
        summary: 'Tenant-scoped server-sent change events; dashboard also polls',
        responses: {
          200: {
            description: 'Event stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          ...protectedResponses,
        },
      },
    },
    '/api/integrations/slack': {
      get: {
        tags: ['Integrations'],
        security: readSecurity,
        summary: 'Connection metadata without tokens or webhooks',
        responses: { 200: response('Slack connection'), ...protectedResponses },
      },
      delete: {
        tags: ['Integrations'],
        security: writeSecurity,
        summary: 'Disconnect immediately and attempt Slack token revocation',
        responses: { 204: response('Disconnected'), ...protectedResponses },
      },
    },
    '/api/integrations/slack/connect': {
      get: {
        tags: ['Integrations'],
        security: readSecurity,
        summary: 'Start real Slack OAuth with incoming-webhook scope and state',
        responses: {
          302: response('Redirect to Slack'),
          503: response('OAuth app not configured'),
          ...protectedResponses,
        },
      },
    },
    '/api/integrations/slack/callback': {
      get: {
        tags: ['Integrations'],
        security: readSecurity,
        summary: 'Verify state, exchange code and encrypt tenant webhook/token',
        responses: {
          302: response('Redirect to integration success or error'),
          ...protectedResponses,
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Integrations'],
        security: readSecurity,
        summary: 'Real notification outbox delivery status for the current tenant',
        responses: { 200: response('Notification history'), ...protectedResponses },
      },
    },
    '/api/queue': {
      get: {
        tags: ['Diagnostics'],
        security: readSecurity,
        summary: 'BullMQ counts and workers; requires administrator email allowlist',
        responses: { 200: response('Queue state'), ...protectedResponses },
      },
    },
  },
};
