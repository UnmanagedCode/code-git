// The graph's scroll measurement on the perf fixture (docs/graph.md → Performance). Conditions: the `big` project of
// graphSeed.mjs (tests/_graphFixture.js defaults: seed 42, 5,000 commits, 60 topic branches of which 45 merged, every
// head mirrored as origin/*, 78 tags — 200 refs), headless Chromium from code-playwright, viewport 1280×800.
// Procedure: open `big`, then scroll the list 600 px per animation frame to the bottom, again and again, until every
// page is loaded; sample the rendered rows each frame, the frame intervals, long tasks, and each graph.page round trip.
// Gates: at most MAX_ROWS rows in the DOM, every graph.page round trip within MAX_PAGE_MS, no long task over
// MAX_LONG_TASK_MS. Frame times are printed, never gated. Writes out/graph-perf.json.
// Run: node harness/playwright/graph-perf.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedGraph } from './graphSeed.mjs';
import { measureScroll, summarize } from './graphMeasure.mjs';
import { MAX_LONG_TASK_MS, MAX_PAGE_MS, MAX_ROWS } from './graphLimits.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });


const world = await seedGraph();
let report;
try {
  report = await withPage(async (page) => {
    const m = await measureScroll(page, `${world.url}/?project=big`);
    const activity = await (await fetch(`${world.url}/api/activity`)).json();
    return summarize(m, activity.entries.filter((e) => e.target.project === 'big'));
  }, { viewport: { width: 1280, height: 800 } });
} finally {
  await world.close();
}
report.conditions = { fixture: 'tests/_graphFixture.js defaults (seed 42, 5000 commits, 60 branches / 45 merged, 200 refs)', viewport: '1280x800', browser: 'headless Chromium (code-playwright)' };
writeFileSync(path.join(outDir, 'graph-perf.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const fails = [];
if (report.loaded !== 5000) fails.push(`loaded ${report.loaded} commits, expected 5000`);
if (report.maxRows > MAX_ROWS) fails.push(`${report.maxRows} rows in the DOM > ${MAX_ROWS}`);
if (report.pageRoundTripMs.max > MAX_PAGE_MS) fails.push(`a graph.page round trip took ${report.pageRoundTripMs.max} ms > ${MAX_PAGE_MS}`);
if (report.longTaskMs.max > MAX_LONG_TASK_MS) fails.push(`a long task took ${report.longTaskMs.max} ms > ${MAX_LONG_TASK_MS}`);
if (fails.length) throw new Error(`graph-perf gates failed:\n${fails.join('\n')}`);
console.log(`ok: gates passed (rows ≤ ${MAX_ROWS}, graph.page ≤ ${MAX_PAGE_MS} ms, long tasks ≤ ${MAX_LONG_TASK_MS} ms)`);
