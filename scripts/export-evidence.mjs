import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('docs/evidence', { recursive: true });
for (const name of ['integration-report', 'accessibility-report']) {
  const data = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
  await writeFile(`docs/evidence/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}
const browser = JSON.parse(await readFile('artifacts/browser-report.json', 'utf8'));
const summary = {
  generatedAt: new Date().toISOString(),
  ...browser.stats,
  scenarios: browser.suites.flatMap((suite) =>
    suite.specs.map((spec) => ({
      title: spec.title,
      ok: spec.ok,
      results: spec.tests.flatMap((test) =>
        test.results.map((result) => ({ status: result.status, durationMs: result.duration })),
      ),
    })),
  ),
};
await writeFile('docs/evidence/browser-report.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log('Exported credential-free integration, accessibility and browser evidence.');
