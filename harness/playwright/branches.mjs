// The branches card's golden path on the `refs` world (branchSeed.mjs), then its dialogs and toasts screenshotted in
// light and dark at desktop and phone width (the phone ones over the Refs dialog) into out/branches/. Fails on a
// console error or a ≥400 response other than the two host URLs that 404 outside cc.
// Run: node harness/playwright/branches.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedBranches, XSS_BRANCH } from './branchSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'branches');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`branches: ${what}`); console.log(`ok: ${what}`); };

const world = await seedBranches();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const refs = page.getByRole('navigation', { name: 'Refs' });
    const refRow = (name) => page.locator(`[data-ref="${name}"]`);
    const nameButton = (name) => refRow(name).locator(`button[title="${name}"]`);
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const head = () => page.getByRole('group', { name: 'HEAD' }).textContent();
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async (q = 'project=refs') => {
      await page.goto(`${world.url}/?${q}`);
      await commitRow(o.tip).waitFor();
    };
    const menuItems = async () => {
      await menu.waitFor();
      return menu.getByRole('menuitem').allTextContents();
    };
    const closeMenu = async () => { await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' }); };
    const choose = async (...path) => {
      for (const item of path) await menu.last().getByRole('menuitem', { name: item, exact: true }).click();
    };
    const waitHead = (name) => page.waitForFunction((n) => document.querySelector('[aria-label="HEAD"]')?.textContent === n, name);

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();

    // 1. ahead / behind badges
    await refRow('refs/heads/feature/a').locator('[data-tracking]').waitFor();
    check(await refRow('refs/heads/feature/a').locator('[data-tracking]').textContent() === '↑1', 'feature/a shows ↑1 (ahead of origin)');
    check(await refRow('refs/heads/feature/b').locator('[data-tracking]').textContent() === '↓1', 'feature/b shows ↓1 (behind origin)');
    await shot('badges-light-desktop');

    // 2. double-click checks out
    await nameButton('refs/heads/feature/a').dblclick();
    await waitHead('feature/a');
    check(await head() === 'feature/a', 'double-click on feature/a checks it out (header)');
    await toast('Checked out feature/a').waitFor();
    check(git('symbolic-ref', '--short', 'HEAD') === 'feature/a', 'git agrees: HEAD is feature/a');

    // 3. create a branch from a commit, checked out
    await commitRow(o.tip).click({ button: 'right' });
    await choose('Create branch here…');
    await dialog.getByRole('textbox', { name: 'Branch name' }).fill('topic');
    check(await dialog.getByRole('checkbox', { name: 'Check out after creating' }).isChecked(), '"Check out after creating" is on by default');
    await shot('create-branch-light-desktop');
    await dialog.getByRole('button', { name: 'Create branch', exact: true }).click();
    await waitHead('topic');
    check(git('rev-parse', 'topic') === o.tip, 'topic was created at the commit and checked out');

    // 4. rename
    await nameButton('refs/heads/topic').click({ button: 'right' });
    await choose('Rename…');
    await dialog.getByRole('textbox').fill('topic2');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await waitHead('topic2');
    await refRow('refs/heads/topic').waitFor({ state: 'detached' });
    check(await refRow('refs/heads/topic2').count() === 1, 'rename: topic is topic2 in the refs panel');

    // 5. multi-select delete
    await nameButton('refs/heads/scratch1').click({ modifiers: ['ControlOrMeta'] });
    await nameButton('refs/heads/scratch2').click({ modifiers: ['ControlOrMeta'] });
    check(await refs.locator('[data-selected]').count() === 2, 'Ctrl/⌘-click selects two rows');
    await refRow('refs/heads/scratch1').click({ button: 'right' });
    await choose('Delete 2 branches…');
    const listed = await dialog.getByRole('list', { name: 'Local branches to delete' }).getByRole('listitem').allTextContents();
    check(listed.join(',') === 'scratch1,scratch2', `the delete dialog lists both (${listed})`);
    await shot('delete-two-light-desktop');
    await dialog.getByRole('button', { name: 'Delete 2 branches' }).click();
    await refRow('refs/heads/scratch1').waitFor({ state: 'detached' });
    check(await refRow('refs/heads/scratch2').count() === 0, 'both branches are gone');

    // 6. a free cc branch warns
    await nameButton('refs/heads/code-conductor/old').click({ button: 'right' });
    await choose('Delete code-conductor/old…');
    check(await dialog.getByRole('note').isVisible(), 'deleting code-conductor/old shows the cc warning');
    await shot('delete-cc-light-desktop');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });

    // 7. the checked-out cc branch has neither Delete nor Rename
    await nameButton('refs/heads/code-conductor/wt').click({ button: 'right' });
    const ccItems = await menuItems();
    check(!ccItems.some((x) => x.startsWith('Delete') || x === 'Rename…'), `code-conductor/wt (checked out in wt) offers no Delete or Rename (${ccItems.join(', ')})`);
    await closeMenu();

    // 8. drag origin/feature/b onto feature/b → Fast-forward (the filter keeps both rows in view)
    await refs.getByRole('textbox', { name: 'Filter refs' }).fill('feature/b');
    await refRow('refs/heads/main').waitFor({ state: 'detached' });
    const src = await refRow('refs/remotes/origin/feature/b').boundingBox();
    const dst = await refRow('refs/heads/feature/b').boundingBox();
    await page.mouse.move(src.x + 40, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 });
    await page.mouse.up();
    const dropItems = await menuItems();
    check(dropItems.join('|') === 'Fast-forward feature/b to origin/feature/b|Reset feature/b to origin/feature/b…', `the drop menu holds only Fast-forward and Reset (${dropItems.join(', ')})`);
    await shot('drop-menu-light-desktop');
    await choose('Fast-forward feature/b to origin/feature/b');
    await toast('Fast-forwarded feature/b').waitFor();
    await refRow('refs/heads/feature/b').locator('[data-tracking]').waitFor({ state: 'detached' });
    check(git('rev-parse', 'feature/b') === o.b2, 'feature/b was fast-forwarded to origin/feature/b');
    await refs.getByRole('textbox', { name: 'Filter refs' }).fill('');

    // 9. the hard-reset dialog
    await commitRow(o.base).click({ button: 'right' });
    await choose('Reset topic2 to this commit', 'Hard (discard changes)');
    const resetText = await dialog.textContent();
    check(/Discards 0 staged changes and 1 unstaged change \(untracked files stay\)/.test(resetText), 'the hard-reset dialog says what it discards');
    await shot('reset-hard-light-desktop');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    check(git('rev-parse', 'HEAD') === o.tip, 'Cancel left HEAD alone');

    // 10. annotated tag → push (loading, then success) → delete from origin
    await commitRow(o.two).click({ button: 'right' });
    await choose('Create tag here…');
    await dialog.getByRole('textbox', { name: 'Tag name' }).fill('rel-1');
    await dialog.getByRole('textbox', { name: /Message/ }).fill('first release');
    await dialog.getByRole('button', { name: 'Create annotated tag' }).click();
    await refRow('refs/tags/rel-1').waitFor();
    check(git('cat-file', '-t', 'rel-1') === 'tag', 'rel-1 is an annotated tag');
    world.cc.state.execHook = (body) => (body.argv.includes('push') ? 'hold' : undefined);
    await nameButton('refs/tags/rel-1').click({ button: 'right' });
    await choose('Push to origin');
    const held = await world.cc.nextHeld();
    world.cc.state.execHook = null;
    await toast('Pushing rel-1 to origin…').waitFor();
    await shot('push-loading-light-desktop');
    held.release();
    await toast('Pushed rel-1 to origin').waitFor();
    await shot('push-done-light-desktop');
    await nameButton('refs/tags/rel-1').click({ button: 'right' });
    await choose('Delete from origin…');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await toast('Deleted rel-1 from origin').waitFor();
    check(!git('ls-remote', '--tags', 'origin').includes('rel-1'), 'rel-1 is gone from origin, kept locally');

    // 11. a cherry-pick that conflicts offers Abort
    await commitRow(o.conflict).click({ button: 'right' });
    await choose('Cherry-pick commit');
    await toast('Cherry-pick stopped on conflicts').waitFor();
    await shot('pick-conflict-light-desktop');
    await toast('Cherry-pick stopped on conflicts').getByRole('button', { name: 'Abort' }).click();
    await toast('Cherry-pick aborted').waitFor();
    check(git('rev-parse', 'HEAD') === o.tip && git('status', '--porcelain', '--untracked-files=no') === 'M notes.md', 'Abort restored HEAD and the tree');

    // 12. untrusted text stays text
    check(await refRow(`refs/heads/${XSS_BRANCH}`).count() === 1, 'the branch named like markup is listed');
    check(await page.locator('img').count() === 0, 'no img element exists');

    // 13. the cc worktree's tab: moving its HEAD asks first
    await open('project=refs&worktree=wt');
    await waitHead('code-conductor/wt');
    await nameButton('refs/heads/feature/a').dblclick();
    await dialog.waitFor();
    check(/code-conductor's worktree on code-conductor\/wt/.test(await dialog.textContent()), 'double-click in the cc checkout shows the cc warning');
    await shot('cc-head-checkout-light-desktop');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    check(await head() === 'code-conductor/wt', 'Cancel leaves the header on code-conductor/wt');
    await commitRow(o.base).click({ button: 'right' });
    await choose('Reset code-conductor/wt to this commit', 'Soft (keep index and files)');
    await dialog.waitFor();
    check(await dialog.getByRole('button', { name: 'Reset anyway' }).isVisible(), 'a soft reset in the cc checkout shows the same warning');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    check(git('-C', path.join(world.repo.root, 'wt'), 'rev-parse', 'HEAD') === o.tip, 'nothing moved code-conductor/wt');

    // ---- every scheme and viewport: the dialogs and a toast ----
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await open();
        // The graph toolbar holds C4's Changes button and this card's Branch button: it wraps, never overflows.
        const toolbar = page.getByRole('region', { name: 'Commit graph', exact: true }).locator(':scope > div').first();
        const controls = ['Branch', 'Columns', 'Refresh graph', ...(vp === 'phone' ? ['Refs', 'Compare'] : [])];
        for (const name of controls) await toolbar.getByRole('button', { name, exact: true }).waitFor();
        if (vp === 'phone') await toolbar.getByRole('button', { name: /^Changes( \(\d+\))?$/ }).waitFor();
        const fits = await toolbar.evaluate((el) => {
          const w = document.documentElement.clientWidth;
          const out = [...el.querySelectorAll('button')].map((b) => [b.getAttribute('aria-label') || b.textContent, b.getBoundingClientRect()])
            .filter(([, r]) => r.left < 0 || r.right > w).map(([n, r]) => `${n} ${Math.round(r.left)}..${Math.round(r.right)}`);
          return { ok: el.scrollWidth <= el.clientWidth && !out.length, detail: `scroll ${el.scrollWidth}/${el.clientWidth} of ${w}; out: ${out.join(', ')}` };
        });
        const tb = await toolbar.boundingBox();
        const tbFile = path.join(outDir, `toolbar-${scheme}-${vp}.png`);
        await page.screenshot({ path: tbFile, clip: { x: 0, y: tb.y, width: size.width, height: tb.height }, animations: 'disabled' });
        console.log(`screenshot: ${tbFile}`);
        check(fits.ok, `${scheme} ${vp}: the graph toolbar (Changes, Branch, …) fits the width${fits.ok ? '' : `: ${fits.detail}`}`);
        const fromRefs = async (name, ...items) => {
          if (vp === 'phone') {
            await page.getByRole('button', { name: 'Refs', exact: true }).click();
            await page.getByRole('dialog').getByRole('navigation', { name: 'Refs' }).waitFor();
          }
          await nameButton(name).click({ button: 'right' });
          await choose(...items);
        };
        await fromRefs('refs/heads/code-conductor/old', 'Delete code-conductor/old…');
        await page.getByRole('dialog').getByRole('note').waitFor();
        await shot(`delete-cc-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        if (vp === 'phone') await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await commitRow(o.base).click({ button: 'right' });
        await choose('Reset topic2 to this commit', 'Hard (discard changes)');
        await shot(`reset-hard-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Branch', exact: true }).click();
        await dialog.getByRole('textbox', { name: 'Branch name' }).fill(`${XSS_BRANCH}-new`);
        await shot(`create-branch-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await open('project=refs&worktree=wt');
        await fromRefs('refs/heads/feature/a', 'Checkout');
        await page.getByRole('button', { name: 'Switch anyway' }).waitFor();
        await shot(`cc-head-checkout-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        if (vp === 'phone') await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
      }
    }

    check(errors.length === 0, `no console error and no unexpected ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
