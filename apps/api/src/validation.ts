import { z } from 'zod';
export const scheduleSchema = z.object({
  senderId: z.string().uuid(),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((s) => !/[\r\n]/.test(s), 'Subject must be a single line'),
  body: z.string().trim().min(1).max(100000),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(10000),
  startAt: z.string().datetime({ offset: true }),
  delaySeconds: z.number().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(100000),
});
export const senderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email().max(254),
  password: z.string().min(1).max(1000),
  hourlyLimit: z.number().int().min(1).max(100000).optional(),
});
export function canonicalSchedule(input: z.infer<typeof scheduleSchema>) {
  return {
    ...input,
    recipients: [...new Set(input.recipients)].sort(),
    startAt: new Date(input.startAt).toISOString(),
  };
}
