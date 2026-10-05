import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run google:import -- "C:/path/to/client_secret.json"');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const envPath = new URL('.env', root);
try {
  const content = await readFile(envPath, 'utf8');
  const env = parse(content);
  const json = JSON.parse(await readFile(path, 'utf8'));
  const client = json.web;
  if (
    !client ||
    typeof client.client_id !== 'string' ||
    !client.client_id.endsWith('.apps.googleusercontent.com') ||
    typeof client.client_secret !== 'string' ||
    !client.client_secret
  )
    throw new Error(
      'Choose the JSON downloaded for a Google Web application OAuth client. A project/service-account JSON is different.',
    );
  const callback = `${env.API_URL || 'http://localhost:4000'}/api/auth/google/callback`;
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(callback))
    throw new Error(
      `Register ${callback} under Authorized redirect URIs in Google Cloud, then download the updated JSON.`,
    );
  let updated = content;
  for (const [key, value] of [
    ['GOOGLE_CLIENT_ID', client.client_id],
    ['GOOGLE_CLIENT_SECRET', client.client_secret],
  ]) {
    const pattern = new RegExp(`^${key}\\s*=.*$`, 'gm');
    const assignment = `${key}=${JSON.stringify(value)}`;
    if ((updated.match(pattern) || []).length > 1)
      throw new Error(`Remove duplicate ${key} assignments from .env first.`);
    updated = pattern.test(updated)
      ? updated.replace(pattern, assignment)
      : `${updated.trimEnd()}\n${assignment}\n`;
  }
  await writeFile(envPath, updated, { mode: 0o600 });
  console.log(
    'Imported the Google Web OAuth client into the gitignored .env. Client secrets were not displayed. Restart the API, then complete real Google sign-in.',
  );
} catch (error) {
  // Never print JSON content, credential values, or a credential-bearing parser error.
  if (error instanceof SyntaxError)
    console.error('The selected file is not valid Google client JSON.');
  else if (error?.code)
    console.error('Could not read the client JSON or .env. Check the file path and permissions.');
  else console.error(error.message);
  process.exitCode = 1;
}
