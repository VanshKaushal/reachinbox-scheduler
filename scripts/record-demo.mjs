import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, copyFile } from 'node:fs/promises';
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  env: { ...process.env, RECORD_DEMO: 'true' },
  stdio: 'inherit',
  windowsHide: true,
});
const [code] = await once(child, 'exit');
if (code !== 0) process.exit(code || 1);
await mkdir('docs/recordings', { recursive: true });
await copyFile('artifacts/demo-preview.webm', 'docs/recordings/technical-preview.webm');
console.log(
  'Saved the captioned technical preview. Google/Slack account consent is a separate live check.',
);
