export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}
export interface Session {
  user: User;
  csrfToken: string;
  queueAdmin: boolean;
}
export type Status =
  | 'scheduled'
  | 'deferred'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'delivery_unknown'
  | 'cancelled';
export interface Email {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: Status;
  senderId: string;
  senderName: string;
  senderEmail: string;
  scheduledAt: string;
  originalScheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}
export interface Sender {
  id: string;
  name: string;
  email: string;
  hourlyLimit: number;
  used: number;
  resetAt: string;
  createdAt: string;
}
export interface SenderList {
  data: Sender[];
  maxHourlyLimit: number;
}
export interface EmailList {
  data: Email[];
  total: number;
  page: number;
  pageSize: number;
  searchEngine: string | null;
}
export interface Overview {
  total: number;
  scheduled: number;
  sent: number;
  sentToday: number;
  failed: number;
  uncertain: number;
  cancelled: number;
  activity: Email[];
  pendingSync: number;
  workerOnline: boolean;
  timezone: string;
  minDelayMs: number;
  hourlyLimit: number;
}
export interface AuthConfig {
  googleConfigured: boolean;
  slackConfigured: boolean;
  demoMode: boolean;
  environment: string;
}
export interface SlackConnection {
  configured: boolean;
  connected: boolean;
  connection: { teamName: string; channelName: string; connectedAt: string } | null;
}
export interface Health {
  status: string;
  dependencies: { database: boolean; redis: boolean; elasticsearch: boolean };
}
export interface Notification {
  id: number;
  details: { senderEmail: string; limit: number; hour: number };
  delivered: boolean;
  error: string | null;
  createdAt: string;
}
