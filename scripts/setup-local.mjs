import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const file = new URL('.env', root);
try {
  await access(file);
  console.log('.env already exists; preserving it.');
} catch {
  let content = await readFile(new URL('.env.example', root), 'utf8');
  content = content
    .replace(
      'SESSION_SECRET=replace-with-at-least-32-random-characters',
      `SESSION_SECRET=${randomBytes(48).toString('hex')}`,
    )
    .replace(
      'ENCRYPTION_KEY=replace-with-64-hex-characters',
      `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
    )
    .replace('DEMO_MODE=false', 'DEMO_MODE=true');
  await writeFile(file, content, { flag: 'wx', mode: 0o600 });
  console.log(
    'Created .env with fresh secrets and explicit local demo access. OAuth credentials still need configuration.',
  );
}
