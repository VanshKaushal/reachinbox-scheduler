export type EmailStatus =
  | 'scheduled'
  | 'deferred'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'delivery_unknown'
  | 'cancelled';
export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}
export interface Sender {
  id: string;
  user_id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secret: string;
  hourly_limit: number;
  created_at: Date;
}
export interface EmailRow {
  id: string;
  user_id: string;
  campaign_id: string;
  sender_id: string;
  recipient: string;
  sequence_number: number;
  status: EmailStatus;
  scheduled_at: Date;
  original_scheduled_at: Date;
  send_started_at: Date | null;
  sent_at: Date | null;
  message_id: string | null;
  preview_url: string | null;
  error_message: string | null;
  attempts: number;
  generation: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
  subject: string;
  body: string;
  delay_ms: number;
  hourly_limit: number;
  sender_name: string;
  sender_email: string;
}
export const EMAIL_SELECT = `SELECT e.*, c.subject, c.body, c.delay_ms, c.hourly_limit,
  s.name AS sender_name, s.email AS sender_email FROM emails e
  JOIN campaigns c ON e.campaign_id = c.id JOIN senders s ON e.sender_id = s.id`;
export function publicEmail(row: EmailRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    scheduledAt: row.scheduled_at.toISOString(),
    originalScheduledAt: row.original_scheduled_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null,
    previewUrl: row.preview_url,
    error: row.error_message,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
