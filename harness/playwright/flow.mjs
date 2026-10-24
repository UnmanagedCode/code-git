// The git-flow path on the `flow` world (flowSeed.mjs), in light then dark, each on a fresh seed, every step checked
// against git: Repository actions → Git-flow → Initialize… → Start feature `login` (a commit by the seed's git) → the
// branch's menu offers Finish feature…, whose dialog lists its steps → Finish: develop's merge, the branch gone, HEAD
// develop → Start release `1.0` → Finish with a tag message: the main and develop merges and tag `1.0` on main's →
// a conflicting feature: the FLOW_CONFLICT alert lists the file, nothing changed → a failing pre-merge-commit hook: the
// FLOW_INCOMPLETE alert shows the hook's output, and so does the activity entry's Show output. Screenshots (the finish
// dialog at 1280×800 and 390×844, the toolbar fitting the phone width) into out/flow/. Fails on a console error or a
// ≥400 response other than the two host URLs and the deliberate FLOW_CONFLICT and FLOW_INCOMPLETE refusals.
// Run: node harness/playwright/flow.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedFlow } from './flowSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'flow');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`flow: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seedFlow();
  const git = (...args) => world.repo.git(...args);
  const parents = (rev) => git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
  try {
    await withPage(async (page) => {
      const errors = [];
      const refusals = [];
      page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', async (r) => {
        if (r.status() < 400 || HOST_URLS.test(r.url())) return;
        const code = r.url().endsWith('/api/ops/flow.finish') ? (await r.json().catch(() => ({}))).code : null;
        if (code === 'FLOW_CONFLICT' || code === 'FLOW_INCOMPLETE') refusals.push(code);
        else errors.push(`${r.status()} ${r.url()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(VIEWPORTS.desktop);

      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const dialog = page.getByRole('dialog');
      const menu = page.getByRole('menu');
      const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
      const refRow = (name) => page.locator(`[data-ref="${name}"]`);
      const nameButton = (name) => refRow(name).locator(`button[title="${name}"]`);
      const waitHead = (name) => page.waitForFunction((n) => document.querySelector('[aria-label="HEAD"]')?.textContent === n, name);
      const refresh = () => page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
      const repoMenu = async (...items) => {
        await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
        for (const item of items) await menu.last().getByRole('menuitem', { name: item, exact: true }).click();
      };
      const branchMenu = async (ref) => {
        await refRow(ref).waitFor();
        await nameButton(ref).click({ button: 'right' });
        await menu.waitFor();
        return menu.getByRole('menuitem').allTextContents();
      };
      const exists = (ref) => { try { git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };

      await page.goto(`${world.url}/?project=flow`);
      await page.locator(`[data-row-id="${world.base}"]`).waitFor();

      // 1. Initialize
      await repoMenu('Git-flow', 'Initialize…');
      const init = dialog.filter({ hasText: 'Initialize git-flow' });
      await init.getByRole('textbox', { name: 'Production branch', exact: true }).waitFor();
      check(await init.getByRole('textbox', { name: 'Production branch', exact: true }).inputValue() === 'main', 'Initialize is prefilled with main');
      await shot('init-desktop');
      await init.getByRole('button', { name: 'Initialize', exact: true }).click();
      await toast('Git-flow initialized').waitFor();
      check(git('config', 'gitflow.branch.develop') === 'develop' && git('config', 'gitflow.prefix.feature') === 'feature/', 'git agrees: the gitflow.* keys are set');
      check(git('rev-parse', 'develop') === world.base, 'develop was created at main');

      // 2. Start feature login, then a commit on it
      await repoMenu('Git-flow', 'Start feature…');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('login');
      await dialog.getByRole('textbox', { name: 'Name (branch feature/login)', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await waitHead('feature/login');
      check(git('symbolic-ref', '--short', 'HEAD') === 'feature/login', 'git agrees: HEAD is feature/login');
      const loginTip = world.repo.commit({ 'login.txt': 'login\n' }, 'add login');
      await refresh();
      await page.locator(`[data-row-id="${loginTip}"]`).waitFor();

      // 3. The branch menu's Finish feature… and its dialog
      const items = await branchMenu('refs/heads/feature/login');
      check(items.includes('Finish feature…'), `the feature branch's menu offers Finish feature… (${items.join(' | ')})`);
      await menu.getByRole('menuitem', { name: 'Finish feature…', exact: true }).click();
      const finish = dialog.filter({ hasText: 'Finish feature/login?' });
      const steps = await finish.getByRole('list', { name: 'Steps', exact: true }).getByRole('listitem').allTextContents();
      check(steps.join(' | ') === 'Merge feature/login into develop (no fast-forward) | Delete feature/login; HEAD ends on develop', `the dialog lists the steps (${steps.join(' | ')})`);
      await shot('finish-feature-desktop');
      await page.setViewportSize(VIEWPORTS.phone);
      await shot('finish-feature-phone');
      await page.setViewportSize(VIEWPORTS.desktop);

      // 4. Finish
      await finish.getByRole('button', { name: 'Finish', exact: true }).click();
      await toast('Finished feature/login').waitFor();
      await waitHead('develop');
      const devMerge = git('rev-parse', 'develop');
      check(parents(devMerge).join(' ') === `${world.base} ${loginTip}`, 'develop gained a --no-ff merge of the feature tip');
      check(!exists('refs/heads/feature/login'), 'the feature branch is deleted');
      check(git('symbolic-ref', '--short', 'HEAD') === 'develop', 'HEAD is develop');

      // 5. A release, finished with a tag message
      await repoMenu('Git-flow', 'Start release…');
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('1.0');
      await dialog.getByRole('button', { name: 'Start', exact: true }).click();
      await waitHead('release/1.0');
      const relTip = world.repo.commit({ 'version.txt': '1.0\n' }, 'bump to 1.0');
      await refresh();
      await page.locator(`[data-row-id="${relTip}"]`).waitFor();
      await repoMenu('Git-flow', 'Finish release/1.0…');
      const rel = dialog.filter({ hasText: 'Finish release/1.0?' });
      const message = rel.getByRole('textbox', { name: 'Tag message', exact: true });
      check(await message.inputValue() === 'Release 1.0', 'the tag message is prefilled');
      await message.fill('Release 1.0\n\nThe first one.');
      await shot('finish-release-desktop');
      await rel.getByRole('button', { name: 'Finish', exact: true }).click();
      await toast('Finished release/1.0, tagged 1.0').waitFor();
      await waitHead('develop');
      const mainMerge = git('rev-parse', 'main');
      check(parents(mainMerge).join(' ') === `${world.base} ${relTip}`, 'main gained a --no-ff merge of the release tip');
      check(parents(git('rev-parse', 'develop')).join(' ') === `${devMerge} ${relTip}`, 'develop gained a --no-ff merge of the release tip');
      check(git('cat-file', '-t', 'refs/tags/1.0') === 'tag' && git('rev-parse', '1.0^{commit}') === mainMerge, 'annotated tag 1.0 on main\'s merge');
      check(git('cat-file', 'tag', '1.0').endsWith('Release 1.0\n\nThe first one.'), 'the tag message is the one typed');
      check(!exists('refs/heads/release/1.0'), 'the release branch is deleted');

      // 6. A conflicting feature: FLOW_CONFLICT lists the file; nothing changes
      git('checkout', '-q', '-b', 'feature/clash', 'develop');
      world.repo.commit({ 'app.txt': 'clash side\n' }, 'clash side');
      git('checkout', '-q', 'develop');
      world.repo.commit({ 'app.txt': 'develop side\n' }, 'develop side');
      const before = git('for-each-ref', '--format=%(refname) %(objectname)');
      await refresh();
      await branchMenu('refs/heads/feature/clash');
      await menu.getByRole('menuitem', { name: 'Finish feature…', exact: true }).click();
      const clash = dialog.filter({ hasText: 'Finish feature/clash?' });
      await clash.getByRole('button', { name: 'Finish', exact: true }).click();
      const files = clash.getByRole('list', { name: 'Conflicting files', exact: true });
      await files.waitFor();
      check(await files.textContent() === 'app.txt', 'the FLOW_CONFLICT alert lists app.txt');
      await shot('finish-conflict-desktop');
      check(git('for-each-ref', '--format=%(refname) %(objectname)') === before && !exists('MERGE_HEAD'), 'git agrees: nothing changed');
      await clash.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });

      // 7. A failing pre-merge-commit hook: FLOW_INCOMPLETE shows its output, and so does the activity entry
      git('checkout', '-q', '-b', 'feature/hooked', 'develop');
      world.repo.commit({ 'hooked.txt': 'h\n' }, 'hooked');
      world.repo.hook('pre-merge-commit', '#!/bin/sh\necho "HOOK-SAYS-NO: tests failed"\nexit 1\n');
      await refresh();
      await waitHead('feature/hooked');
      await repoMenu('Git-flow', 'Finish feature/hooked…');
      const hooked = dialog.filter({ hasText: 'Finish feature/hooked?' });
      await hooked.getByRole('button', { name: 'Finish', exact: true }).click();
      const alert = hooked.getByRole('alert');
      await alert.filter({ hasText: 'HOOK-SAYS-NO: tests failed' }).waitFor();
      check((await alert.textContent()).includes('the finish stopped at its merge step'), 'the FLOW_INCOMPLETE alert names the merge step and shows the hook output');
      await shot('finish-hook-desktop');
      check(exists('refs/heads/feature/hooked'), 'the branch is kept');
      await hooked.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      // The merge exits 1, which git's merge contract allows (integrate.merge reads it): its entry is `ok`, its output kept.
      const entry = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem', { name: 'flow.finish ok', exact: true })
        .filter({ hasText: "--no-ff --no-edit -m Merge branch 'feature/hooked'" }).first();
      await entry.getByRole('button', { name: 'Show output', exact: true }).click();
      await entry.locator('pre').filter({ hasText: 'HOOK-SAYS-NO: tests failed' }).waitFor();
      check(true, 'the activity entry\'s Show output has the hook output');
      await shot('activity-hook-desktop');

      // 8. The toolbar fits the phone width with the Repository actions button
      await page.setViewportSize(VIEWPORTS.phone);
      const toolbar = page.getByRole('region', { name: 'Commit graph', exact: true }).locator(':scope > div').first();
      await toolbar.getByRole('button', { name: 'Repository actions', exact: true }).waitFor();
      const fits = await toolbar.evaluate((el) => {
        const w = document.documentElement.clientWidth;
        const out = [...el.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > w; });
        return el.scrollWidth <= el.clientWidth && out.length === 0;
      });
      check(fits, 'the graph toolbar, Repository actions included, fits 390×844');
      await shot('toolbar-phone');

      check(refusals.join(',') === 'FLOW_CONFLICT,FLOW_INCOMPLETE', `the only refusals are the deliberate ones (${refusals.join(', ')})`);
      check(errors.length === 0, `no console errors or failed responses${errors.length ? `: ${errors.join('; ')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
console.log('flow: all checks passed');
