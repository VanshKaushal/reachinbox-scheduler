import { test, expect } from '@playwright/test';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import AxeBuilder from '@axe-core/playwright';
import { createConnection } from 'mysql2/promise';
import { Redis } from 'ioredis';

const local = parse(await readFile('.env', 'utf8'));
const db = new URL(local.DATABASE_URL!);
db.pathname = '/reachinbox_e2e';
const redis = new URL(local.REDIS_URL!);
redis.pathname = '/3';
const run = randomUUID().slice(0, 8);
const env = {
  ...process.env,
  ...local,
  NODE_ENV: 'test',
  DEMO_MODE: 'true',
  PORT: '4201',
  APP_URL: 'http://localhost:4201',
  API_URL: 'http://localhost:4201',
  DATABASE_URL: db.href,
  REDIS_URL: redis.href,
  ELASTICSEARCH_INDEX: `reachinbox-browser-${run}`,
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SLACK_CLIENT_ID: '',
  SLACK_CLIENT_SECRET: '',
};
let api: ChildProcess, worker: ChildProcess;
const logs: string[] = [];
function start(file: string) {
  const child = spawn(process.execPath, [file], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data) => logs.push(data.toString()));
  child.stderr?.on('data', (data) => logs.push(data.toString()));
  return child;
}
async function stop(child: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
}
async function ready() {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch('http://localhost:4201/api/health')).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBe(true);
}
test.beforeAll(async () => {
  const migration = start('apps/api/dist/scripts/migrate.js');
  expect((await once(migration, 'exit'))[0]).toBe(0);
  // Only reset the explicitly isolated browser database, never the application workspace.
  expect(db.pathname).toBe('/reachinbox_e2e');
  expect(redis.pathname).toBe('/3');
  const connection = await createConnection(db.href);
  for (const table of ['outbox', 'emails', 'campaigns', 'senders', 'slack_connections', 'users'])
    await connection.query(`DELETE FROM ${table}`);
  await connection.end();
  const cache = new Redis(redis.href);
  await cache.flushdb();
  await cache.quit();
  api = start('apps/api/dist/server.js');
  await ready();
  worker = start('apps/api/dist/worker.js');
  await mkdir('docs/screenshots', { recursive: true });
});
test.afterAll(async () => {
  await stop(worker);
  await stop(api);
  await writeFile('artifacts/browser-services.log', logs.join(''));
});

test('real browser: CSV scheduling, restart recovery, SMTP delivery, indexed search, cancellation and mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Explore the local demo' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/login.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore the local demo' }).click();
  await expect(page.getByRole('heading', { name: 'Email overview.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sender accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Add sender', exact: true }).click();
  const senderName = `Vansh · ${run}`;
  await page.getByLabel('Sender name', { exact: true }).fill(senderName);
  await page.getByRole('button', { name: 'Create sender', exact: true }).click();
  await expect(page.getByRole('heading', { name: senderName, exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({ path: 'docs/screenshots/senders.png', fullPage: true });
  await page.getByRole('button', { name: 'Email overview', exact: false }).click();
  await page.getByRole('button', { name: 'Compose new email' }).click();
  await page.getByLabel('From', { exact: false }).selectOption({
    label: await page.locator('#compose-sender option').filter({ hasText: senderName }).innerText(),
  });
  await page.getByLabel('Subject', { exact: false }).fill(`A thoughtful hello · ${run}`);
  await page
    .getByLabel('Email body', { exact: false })
    .fill(
      `Hi there,\n\nThis message proves durable scheduling and real Ethereal SMTP delivery. Search marker: journey${run}.\n\nBest,\nVansh`,
    );
  await page.getByLabel('Upload CSV or text leads').setInputFiles({
    name: 'demo-leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `name,email\nAlex,alex.${run}@example.com\nJamie,jamie.${run}@example.com\nCasey,casey.${run}@example.com\nAlex duplicate,ALEX.${run}@example.com\nInvalid,bad@\n`,
    ),
  });
  await expect(page.getByText('3 unique emails', { exact: true })).toBeVisible();
  await expect(page.getByText('1 duplicate removed')).toBeVisible();
  await expect(page.getByText('1 invalid address excluded')).toBeVisible();
  const due = Math.ceil((Date.now() + 30000) / 60000) * 60000;
  const startTime = await page.evaluate((timestamp) => {
    const date = new Date(timestamp);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }, due);
  await page.getByLabel('Start sending', { exact: false }).fill(startTime);
  await page.getByLabel('Delay', { exact: true }).fill('2');
  await page.getByLabel('Hourly limit', { exact: true }).fill('10');
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: 'docs/screenshots/compose.png', fullPage: true });
  await page.getByRole('button', { name: 'Schedule emails', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page
    .getByRole('button', { name: `View email to casey.${run}@example.com`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel email', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, cancel email', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByRole('button', { name: `View email to casey.${run}@example.com`, exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
  // Abruptly stop both processes before the persisted schedule is due.
  expect(Date.now()).toBeLessThan(due);
  await stop(worker);
  await stop(api);
  await page.waitForTimeout(3000);
  api = start('apps/api/dist/server.js');
  await ready();
  worker = start('apps/api/dist/worker.js');
  await page.reload(); // Redis session survives API restart.
  await expect(page.getByRole('heading', { name: 'Email overview.' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sent & history', exact: false }).click();
  await expect(
    page
      .locator('.email-table tbody tr')
      .filter({ hasText: `alex.${run}@example.com` })
      .getByText('Sent', { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect(
    page
      .locator('.email-table tbody tr')
      .filter({ hasText: `jamie.${run}@example.com` })
      .getByText('Sent', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page
    .getByRole('button', { name: `View email to alex.${run}@example.com`, exact: true })
    .click();
  await expect(page.getByText('1 delivery attempt', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View in Ethereal' })).toHaveAttribute(
    'href',
    /^https:\/\/ethereal.email\/message\//,
  );
  await page.screenshot({ path: 'docs/screenshots/delivery.png', fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'Search emails', exact: true }).fill(`journey${run}`);
  await expect(
    page.locator('.email-table tbody tr').filter({ hasText: `alex.${run}@example.com` }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Search powered by Elasticsearch')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/integrations.png', fullPage: true });
  await page.getByRole('button', { name: 'Email overview', exact: false }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sender accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sender accounts.' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1020 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Explore the local demo' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
  const video = await page.video()?.path();
  if (video) await copyFile(video, 'artifacts/demo-preview.webm');
});
