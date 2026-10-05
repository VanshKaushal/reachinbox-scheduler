import nodemailer from 'nodemailer';
import { env } from './config.js';
import { decrypt } from './crypto.js';
import type { EmailRow, Sender } from './models.js';
import { createConnection, type Socket } from 'node:net';

export function transporterFor(
  sender: Pick<Sender, 'smtp_host' | 'smtp_port' | 'email' | 'smtp_secret'>,
  onSocket?: (socket: Socket) => void,
) {
  return nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: false,
    auth: { user: sender.email, pass: decrypt(sender.smtp_secret) },
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2', servername: sender.smtp_host },
    getSocket(_options, callback) {
      // Owning the raw socket lets the absolute deadline actually abort SMTP, including STARTTLS.
      const socket = createConnection({ host: sender.smtp_host, port: sender.smtp_port });
      onSocket?.(socket);
      const fail = (error: Error) => callback(error);
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        callback(null, { connection: socket });
      });
    },
    connectionTimeout: env.SMTP_TIMEOUT_MS,
    greetingTimeout: env.SMTP_TIMEOUT_MS,
    socketTimeout: env.SMTP_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function sendEmail(email: EmailRow, sender: Sender) {
  let socket: Socket | undefined;
  const transport = transporterFor(sender, (connected) => {
    socket = connected;
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const sending = transport.sendMail({
      from: { name: sender.name, address: sender.email },
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      messageId: `<${email.id}@scheduler.reachinbox.local>`,
      headers: { 'X-ReachInbox-Campaign': email.campaign_id },
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => {
        socket?.destroy();
        transport.close();
        reject(
          Object.assign(new Error('SMTP delivery deadline exceeded'), {
            code: 'ETIMEDOUT',
            command: 'TRANSACTION',
          }),
        );
      }, env.SMTP_TIMEOUT_MS);
    });
    const info = await Promise.race([sending, timeout]);
    const preview = nodemailer.getTestMessageUrl(info);
    return { messageId: info.messageId, previewUrl: preview || null };
  } finally {
    clearTimeout(deadline);
    socket?.destroy();
    transport.close();
  }
}
export function classifySmtpFailure(error: unknown): 'retryable' | 'permanent' | 'uncertain' {
  const e = error as { code?: string; responseCode?: number; command?: string };
  if (e.code === 'EAUTH' || e.code === 'EENVELOPE' || (e.responseCode && e.responseCode >= 500))
    return 'permanent';
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) return 'retryable';
  if (['ENOTFOUND', 'ECONNREFUSED', 'EDNS'].includes(e.code || '')) return 'retryable';
  if (e.command === 'CONN' && ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET'].includes(e.code || ''))
    return 'retryable';
  return 'uncertain';
}
