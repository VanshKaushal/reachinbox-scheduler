import Papa from 'papaparse';

export interface LeadResult {
  emails: string[];
  invalid: string[];
  duplicates: number;
}
export function parseLeads(text: string): LeadResult {
  if (!text.trim()) return { emails: [], invalid: [], duplicates: 0 };
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const seen = new Set<string>(),
    invalid = new Set<string>();
  let duplicates = 0;
  for (const row of parsed.data) {
    for (const cell of row) {
      if (!cell.includes('@')) continue;
      const candidate = cell.match(/<([^<>]+@[^<>]+)>/)?.[1] ?? cell;
      for (const part of candidate.split(/[\s;,]+/)) {
        const email = part.trim().toLowerCase();
        if (!email || !email.includes('@')) continue;
        if (
          email.length > 254 ||
          !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
            email,
          )
        ) {
          invalid.add(email);
          continue;
        }
        if (seen.has(email)) duplicates++;
        else seen.add(email);
      }
    }
  }
  return { emails: [...seen], invalid: [...invalid], duplicates };
}
export function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
export function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join('')
    .toUpperCase();
}
