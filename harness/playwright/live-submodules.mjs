// READ-ONLY submodule check against a live code-conductor: boots this checkout's backend with CONDUCTOR_URL pointed at
// it and opens one checkout (default `test`) by URL. Asserts its Submodules panel renders from `submodule.list`, and that
// a submodule tab naming a path that is not a cloned submodule (`sub=no-such-sub`) reaches the project's System through
// cc's form-A exec as `-C no-such-sub --git-dir=.git` and is refused SUBMODULE_NOT_POPULATED. When the checkout has a
// cloned, unblocked submodule it also opens it as its own repo view, then lists that submodule's own submodules and opens
// the first cloned, unblocked one two levels deep (the containment preflight's git-dir check passing at both levels);
// each level it cannot reach prints its own SKIP line.
// It never calls a write op (it fails if the page does), never registers, rescans or enables the plugin, never seeds.
// Run: CONDUCTOR_URL=http://127.0.0.1:<cc port> node harness/playwright/live-submodules.mjs [project[/worktree]]
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS } from '../../src/git/ops/index.js';
import { BROWSER } from './resolve.mjs';

const cc = process.env.CONDUCTOR_URL;
if (!cc) throw new Error('CONDUCTOR_URL is not set: point it at the live cc (see harness/playwright/README.md)');
const health = await (await fetch(`${cc}/api/health`)).json();
if (health.app !== 'code-conductor') throw new Error(`${cc} is not a code-conductor: ${JSON.stringify(health)}`);

const { bootServer, withPage } = await import(BROWSER);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'live');
mkdirSync(outDir, { recursive: true });
const [project, worktree = null] = (process.argv[2] ?? 'test').split('/');
const label = worktree ? `${project}/${worktree}` : project;
const route = (sub) => {
  const q = new URLSearchParams({ project });
  if (worktree) q.set('worktree', worktree);
  for (const s of sub ?? []) q.append('sub', s);
  return `?${q}`;
};
/** Waits until `locator` matches at least one element (an activity row may be scrolled out of its region). */
async function present(locator, what, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await locator.count()) return;
  throw new Error(`live-submodules: ${what} never appeared`);
}
const check = (cond, what) => { if (!cond) throw new Error(`live-submodules: ${what}`); console.log(`ok: ${what}`); };

