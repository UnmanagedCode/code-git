// The submodule path, asserted on the seeded `subs` project (seed.mjs): the Submodules panel and its badges, Initialize
// then Update of the uninitialised libs/c (the running toast with its seconds), Open libs/a as its own repo view
// (breadcrumb, graph, refs, Changes, its own nested submodule), a commit made there through the UI, Back to the parent
// and the pointer prompt committing the new pointer, then Add…, Edit URL… and Remove… (both confirmations) of a new
// submodule, and the panel's dialog and menu on a phone. Each step is checked against git itself. Runs in light then
// dark, each on a fresh seed; screenshots go to out/submodules/.
// Run: node harness/playwright/submodules.mjs   (needs `npm run prepare` first, for frontend/dist)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticEnv } from '../../tests/_git.js';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'submodules');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const check = (cond, what) => { if (!cond) throw new Error(`submodules: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  const repo = world.subs;
  const git = (dir, ...args) => execFileSync('git', ['-C', path.join(repo.dir, dir), ...args], { env: hermeticEnv(repo.home) }).toString();
  const gm = (key) => { try { return git('.', 'config', '-f', '.gitmodules', '--get', key).trim(); } catch { return null; } };
  try {
    await withPage(async (page) => {
      const errors = [];
      /** The one deliberate refusal: the first Remove of the staged libs/d (SUBMODULE_DIRTY), which the UI turns into a confirmation. */
      let allowedRefusals = 0;
      page.on('console', (m) => {
        if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      // A known race (docs/submodules.md → Known limitations): a read the UI starts while a multi-command submodule write
      // runs can find a submodule half-removed or half-cloned. Tolerated only for a repo.summary, graph.* or submodule.list read whose
      // request overlaps an in-flight submodule.remove or submodule.update and fails with git's error (GIT_FAILED, or
      // NOT_A_REPO as repo.summary words exit 128); `recovered()` then requires a clean, error-free page once the op ends.
      const started = new Map();
      const writes = [];
      const tolerated = [];
      page.on('request', (q) => {
        started.set(q, Date.now());
        if (/\/api\/ops\/submodule\.(remove|update)$/.test(q.url())) writes.push({ q, start: Date.now(), end: null });
      });
      const ended = (q) => { const w = writes.find((x) => x.q === q); if (w) w.end = Date.now(); };
      page.on('requestfinished', ended);
      page.on('requestfailed', ended);
      page.on('response', async (r) => {
        if (r.status() < 400 || HOST_URLS.test(r.url())) return;
        if (allowedRefusals > 0 && r.status() === 409 && r.url().endsWith('/api/ops/submodule.remove')) { allowedRefusals--; return; }
        const from = started.get(r.request()) ?? 0;
        const to = Date.now();
        const text = await r.text().catch(() => '');
        let code = null;
        try { code = JSON.parse(text).code; } catch { /* not JSON */ }
        const read = /\/api\/ops\/(repo\.summary|graph\.[a-zA-Z]+|submodule\.list)$/.test(r.url());
        const overlaps = writes.some((w) => w.start <= to && (w.end ?? Infinity) >= from);
        if (read && overlaps && (code === 'GIT_FAILED' || code === 'NOT_A_REPO')) {
          tolerated.push(r.url());
          console.log(`tolerated: ${r.status()} ${code} ${r.url()} during a submodule write`);
          return;
        }
        errors.push(`${r.status()} ${r.url()} ${r.request().postData() ?? ''}\n  → ${text}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const shot = async (name) => {
        // The left column scrolls: show the Submodules panel when it is on screen at all.
        if (await page.getByRole('region', { name: 'Submodules', exact: true }).isVisible()) await page.getByRole('region', { name: 'Submodules', exact: true }).scrollIntoViewIfNeeded();
        const f = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: f, animations: 'disabled' });
        console.log(`screenshot: ${f}`);
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=subs`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=subs`);

      const panel = page.getByRole('region', { name: 'Submodules', exact: true });
      const right = page.locator('[data-slot-name=right]');
      const menu = page.getByRole('menu');
      const toasts = page.getByRole('region', { name: /Notifications/ });
      const header = page.locator('header[aria-label="Repository summary"]');
      const badges = (p) => panel.getByRole('list', { name: `Status of ${p}`, exact: true }).getByRole('listitem').allTextContents();
      const rowMenu = async (p, item) => {
        await panel.getByRole('button', { name: `Actions for ${p}`, exact: true }).click();
        await menu.getByRole('menuitem', { name: item, exact: true }).click();
      };
      /** Runs `action` and waits for a new toast matching `text` (an earlier identical one may still be shown). */
      const toasted = async (text, action) => {
        const match = typeof text === 'string' ? toasts.getByText(text, { exact: true }) : toasts.getByText(text);
        const n = await match.count();
        await action();
        await match.nth(n).waitFor({ timeout: 30_000 });
      };

      /** After a submodule write: the header, every panel and slot are back to no error, the header showing its counts. */
      const recovered = async (what) => {
        await page.waitForFunction(() => document.querySelectorAll('header [role=alert], main [role=alert]').length === 0, null, { timeout: 15_000 });
        await header.getByText(/^\d+ staged$/).waitFor();
        check(true, `${scheme}: ${what}: the header and panels show no error`);
      };

      // 1. The panel and its badges.
      await panel.getByRole('heading', { name: 'Submodules (2)', exact: true }).waitFor();
      check(JSON.stringify(await badges('libs/c')) === JSON.stringify(['Uninitialised']), `${scheme}: libs/c is Uninitialised`);
      check(await panel.getByRole('list', { name: 'Status of libs/a', exact: true }).count() === 0, `${scheme}: libs/a has no status badge (cloned, at its pointer)`);
      await shot('panel');

      // 2. Initialize libs/c; the toast's Update clones it, the running toast counting seconds while the clone is held.
      await toasted(/^Initialized libs\/c/, () => rowMenu('libs/c', 'Initialize'));
      check(git('.', 'config', '--get', 'submodule.libs/c.url').trim() === repo.urls.c, `${scheme}: libs/c's url is registered`);
      await panel.getByRole('list', { name: 'Status of libs/c', exact: true }).getByText('Not cloned', { exact: true }).waitFor();
      world.hold(true);
      await toasts.getByRole('button', { name: 'Update', exact: true }).click();
      await toasts.getByText(/^Updating libs\/c… [1-9]\d* s$/).waitFor({ timeout: 10_000 });
      await shot('updating');
      world.hold(false);
      world.releaseHeld();
      await toasts.getByText('Updated libs/c', { exact: true }).waitFor({ timeout: 30_000 });
      check(existsSync(path.join(repo.dir, 'libs/c/c.txt')), `${scheme}: Update cloned libs/c`);
      check(git('libs/c', 'rev-parse', 'HEAD').trim() === git('.', 'rev-parse', 'HEAD:libs/c').trim(), `${scheme}: libs/c is at its recorded commit`);
      await panel.getByRole('list', { name: 'Status of libs/c', exact: true }).waitFor({ state: 'detached' });
      await recovered('after Update');

      // 3. Open libs/a as its own repo view: breadcrumb, graph, refs, Changes, its own submodule b.
      await panel.getByRole('button', { name: 'libs/a', exact: true }).dblclick();
      await page.getByRole('navigation', { name: 'Submodule path', exact: true }).getByRole('button', { name: 'subs', exact: true }).waitFor();
      await page.getByRole('heading', { level: 1, name: 'libs/a', exact: true }).waitFor();
      await page.getByText('add b', { exact: true }).first().waitFor();
      await page.getByRole('navigation', { name: 'Refs', exact: true }).getByRole('list', { name: 'Local branches', exact: true }).getByRole('button', { name: 'main', exact: true }).waitFor();
      await panel.getByRole('button', { name: 'b', exact: true }).waitFor();
      check(new URL(page.url()).searchParams.getAll('sub').join(',') === 'libs/a', `${scheme}: the URL names the submodule`);
      await shot('open');

      // 4. A commit in the submodule, made through the Changes panel.
      writeFileSync(path.join(repo.dir, 'libs/a/new.txt'), 'new\n');
      await right.getByRole('button', { name: 'Reload changes', exact: true }).click();
      const unstaged = right.getByRole('region', { name: 'Unstaged Files', exact: true });
      await unstaged.getByText('new.txt', { exact: true }).waitFor();
      await unstaged.getByRole('button', { name: 'Stage all', exact: true }).click();
      const commitBox = right.getByRole('region', { name: 'Commit message', exact: true });
      await commitBox.getByRole('textbox', { name: 'Summary', exact: true }).fill('Add new.txt');
      await commitBox.getByRole('button', { name: 'Commit changes to 1 file', exact: true }).click();
      await page.getByText('Add new.txt', { exact: true }).first().waitFor();
      check(git('libs/a', 'log', '-1', '--format=%s').trim() === 'Add new.txt', `${scheme}: the commit landed in libs/a`);
      const subHead = git('libs/a', 'rev-parse', 'HEAD').trim();

      // 5. Back to the parent: the pointer prompt commits libs/a's new pointer alone.
      await page.getByRole('button', { name: 'Back to subs', exact: true }).click();
      const prompt = page.getByRole('dialog', { name: 'Commit the new pointer for libs/a in subs?', exact: true });
      await prompt.waitFor();
      check(await prompt.getByRole('textbox', { name: 'Commit message', exact: true }).inputValue() === 'Update submodule libs/a', `${scheme}: the message is prefilled`);
      await shot('pointer-prompt');
      await prompt.getByRole('button', { name: 'Commit pointer', exact: true }).click();
      await prompt.waitFor({ state: 'detached' });
      await page.getByText('Update submodule libs/a', { exact: true }).first().waitFor();
      check(git('.', 'log', '-1', '--format=%s').trim() === 'Update submodule libs/a', `${scheme}: the parent committed the pointer`);
      check(git('.', 'rev-parse', 'HEAD:libs/a').trim() === subHead, `${scheme}: the committed pointer is libs/a's new HEAD`);
      check(git('.', 'status', '--porcelain').trim() === '', `${scheme}: the parent's working tree is clean`);
      await header.getByText('0 staged', { exact: true }).waitFor();
      check(await header.getByText('0 unstaged', { exact: true }).isVisible(), `${scheme}: the header shows no changes`);
      await shot('pointer-committed');

      // 6. Add… a new submodule libs/d.
      await panel.getByRole('button', { name: 'Add…', exact: true }).click();
      const add = page.getByRole('dialog', { name: 'Add a submodule', exact: true });
      await add.getByRole('textbox', { name: 'Url', exact: true }).fill(repo.urls.b);
      await add.getByRole('textbox', { name: 'Path', exact: true }).fill('libs/d');
      await shot('add-dialog');
      await toasted('Added the submodule libs/d', () => add.getByRole('button', { name: 'Add submodule', exact: true }).click());
      check(gm('submodule.libs/d.url') === repo.urls.b, `${scheme}: .gitmodules declares libs/d`);
      check(/^160000 /.test(git('.', 'ls-files', '-s', '--', 'libs/d')), `${scheme}: libs/d's gitlink is staged`);
      await panel.getByRole('list', { name: 'Status of libs/d', exact: true }).getByText('Added', { exact: true }).waitFor();

      // 7. Edit URL… of libs/d.
      await rowMenu('libs/d', 'Edit URL…');
      const edit = page.getByRole('dialog', { name: 'Edit the url of libs/d', exact: true });
      await edit.getByRole('textbox', { name: 'Url', exact: true }).fill(repo.urls.c);
      await toasted("Set libs/d's url", () => edit.getByRole('button', { name: 'Save url', exact: true }).click());
      check(gm('submodule.libs/d.url') === repo.urls.c, `${scheme}: .gitmodules has libs/d's new url`);
      check(git('.', 'config', '--get', 'submodule.libs/d.url').trim() === repo.urls.c, `${scheme}: the url was synced into the config`);

      // 8. Remove… libs/d: the confirmation, then (its gitlink is staged) the server's refusal and the second confirmation.
      await rowMenu('libs/d', 'Remove…');
      const confirm1 = page.getByRole('dialog', { name: 'Remove the submodule libs/d?', exact: true });
      await confirm1.waitFor();
      await shot('remove-confirm');
      allowedRefusals = 1;
      await toasted('libs/d has work removing it would throw away', () => confirm1.getByRole('button', { name: 'Remove submodule', exact: true }).click());
      check(existsSync(path.join(repo.dir, 'libs/d/b.txt')), `${scheme}: the refused remove changed nothing`);
      await recovered('after the refused Remove');
      await toasts.getByRole('button', { name: 'Review…', exact: true }).click();
      // sonner closes a toast whose action was clicked: wait for it to leave before the screenshot.
      await toasts.getByText('libs/d has work removing it would throw away', { exact: true }).waitFor({ state: 'detached' });
      const confirm2 = page.getByRole('dialog', { name: 'Discard the work in libs/d?', exact: true });
      await confirm2.getByText('A staged pointer change in this repository', { exact: true }).waitFor();
      check(await confirm2.getByText(/\.gitmodules will be staged with the removal, its unstaged changes included\./).isVisible(), `${scheme}: the edited url is named as staged with the removal`);
      await shot('remove-discard');
      await toasted('Removed libs/d', () => confirm2.getByRole('button', { name: 'Discard and remove', exact: true }).click());
      check(!existsSync(path.join(repo.dir, 'libs/d/b.txt')) && git('.', 'ls-files', '--', 'libs/d').trim() === '', `${scheme}: libs/d is removed`);
      check(gm('submodule.libs/d.path') === null, `${scheme}: .gitmodules no longer declares libs/d`);
      check(existsSync(path.join(repo.dir, '.git/modules/libs/d')), `${scheme}: .git/modules/libs/d is kept`);
      await panel.getByRole('heading', { name: 'Submodules (2)', exact: true }).waitFor();
      await recovered('after Remove');

      // 9. Phone: the panel from the graph toolbar, and a row's menu inside that dialog.
      await page.setViewportSize(PHONE);
      await page.goto(`${world.url}/?project=subs`);
      await page.getByRole('button', { name: 'Submodules', exact: true }).click();
      const phone = page.getByRole('dialog', { name: 'Submodules', exact: true });
      await phone.getByRole('button', { name: 'libs/a', exact: true }).waitFor();
      await shot('phone-panel');
      await phone.getByRole('button', { name: 'Actions for libs/a', exact: true }).click();
      await menu.waitFor();
      const items = await menu.getByRole('menuitem').allTextContents();
      check(JSON.stringify(items) === JSON.stringify(['Open', 'Update', 'Sync', 'Edit URL…', 'Remove…']), `${scheme}: the phone menu lists the submodule actions`);
      await shot('phone-menu');
      await page.keyboard.press('Escape');
      console.log(`note: ${scheme}: ${tolerated.length} transient read failure(s) tolerated during submodule writes`);
      check(errors.length === 0, `${scheme}: no console errors or unexpected ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
