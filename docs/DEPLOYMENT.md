# Deploying the complete system

The repository has a portable Docker image and Compose infrastructure. A deployment also needs an account-owned host, persistent services, HTTPS and configured OAuth applications. A successful local test is not a claim that public hosting has been provisioned.

## Service roles

| Service        | Start command                            | Responsibility                                                         |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| API / frontend | `node apps/api/dist/server.js`           | OAuth, sessions, typed API, SSE, built React app, protected Bull Board |
| Worker         | `node apps/api/dist/worker.js`           | Durable outbox relay, startup reconciliation, concurrent delivery      |
| Migration      | `node apps/api/dist/scripts/migrate.js`  | Apply versioned schema once before starting/scaling services           |
| MySQL          | Managed MySQL 8+ or persistent container | Source of truth; foreign keys and indexes                              |
| Redis          | Managed Redis 7+ or persistent container | BullMQ, sessions, shared quotas and sender leases                      |
| Elasticsearch  | Elasticsearch 8.x                        | Email search; persistent volume or managed cluster                     |

## Configuration

1. Build the Dockerfile with the committed package lock. Run migrations against the production SQL database.
2. Use an HTTPS reverse proxy terminating TLS, forwarding cookies, and keeping `/api/events` unbuffered. The API trusts one proxy hop; adjust deliberately if your topology differs.
3. Set `NODE_ENV=production`, `DEMO_MODE=false`, and strong randomly generated `SESSION_SECRET` / `ENCRYPTION_KEY`. Production refuses demo mode and missing Google credentials.
4. Set `APP_URL` and `API_URL` to the actual HTTPS origin (one origin is simplest). Register exact Google and Slack callback URLs for that origin. Local callback registrations do not authorize a hosted URL.
5. Use private network connectivity to SQL, Redis and Elasticsearch. Do not expose the local development Elasticsearch configuration to the Internet. Managed Elasticsearch URLs may include TLS/authentication credentials; store them in server environment secrets.
6. Set `QUEUE_ADMIN_EMAILS` to approved reviewers/admins only. Queue data is global; the read-only dashboard is intentionally restricted. Ordinary tenant APIs and search always filter ownership.
7. Give both API and worker the same database, Redis, encryption key, Elasticsearch index and sender limit configuration. Scale worker processes independently.
8. Persist Redis AOF with `noeviction`. Back up SQL. Keep durable volumes through updates.
9. Check `/api/health`, real Google login, live Slack connection/message, future scheduling through a restart, and actual Ethereal previews on the hosted deployment.
10. Verify that logout destroys the session, cookies are Secure/HttpOnly, and the demo endpoint is absent in production.

## Operational notes

- SIGTERM drains active worker jobs; an abrupt stop during SMTP is treated conservatively as an uncertain delivery.
- Search outages do not halt sends. The SQL outbox keeps retrying index writes.
- Polling inside the outbox relay is a transport/reconciliation loop. It never replaces BullMQ delayed email jobs or uses a cron library.
- BullMQ may depend transitively on a cron parser for other features. This application never creates repeatable/cron jobs.
- Notification delivery is at-least-once when a Slack HTTP request succeeds but its SQL acknowledgment cannot commit. The sender/hour outbox dedupe prevents creating duplicate events, but Slack incoming webhooks have no transactional acknowledgment protocol. A rare network/commit failure can produce a duplicate alert; it does not duplicate the email.
- Fixed-hour quotas are not rolling windows, and SMTP acceptance is not recipient inbox delivery. This project intentionally uses a sandbox provider.
