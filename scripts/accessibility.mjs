import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium-headless-shell' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const reports = [];
async function scan(name) {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  reports.push({
    name,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary, html: n.html })),
    })),
  });
}
await page.goto('http://localhost:5173');
await page.getByRole('button', { name: 'Explore the local demo' }).waitFor();
await scan('login');
await page.getByRole('button', { name: 'Explore the local demo' }).click();
await page.getByRole('heading', { name: 'Email overview.' }).waitFor();
await scan('dashboard');
await page.getByRole('button', { name: 'Compose new email' }).click();
await scan('compose');
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'Sender accounts', exact: true }).click();
await scan('senders');
await page.getByRole('button', { name: 'Integrations', exact: true }).click();
await scan('integrations');
await writeFile('artifacts/accessibility-report.json', JSON.stringify(reports, null, 2));
console.log(
  JSON.stringify(
    reports.map((r) => ({
      screen: r.name,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        targets: v.nodes.slice(0, 12).map((n) => n.target.join(' ')),
      })),
    })),
    null,
    2,
  ),
);
await browser.close();
if (reports.some((report) => report.violations.length)) process.exitCode = 1;
