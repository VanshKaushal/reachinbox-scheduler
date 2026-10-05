import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser-report.json' }]],
  use: {
    baseURL: 'http://localhost:4201',
    channel: 'chromium-headless-shell',
    viewport: { width: 1440, height: 1020 },
    timezoneId: 'Asia/Kolkata',
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
