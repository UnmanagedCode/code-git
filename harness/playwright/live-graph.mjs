// READ-ONLY graph measurement against a live code-conductor: boots this checkout's backend with CONDUCTOR_URL pointed at
// it, opens a project's graph by URL and runs the scroll measurement of graph-perf.mjs (graphMeasure.mjs). Everything it
// drives is a read: repo.summary, the graph.* ops, branch.tracking and remote.list (git with GIT_OPTIONAL_LOCKS=0), cc's
// project and worktree lists.
// It never calls a write op, never registers, rescans or enables the plugin. The only gate is the DOM bound.
// Run: CONDUCTOR_URL=http://127.0.0.1:<cc port> node harness/playwright/live-graph.mjs [project[/worktree]]   (default code-conductor)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { measureScroll, summarize } from './graphMeasure.mjs';
import { MAX_ROWS } from './graphLimits.mjs';

const cc = process.env.CONDUCTOR_URL;
if (!cc) throw new Error('CONDUCTOR_URL is not set: point it at the live cc (see harness/playwright/README.md)');
const health = await (await fetch(`${cc}/api/health`)).json();
if (health.app !== 'code-conductor') throw new Error(`${cc} is not a code-conductor: ${JSON.stringify(health)}`);

const { bootServer, withPage } = await import(BROWSER);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'live');
mkdirSync(outDir, { recursive: true });
const [project, worktree = null] = (process.argv[2] ?? 'code-conductor').split('/');
const query = `?project=${encodeURIComponent(project)}${worktree ? `&worktree=${encodeURIComponent(worktree)}` : ''}`;

const srv = await bootServer({ cwd: path.resolve(here, '..', '..'), entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc } });
let report;
try {
  report = await withPage(async (page) => {
    const writes = [];
    page.on('request', (r) => { if (/api\/ops\//.test(r.url()) && !/api\/ops\/(repo\.summary|graph\.(refs|page|stats|search|commit)|branch\.tracking|remote\.list)$/.test(r.url())) writes.push(r.url()); });
    const m = await measureScroll(page, `${srv.url}/${query}`);
    await page.screenshot({ path: path.join(outDir, 'graph.png'), animations: 'disabled' });
    if (writes.length) throw new Error(`live-graph: an op outside the read set was called: ${writes.join(', ')}`);
    const activity = await (await fetch(`${srv.url}/api/activity`)).json();
    if (activity.entries.some((e) => e.kind !== 'read')) throw new Error('live-graph: a non-read command ran');
    return summarize(m, activity.entries.filter((e) => e.target.project === project));
  }, { viewport: { width: 1280, height: 800 } });
} finally {
  await srv.close();
}
report.conditions = { checkout: worktree ? `${project}/${worktree}` : project, viewport: '1280x800', browser: 'headless Chromium (code-playwright)', live: true };
writeFileSync(path.join(outDir, 'graph-perf.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.maxRows > MAX_ROWS) throw new Error(`live-graph: ${report.maxRows} rows in the DOM > ${MAX_ROWS}`);
console.log(`ok: at most ${MAX_ROWS} rows in the DOM (${report.maxRows}) over ${report.loaded} commits`);