const srv = await bootServer({ cwd: path.resolve(here, '..', '..'), entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc } });
try {
  await withPage(async (page) => {
    const writes = [];
    const lists = [];
    /** The last submodule.list answer per chain (JSON of target.sub, `[]` for the checkout), and each read's status per chain. */
    const listsBy = new Map();
    const reads = new Map();
    const chainOf = (q) => JSON.stringify(JSON.parse(q.postData() ?? '{}').target?.sub ?? []);
    page.on('request', (q) => {
      const m = /\/api\/ops\/([^/?]+)$/.exec(new URL(q.url()).pathname);
      if (m && OPS.get(decodeURIComponent(m[1]))?.kind !== 'read') writes.push(m[1]);
    });
    page.on('response', async (r) => {
      const m = /\/api\/ops\/(repo\.summary|commit\.state|submodule\.list)$/.exec(r.url());
      if (!m) return;
      const chain = chainOf(r.request());
      reads.set(`${m[1]} ${chain}`, r.status());
      if (m[1] !== 'submodule.list' || r.status() !== 200) return;
      const body = await r.json().catch(() => null);
      if (!body?.ok) return;
      listsBy.set(chain, body.result);
      if (chain === '[]') lists.push(body.result);
    });
    /** Waits until `fn()` is truthy (a response may land after the page shows its result). */
    const until = async (fn, what, ms = 60_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (fn()) return;
      throw new Error(`live-submodules: ${what} never happened`);
    };
    /** The backend's activity log (this script's own backend: a read). */
    const activityLog = async () => (await (await fetch(`${srv.url}/api/activity`)).json()).entries;
    const afterBase = (argv) => argv.slice(argv.indexOf('--work-tree=.') + 1).join(' ');
    const shot = async (name) => {
      const file = path.join(outDir, `submodules-${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const header = page.locator('header[aria-label="Repository summary"]');
    const panel = page.getByRole('region', { name: 'Submodules', exact: true });
    const activity = page.getByRole('region', { name: 'Activity', exact: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${srv.url}/${route()}`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${srv.url}/${route()}`);

    // 1. The checkout's Submodules panel, from submodule.list on the project's System.
    await panel.getByRole('heading', { name: /^Submodules \(\d+\)$/ }).waitFor({ timeout: 60_000 });
    await panel.getByText('No submodules', { exact: true }).or(panel.getByRole('list', { name: 'Submodule list', exact: true })).first().waitFor({ timeout: 60_000 });
    check(await panel.getByRole('alert').count() === 0, `${label}: the Submodules panel rendered without an error`);
    const listed = lists.at(-1)?.submodules ?? [];
    check(lists.length > 0, `${label}: submodule.list answered (${listed.length} submodule(s))`);
    if (!listed.length) check(await panel.getByText('No submodules', { exact: true }).isVisible(), `${label}: an empty list reads "No submodules"`);
    const gm = activity.getByRole('listitem').filter({ hasText: 'config -f .gitmodules' }).filter({ hasText: /exit [01](?!\d)/ });
    await present(gm, 'the config -f .gitmodules entry');
    check(true, `${label}: the activity panel shows config -f .gitmodules with an allowed exit`);
    await panel.scrollIntoViewIfNeeded();
    await shot('panel');

    // 2. A submodule tab naming no cloned submodule: refused by the containment preflight, run through cc on the System.
    await page.goto(`${srv.url}/${route(['no-such-sub'])}`);
    const alert = header.getByRole('alert');
    await alert.waitFor({ timeout: 60_000 });
    check(/no-such-sub is not a cloned submodule/.test(await alert.innerText()), `${label} › no-such-sub: the header shows SUBMODULE_NOT_POPULATED`);
    const probe = activity.getByRole('listitem').filter({ has: page.getByText(`${label} › no-such-sub`, { exact: true }) })
      .filter({ hasText: '-C no-such-sub --git-dir=.git rev-parse --show-toplevel' }).filter({ hasText: 'exit 128' });
    await present(probe, 'the no-such-sub preflight entry');
    check(true, `${label} › no-such-sub: the activity entry carries sub and shows -C no-such-sub --git-dir=.git, exit 128`);
    await shot('not-populated');

    // 3. Open a cloned, unblocked submodule as its own repo view, when there is one.
    const open = listed.find((e) => e.populated && !e.blocked);
    if (!open) {
      console.log(`SKIP: ${label} has no populated submodule — open-as-repo not checked on a non-local System`);
    } else {
      await page.goto(`${srv.url}/${route([open.path])}`);
      await page.getByRole('heading', { level: 1, name: open.path, exact: true }).waitFor({ timeout: 60_000 });
      await header.getByRole('group', { name: 'HEAD' }).waitFor({ timeout: 60_000 });
      check(await header.getByRole('alert').count() === 0, `${label} › ${open.path}: repo.summary loaded without an error`);
      await page.getByText(/^\d+ commits loaded/).waitFor({ timeout: 60_000 });
      check(true, `${label} › ${open.path}: the graph's first page loaded`);
      await shot('open');

      // 4. Its own submodules, listed in its tab; the first cloned, unblocked one opened two levels deep.
      const first = JSON.stringify([open.path]);
      await until(() => listsBy.has(first), `${label} › ${open.path}: submodule.list`);
      check(await panel.getByRole('alert').count() === 0, `${label} › ${open.path}: its Submodules panel rendered without an error`);
      const nested = listsBy.get(first).submodules.find((e) => e.populated && !e.blocked);
      if (!nested) {
        console.log(`SKIP: ${label} › ${open.path} has no populated submodule — the two-level chain not checked on a non-local System`);
      } else {
        const chain = [open.path, nested.path];
        const key = JSON.stringify(chain);
        const tabLabel = [label, ...chain].join(' › ');
        await page.goto(`${srv.url}/${route(chain)}`);
        await page.getByRole('heading', { level: 1, name: nested.path, exact: true }).waitFor({ timeout: 60_000 });
        const trail = page.getByRole('navigation', { name: 'Submodule path', exact: true });
        check(JSON.stringify(await trail.getByRole('button').allTextContents()) === JSON.stringify([label, open.path]), `${tabLabel}: the breadcrumb names ${label} and ${open.path}`);
        await header.getByRole('group', { name: 'HEAD' }).waitFor({ timeout: 60_000 });
        check(await header.getByRole('alert').count() === 0, `${tabLabel}: repo.summary loaded without an error`);
        await page.getByText(/^\d+ commits loaded/).waitFor({ timeout: 60_000 });
        check(true, `${tabLabel}: the graph's first page loaded`);
        await until(() => reads.has(`commit.state ${key}`), `${tabLabel}: commit.state`);
        check(reads.get(`repo.summary ${key}`) === 200 && reads.get(`commit.state ${key}`) === 200, `${tabLabel}: repo.summary and commit.state answered 200`);
        // The containment preflight on the System: each chain level's git dir read, through cc, with exit 0.
        // A preflight logs each level under its own chain: match the op runs of the nested tab's repo.summary instead.
        const log = await activityLog();
        const runs = new Set(log.filter((e) => e.op === 'repo.summary' && JSON.stringify(e.target.sub ?? []) === key).map((e) => e.opRunId));
        const ran = log.filter((e) => runs.has(e.opRunId));
        const level = (p) => ran.some((e) => afterBase(e.argv) === `-C ${p} --git-dir=.git rev-parse --absolute-git-dir` && e.exitCode === 0);
        check(level(open.path) && level(chain.join('/')), `${tabLabel}: the git-dir check ran at both levels (-C ${open.path}, -C ${chain.join('/')}) with exit 0`);
        await shot('nested');
      }
    }
    check(writes.length === 0, `no write op was called${writes.length ? `: ${writes.join(', ')}` : ''}`);
  });
} finally {
  await srv.close();
}
