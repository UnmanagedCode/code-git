// The merge/rebase card's in-progress path on the `seq` world (sequenceSeed.mjs), every step checked against git: a
// rebase pull stops on conflicts and stays in progress → the Changes banner → a reload still shows it → Abort… (confirmed)
// puts main back → a conflicting cherry-pick → the file resolved and staged → Continue commits it. Then the banner in
// light and dark at desktop and phone width (the phone one in the Changes dialog) into out/c7/. Fails on a console error
// or a ≥400 response other than the two host URLs.
// Run: node harness/playwright/operations.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { appWith, seedSequence } from './sequenceSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'c7');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`operations: ${what}`); console.log(`ok: ${what}`); };

const world = await seedSequence();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
const exists = (ref) => { try { git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };
const rebasing = () => exists('REBASE_HEAD');
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const toolbar = page.getByRole('group', { name: 'Remote', exact: true });
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const banner = page.getByRole('status', { name: 'Operation in progress', exact: true });
    const bannerButton = (name) => banner.getByRole('button', { name, exact: true });
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async () => {
      await page.goto(`${world.url}/?project=seq`);
      await commitRow(git('rev-parse', 'HEAD')).first().waitFor();
    };
    const choose = async (...items) => {
      for (const item of items) await menu.last().getByRole('menuitem', { name: item, exact: true }).click();
    };
    /** Waits for `locator` to be the one visible match (`waitFor` is strict) and checks `what` by it. */
    const appears = async (locator, what) => { await locator.waitFor().catch(() => check(false, what)); check(true, what); };
    /** Holds every `graph.refs` request until the returned `release()`. The banner's state comes from `commit.state` but
     *  its "onto origin/main" from the refs (`commitLabel`), a later request: until it lands the title names the oid. */
    const holdRefs = async () => {
      let open;
      const gate = new Promise((r) => { open = r; });
      const hold = async (route) => { await gate; await route.fallback(); };
      await page.route('**/api/ops/graph.refs', hold);
      return async () => { open(); await page.unroute('**/api/ops/graph.refs', hold); };
    };

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();

    // 1. a rebase pull stops on conflicts: the toast, the rebase in progress in git, the banner with its step. The refs
    // are held until the title's wait has started, so the title is checked across their arrival every run.
    let releaseRefs = await holdRefs();
    await toolbar.getByRole('button', { name: 'Pull options', exact: true }).click();
    await choose('Pull (rebase)');
    await toast('The pull stopped on conflicts').waitFor();
    check(rebasing() && git('ls-files', '-u').includes('app.txt'), 'git: the rebase is in progress, app.txt unmerged');
    await banner.waitFor();
    const title = 'Rebasing main onto origin/main (step 1 of 2)';
    let shown = appears(banner.getByText(title, { exact: true }), `the banner reads "${title}"`);
    await releaseRefs();
    await shown;
    check(await bannerButton('Continue').isDisabled(), 'Continue is disabled while app.txt is conflicted');
    check(await page.getByText(/^Detached HEAD at/).count() === 0, 'no detached-HEAD banner during the rebase');
    await shot('operations-rebase-pull-light-desktop');

    // 2. a reload shows the same banner: the state is git's, not the page's (the refs held again)
    releaseRefs = await holdRefs();
    await page.reload();
    await banner.waitFor();
    shown = appears(banner.getByText(title, { exact: true }), 'the banner is still there after a reload');
    await releaseRefs();
    await shown;

    // 3. Abort… asks first; Cancel keeps the rebase, Confirm puts main back
    await bannerButton('Abort…').click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    check(rebasing(), 'Cancel left the rebase in progress');
    await bannerButton('Abort…').click();
    await dialog.getByRole('button', { name: 'Abort rebase', exact: true }).click();
    await toast('Rebase aborted').waitFor();
    await banner.waitFor({ state: 'detached' });
    check(!rebasing() && git('rev-parse', 'HEAD') === o.work && git('symbolic-ref', 'HEAD') === 'refs/heads/main', 'git: no rebase, main back at its own tip');
    check(git('status', '--porcelain', '--untracked-files=no') === '', 'git: a clean tree');

    // 4. a conflicting cherry-pick: the banner names it; the file resolved by hand, staged, then Continue commits it
    await commitRow(o.conflict).click({ button: 'right' });
    await choose('Cherry-pick commit');
    await toast('Cherry-pick stopped on conflicts').waitFor();
    // The right-click selected the commit (its details take the right slot): Esc clears it, Changes is back.
    await page.keyboard.press('Escape');
    await banner.waitFor();
    await appears(banner.getByText(`Cherry-picking ${o.conflict.slice(0, 7)} conflicting change`, { exact: true }), 'the banner names the cherry-pick');
    check(exists('CHERRY_PICK_HEAD'), 'git: the cherry-pick is in progress');

    // ---- the banner in every scheme and viewport (the phone one in the Changes dialog) ----
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        if (vp === 'phone') {
          await page.getByRole('button', { name: /^Changes( \(\d+\))?$/ }).click();
          await dialog.getByRole('status', { name: 'Operation in progress', exact: true }).waitFor();
        } else {
          await banner.waitFor();
        }
        await shot(`operations-cherry-pick-${scheme}-${vp}`);
        if (vp === 'phone') {
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });
        }
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(VIEWPORTS.desktop);

    writeFileSync(path.join(world.repo.dir, 'app.txt'), appWith([1, 'L1 mine'], [5, 'L5 main'], [10, 'L10 both'], [15, 'L15 main']));
    await page.getByRole('button', { name: 'Reload changes', exact: true }).click();
    const unstaged = page.getByRole('region', { name: 'Unstaged Files', exact: true });
    await unstaged.locator('[data-path="app.txt"]').hover();
    await unstaged.getByRole('button', { name: 'Stage app.txt', exact: true }).click();
    await banner.getByText('Conflicts resolved: Continue', { exact: true }).waitFor();
    check(git('ls-files', '-u') === '', 'git: app.txt is staged, nothing unmerged');
    check(!(await bannerButton('Continue').isDisabled()), 'Continue is enabled once nothing is conflicted');
    await bannerButton('Continue').click();
    await toast('Cherry-pick committed').waitFor();
    await banner.waitFor({ state: 'detached' });
    check(!exists('CHERRY_PICK_HEAD') && git('rev-parse', 'HEAD~1') === o.work, 'git: the cherry-pick is committed on main');
    check(git('log', '-1', '--format=%s') === 'conflicting change' && git('show', 'HEAD:app.txt').includes('L10 both'), 'git: with the resolution and the picked message');

    check(errors.length === 0, `no console error and no ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
