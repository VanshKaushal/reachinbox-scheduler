import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto('http://localhost:5173');
await page.getByRole('button', { name: 'Explore the local demo' }).waitFor();
await page.screenshot({ path: 'artifacts/login.png', fullPage: true });
await page.getByRole('button', { name: 'Explore the local demo' }).click();
await page.getByRole('heading', { name: 'Email overview.' }).waitFor();
await page.screenshot({ path: 'artifacts/dashboard-empty.png', fullPage: true });
await page.getByRole('button', { name: 'Compose new email', exact: false }).click();
await page.getByRole('dialog').waitFor();
await page.screenshot({ path: 'artifacts/compose.png', fullPage: true });
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'Sender accounts', exact: true }).click();
await page.getByRole('button', { name: 'Add sender', exact: true }).click();
await page.getByLabel('Sender name', { exact: true }).fill('Vansh from ReachInbox');
await page.getByRole('button', { name: 'Create sender', exact: true }).click();
await page
  .getByRole('heading', { name: 'Vansh from ReachInbox', exact: true })
  .waitFor({ timeout: 60000 });
await page.screenshot({ path: 'artifacts/senders.png', fullPage: true });
console.log(JSON.stringify({ errors, senderCreated: true }));
await browser.close();
