import { describe, expect, test } from 'vitest';
import { parseLeads, localDateTime } from '../apps/web/src/lib/leads';
import { scheduleSchema } from '../apps/api/src/validation';
import { classifySmtpFailure } from '../apps/api/src/mailer';
import { encrypt, decrypt, safeEqual } from '../apps/api/src/crypto';

describe('Lead imports', () => {
  test('parses quoted CSV, headers and CRLF without treating names as addresses', () => {
    const parsed = parseLeads(
      'Name,Email\r\n"Doe, Jane",JANE@example.com\r\nBob,bob@example.com\r\n',
    );
    expect(parsed.emails).toEqual(['jane@example.com', 'bob@example.com']);
    expect(parsed.invalid).toEqual([]);
  });
  test('deduplicates case-insensitively while preserving lead order', () => {
    const parsed = parseLeads('B@example.com\nb@example.com\na@example.com');
    expect(parsed.emails).toEqual(['b@example.com', 'a@example.com']);
    expect(parsed.duplicates).toBe(1);
  });
  test('supports text leads, semicolon-delimited CSV and display-name syntax', () => {
    expect(parseLeads('"Jane Doe";"Jane <jane@example.com>"\nBob;bob@example.org').emails).toEqual([
      'jane@example.com',
      'bob@example.org',
    ]);
  });
  test('does not quietly convert malformed addresses into valid partial matches', () => {
    const parsed = parseLeads('bad@@example.com\nnot-an-email\nvalid@example.com\na@localhost');
    expect(parsed.emails).toEqual(['valid@example.com']);
    expect(parsed.invalid).toEqual(['bad@@example.com', 'a@localhost']);
  });
  test('returns an empty state for blank input', () =>
    expect(parseLeads('  \n')).toEqual({ emails: [], invalid: [], duplicates: 0 }));
  test('datetime-local formatting round trips the local wall clock', () => {
    const date = new Date('2026-10-05T18:30:00Z');
    expect(new Date(localDateTime(date)).getTime()).toBe(date.getTime());
  });
});
const valid = {
  senderId: 'c8b9d2d1-0392-4af8-85e5-d9fc63e828fa',
  subject: 'Hello',
  body: 'A useful conversation',
  recipients: ['A@EXAMPLE.COM'],
  startAt: '2026-10-06T01:00:00+05:30',
  delaySeconds: 2,
  hourlyLimit: 200,
};
describe('API input boundaries', () => {
  test('normalizes addresses and accepts an explicit timezone offset', () =>
    expect(scheduleSchema.parse(valid).recipients).toEqual(['a@example.com']));
  test.each([0, -1, 1.5])('rejects an invalid hourly limit %s', (value) =>
    expect(scheduleSchema.safeParse({ ...valid, hourlyLimit: value }).success).toBe(false),
  );
  test('rejects header injection and invalid recipients', () => {
    expect(
      scheduleSchema.safeParse({ ...valid, subject: 'Hello\r\nBcc: private@example.com' }).success,
    ).toBe(false);
    expect(scheduleSchema.safeParse({ ...valid, recipients: ['a@@example.com'] }).success).toBe(
      false,
    );
  });
  test('requires a timestamp with timezone and enforces the batch boundary', () => {
    expect(scheduleSchema.safeParse({ ...valid, startAt: '2026-10-06T01:00:00' }).success).toBe(
      false,
    );
    expect(scheduleSchema.safeParse({ ...valid, recipients: [] }).success).toBe(false);
    expect(
      scheduleSchema.safeParse({ ...valid, recipients: Array(10001).fill('test@example.com') })
        .success,
    ).toBe(false);
  });
});
describe('SMTP ambiguity policy', () => {
  test('retries a definite refusal to connect or a temporary SMTP rejection', () => {
    expect(classifySmtpFailure({ code: 'ECONNREFUSED' })).toBe('retryable');
    expect(classifySmtpFailure({ responseCode: 421, command: 'DATA' })).toBe('retryable');
  });
  test('does not retry credential failures or permanent SMTP rejection automatically', () => {
    expect(classifySmtpFailure({ code: 'EAUTH' })).toBe('permanent');
    expect(classifySmtpFailure({ responseCode: 550 })).toBe('permanent');
  });
  test('never assumes a DATA-stage timeout is a definite failure', () => {
    expect(classifySmtpFailure({ code: 'ETIMEDOUT', command: 'DATA' })).toBe('uncertain');
    expect(classifySmtpFailure({ code: 'ESOCKET', command: 'DATA' })).toBe('uncertain');
  });
});
describe('Credential protection', () => {
  test('encrypts randomly and authenticates the ciphertext', () => {
    const a = encrypt('never-print-this'),
      b = encrypt('never-print-this');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('never-print-this');
    expect(decrypt(a)).toBe('never-print-this');
    const parts = a.split('.');
    parts[1] = '00'.repeat(16);
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  test('compares only correctly typed, equal-length CSRF/state tokens', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('abc', ['abc'])).toBe(false);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
});
