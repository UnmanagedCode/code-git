// READ-ONLY history check against a live code-conductor: boots this checkout's backend with CONDUCTOR_URL pointed at it,
// opens a checkout by URL and, through the palette, a tracked file's File history (a commit's change in the viewer),
// its Blame, and the Reflog of HEAD. Everything it drives is a read (history.*, diff.file, undo.state and the reads an
// open tab makes); the script fails if the page posts an op the registry does not call a read, or if any non-read command
// lands in the activity log. It never registers, rescans or enables the plugin.
// Run: CONDUCTOR_URL=http://127.0.0.1:<cc port> node harness/playwright/live-history.mjs [project[/worktree]]   (default test)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { OPS } from '../../src/git/ops/index.js';

const cc = process.env.CONDUCTOR_URL;
if (!cc) throw new Error('CONDUCTOR_URL is not set: point it at the live cc (see harness/playwright/README.md)');
const health = await (await fetch(`${cc}/api/health`)).json();
if (health.app !== 'code-conductor') throw new Error(`${cc} is not a code-conductor: ${JSON.stringify(health)}`);

const { bootServer, withPage } = await import(BROWSER);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'live');
mkdirSync(outDir, { recursive: true });
const [project, worktree = null] = (process.argv[2] ?? 'test').split('/');
const query = `?project=${encodeURIComponent(project)}${worktree ? `&worktree=${encodeURIComponent(worktree)}` : ''}`;
const check = (cond, what) => { if (!cond) throw new Error(`live-history: ${what}`); console.log(`ok: ${what}`); };

const srv = await bootServer({ cwd: path.resolve(here, '..', '..'), entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc } });
try {
  await withPage(async (page) => {
    const writes = [];
    page.on('request', (q) => {
      const m = /api\/ops\/([^/?]+)$/.exec(q.url());
      if (m && OPS.get(decodeURIComponent(m[1]))?.kind !== 'read') writes.push(m[1]);
    });
    const shot = (name) => page.screenshot({ path: path.join(outDir, `history-${name}.png`), animations: 'disabled' });
    const palette = page.getByRole('combobox', { name: 'Command', exact: true });
    const run = async (command) => {
      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('ControlOrMeta+p');
      await palette.fill(command);
      await page.keyboard.press('Enter');
    };

    await page.goto(`${srv.url}/${query}`);
    await page.getByRole('group', { name: 'HEAD', exact: true }).waitFor({ timeout: 60_000 });
    // The palette's history commands need HEAD from the graph's refs.
    await page.locator('[data-row-id]').first().waitFor({ timeout: 60_000 });

    // File history of the first file HEAD has (history.paths)
    await run('File history');
    const pick = page.getByRole('combobox', { name: 'File history…', exact: true });
    await pick.waitFor();
    const first = page.getByRole('listbox', { name: 'File history…', exact: true }).getByRole('option').first();
    await first.waitFor({ timeout: 60_000 });
    const file = (await first.textContent()).trim();
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'File history', exact: true });
    await list.getByRole('option').first().waitFor({ timeout: 60_000 });
    check(await list.getByRole('option').count() >= 1, `${file}: its history lists commits (${await list.getByRole('option').count()})`);
    await page.locator('[data-history-viewer] [data-view], [data-history-viewer] p').first().waitFor({ timeout: 60_000 });
    check(await page.locator('[data-history-viewer] [role="alert"]').count() === 0, 'the viewer shows the commit\'s change without an error');
    await shot('file');

    // Its blame
    await page.getByRole('group', { name: 'History or blame', exact: true }).getByRole('button', { name: 'Blame', exact: true }).click();
    const blame = page.getByRole('table', { name: 'Blame', exact: true });
    const alert = page.getByRole('alert');
    await Promise.race([blame.locator('[data-blame-line="1"]').waitFor({ timeout: 60_000 }), alert.first().waitFor({ timeout: 60_000 })]);
    if (await alert.count()) console.log(`note: ${file}: ${await alert.first().textContent()} (no lines to blame)`);
    else check(await blame.locator('[data-blame-line]').count() >= 1, `${file}: blame shows its lines`);
    await shot('blame');

    // The reflog of HEAD
    await run('Reflog');
    const entries = page.getByRole('list', { name: 'Reflog entries', exact: true });
    await page.getByText(/entries|No reflog entries/).first().waitFor({ timeout: 60_000 });
    console.log(`note: HEAD's reflog shows ${await entries.locator('[data-reflog-row]').count()} entries`);
    await shot('reflog');

    if (writes.length) throw new Error(`live-history: an op outside the read set was called: ${writes.join(', ')}`);
    const activity = await (await fetch(`${srv.url}/api/activity`)).json();
    check(!activity.entries.some((e) => e.kind !== 'read'), 'only read commands ran');
    check(activity.entries.some((e) => e.op === 'history.file' && e.exitCode === 0), 'history.file ran on the System (exit 0)');
    check(activity.entries.some((e) => e.op === 'history.reflog' && (e.exitCode === 0 || e.exitCode === 128)), 'history.reflog ran on the System');
  }, { viewport: { width: 1280, height: 800 } });
} finally {
  await srv.close();
}
console.log('live-history: all checks passed (read-only)');
