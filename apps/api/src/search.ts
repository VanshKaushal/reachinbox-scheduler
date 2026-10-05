import { Client } from '@elastic/elasticsearch';
import { env } from './config.js';
import { rows } from './db.js';
import { EMAIL_SELECT, type EmailRow } from './models.js';
export const elastic = new Client({ node: env.ELASTICSEARCH_URL, requestTimeout: 10000 });
export async function ensureIndex() {
  if (!(await elastic.indices.exists({ index: env.ELASTICSEARCH_INDEX }))) {
    await elastic.indices.create({
      index: env.ELASTICSEARCH_INDEX,
      mappings: {
        properties: {
          userId: { type: 'keyword' },
          status: { type: 'keyword' },
          recipient: { type: 'text', fields: { raw: { type: 'keyword' } } },
          subject: { type: 'text' },
          body: { type: 'text' },
          senderEmail: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          createdAt: { type: 'date' },
          sentAt: { type: 'date' },
        },
      },
    });
  }
}
export async function indexEmail(emailId: string) {
  const [row] = await rows<EmailRow>(`${EMAIL_SELECT} WHERE e.id = ?`, [emailId]);
  if (!row) return;
  try {
    await elastic.index({
      index: env.ELASTICSEARCH_INDEX,
      id: row.id,
      version: row.revision,
      version_type: 'external_gte',
      document: {
        userId: row.user_id,
        status: row.status,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        senderEmail: row.sender_email,
        scheduledAt: row.scheduled_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        sentAt: row.sent_at?.toISOString() ?? null,
      },
    });
  } catch (error) {
    // A newer revision winning an index race is success, not lost data.
    if ((error as { statusCode?: number }).statusCode !== 409) throw error;
  }
}
export async function searchEmails(
  userId: string,
  statuses: string[],
  q: string,
  page: number,
  pageSize: number,
) {
  const escaped = q.toLowerCase().replace(/[\\*?]/g, '\\$&');
  const result = await elastic.search({
    index: env.ELASTICSEARCH_INDEX,
    from: (page - 1) * pageSize,
    size: pageSize,
    track_total_hits: true,
    query: {
      bool: {
        filter: [{ term: { userId } }, { terms: { status: statuses } }],
        minimum_should_match: 1,
        should: [
          {
            multi_match: {
              query: q,
              fields: ['recipient^3', 'subject^2', 'body'],
              type: 'phrase_prefix',
            },
          },
          { wildcard: { 'recipient.raw': { value: `*${escaped}*`, case_insensitive: true } } },
        ],
      },
    },
    sort: [{ createdAt: 'desc' }],
    _source: false,
  });
  const total =
    typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
  return { ids: result.hits.hits.map((hit) => hit._id!), total };
}
