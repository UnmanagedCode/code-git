// The merge/rebase card's start path on the `seq` world (sequenceSeed.mjs), every step checked against git: the exact
// drop menu onto HEAD's branch → a drag merge that fast-forwards → a no-ff drag merge → a squash that pre-fills the commit
// box, committed → checkout topic → the branch menu's Rebase topic onto side → Rebase 2 commits onto… through its dialog.
// Then the drop menu, the branch menu and the dialog in light and dark at desktop and phone width into out/c7/. Fails on a
// console error or a ≥400 response other than the two host URLs.
// Run: node harness/playwright/merge.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedSequence } from './sequenceSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'c7');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`merge: ${what}`); console.log(`ok: ${what}`); };

const world = await seedSequence();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
const exists = (ref) => { try { git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };
const parents = (rev = 'HEAD') => git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const refRow = (name) => page.locator(`[data-ref="${name}"]`);
    const nameButton = (name) => refRow(name).locator(`button[title="${name}"]`);
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const panel = page.locator('[data-slot-name=right]');
    const commitBox = panel.getByRole('region', { name: 'Commit message', exact: true });
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async () => {
      await page.goto(`${world.url}/?project=seq`);
      await commitRow(git('rev-parse', 'HEAD')).first().waitFor();
    };
    const menuItems = async () => { await menu.waitFor(); return menu.last().getByRole('menuitem').allTextContents(); };
    const closeMenu = async () => { await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' }); };
    const choose = async (...items) => { for (const item of items) await menu.last().getByRole('menuitem', { name: item, exact: true }).click(); };
    const dragRef = async (from, to) => {
      const src = await refRow(from).boundingBox();
      const dst = await refRow(to).boundingBox();
      await page.mouse.move(src.x + 40, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    /** Selects rows a then b (Shift); on a phone a click opens the details dialog (just after it), which is closed again. */
    const selectTwo = async (a, b, phone = false) => {
      for (const [oid, modifiers] of [[a, []], [b, ['Shift']]]) {
        await commitRow(oid).click({ modifiers });
        if (!phone) continue;
        const opened = await dialog.waitFor({ timeout: 2000 }).then(() => true, () => false);
        if (opened) { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); }
      }
    };
    const waitHead = (name) => page.waitForFunction((n) => document.querySelector('[aria-label="HEAD"]')?.textContent === n, name);

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();

    // 1. drop feature/ff onto main (HEAD): the exact menu, then Merge → a fast-forward
    await dragRef('refs/heads/feature/ff', 'refs/heads/main');
    const items = await menuItems();
    const want = ['Merge feature/ff into main', 'Merge feature/ff into main (no fast-forward)', 'Squash feature/ff into main', 'Rebase main onto feature/ff', 'Interactive rebase main onto feature/ff…', 'Fast-forward main to feature/ff', 'Reset main to feature/ff'];
    check(items.join('|') === want.join('|'), `the drop menu onto HEAD's branch is exactly ${want.join(', ')} (${items.join(', ')})`);
    await shot('merge-drop-menu-light-desktop');
    await choose('Merge feature/ff into main');
    await toast('Fast-forwarded main to feature/ff').waitFor();
    check(git('rev-parse', 'main') === o.ff && parents('main').length === 1, 'git: main fast-forwarded to feature/ff, no merge commit');

    // 2. drop picks onto main → Merge (no fast-forward): a merge commit named after the branch
    await dragRef('refs/heads/picks', 'refs/heads/main');
    await choose('Merge picks into main (no fast-forward)');
    await toast('Merged picks into main').waitFor();
    check(parents('main').join(' ') === `${o.ff} ${o.p3}` && git('log', '-1', '--format=%s', 'main') === "Merge branch 'picks'", 'git: a merge commit of ff and p3, "Merge branch \'picks\'"');

    // 3. drop topic onto main → Squash: the changes staged, the commit box pre-filled, then committed from it
    const before = git('rev-parse', 'main');
    await dragRef('refs/heads/topic', 'refs/heads/main');
    await choose('Squash topic into main');
    await toast('Squashed topic into the index').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-slot-name=right] input[aria-label=Summary]')?.value === 'Squashed commit of the following:');
    check(git('diff', '--cached', '--name-only') === 't1.txt\nt2.txt\nt3.txt\nt4.txt' && git('rev-parse', 'main') === before, 'git: t1…t4 staged, main unmoved');
    check(!exists('MERGE_HEAD'), 'git: no MERGE_HEAD (a squash is no merge in progress)');
    check(/commit [0-9a-f]{40}/.test(await commitBox.getByRole('textbox', { name: 'Description', exact: true }).inputValue()), 'the description lists the squashed commits');
    await shot('merge-squash-light-desktop');
    await commitBox.getByRole('button', { name: 'Commit changes to 4 files', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot-name=right] input[aria-label=Summary]')?.value === '');
    check(git('log', '-1', '--format=%s') === 'Squashed commit of the following:' && parents().join(' ') === before, 'git: one commit on main with the squash message');

    // 4. checkout topic, then the branch menu's Rebase topic onto side
    await nameButton('refs/heads/topic').dblclick();
    await waitHead('topic');
    await nameButton('refs/heads/side').click({ button: 'right' });
    await shot('merge-branch-menu-light-desktop');
    await choose('Rebase topic onto side');
    await toast('Rebased topic onto side').waitFor();
    check(git('rev-parse', 'topic~6') === o.side && git('symbolic-ref', 'HEAD') === 'refs/heads/topic', 'git: topic\'s six commits replayed onto side');

    // 5. the two newest commits of topic → Rebase 2 commits onto… → feature/ff
    const t4 = git('rev-parse', 'topic');
    const t3 = git('rev-parse', 'topic~1');
    await selectTwo(t4, t3);
    await commitRow(t3).click({ button: 'right' });
    await choose('Rebase 2 commits onto…');
    await dialog.getByRole('combobox', { name: 'Onto', exact: true }).selectOption('refs/heads/feature/ff');
    await shot('merge-rebase-onto-light-desktop');
    await dialog.getByRole('button', { name: 'Rebase', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast('Rebased topic onto feature/ff').waitFor();
    check(git('rev-parse', 'topic~2') === o.ff && git('log', '--format=%s', '-2', 'topic') === 't4\nt3', 'git: only t3 and t4 are on topic, onto feature/ff');
    check(git('ls-tree', '--name-only', 'topic').split('\n').includes('t4.txt') && !git('ls-tree', '--name-only', 'topic').split('\n').includes('t1.txt'), 'git: t4.txt kept, t1.txt left out');

    // ---- every scheme and viewport: the branch menu and the dialog (desktop: also the drop menu) ----
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await open();
        if (vp === 'desktop') {
          await dragRef('refs/heads/side', 'refs/heads/topic');
          await menuItems();
          await shot(`merge-drop-menu-${scheme}-${vp}`);
          await closeMenu();
        }
        if (vp === 'phone') {
          await page.getByRole('button', { name: 'Refs', exact: true }).click();
          await page.getByRole('dialog').getByRole('navigation', { name: 'Refs', exact: true }).waitFor();
        }
        await nameButton('refs/heads/side').click({ button: 'right' });
        await menuItems();
        await shot(`merge-branch-menu-${scheme}-${vp}`);
        await closeMenu();
        if (vp === 'phone') { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); }
        const tip = git('rev-parse', 'topic');
        await selectTwo(tip, git('rev-parse', 'topic~1'), vp === 'phone');
        await commitRow(tip).click({ button: 'right' });
        await choose('Rebase 2 commits onto…');
        await dialog.getByRole('combobox', { name: 'Onto', exact: true }).waitFor();
        await shot(`merge-rebase-onto-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
      }
    }

    check(errors.length === 0, `no console error and no ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
