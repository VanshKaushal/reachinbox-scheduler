import { z } from 'zod';
const accountSchema = z.object({
  status: z.literal('success'),
  user: z.string().email(),
  pass: z.string().min(1),
  smtp: z.object({
    host: z.literal('smtp.ethereal.email'),
    port: z.literal(587),
    secure: z.literal(false),
  }),
});
export async function createEtherealAccount() {
  // createTestAccount caches accounts by default. A direct official API call creates a distinct identity every time.
  const response = await fetch('https://api.nodemailer.com/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestor: 'reachinbox-scheduler', version: '1.0.0' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Ethereal account service unavailable (HTTP ${response.status})`);
  return accountSchema.parse(await response.json());
}
