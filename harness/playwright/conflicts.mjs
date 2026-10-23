// The merge/rebase card's conflict tool on the `seq` world (sequenceSeed.mjs), every step checked against git: a merge
// of feature/merge stops on app.txt (two regions) and gone.txt (deleted here, edited there) → the tool from the app.txt
// row (light/dark × desktop/phone screenshots) → a line and a whole conflict picked, conflict navigation, typing in the
// Output → Save (the worktree only: the stages stay) → Mark resolved (the tool moves to gone.txt's notice) → Take
// incoming from the row's menu → Continue commits the merge → a binary conflict's notice and Take current. Fails on a
// console error or a ≥400 response other than the two host URLs.
// Run: node harness/playwright/conflicts.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { appWith, seedSequence } from './sequenceSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'c7');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`conflicts: ${what}`); console.log(`ok: ${what}`); };

const world = await seedSequence();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
const disk = (f) => readFileSync(path.join(world.repo.dir, f), 'utf8');
const unmerged = () => git('ls-files', '-u');
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const refRow = (name) => page.locator(`[data-ref="${name}"]`);
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const tool = page.getByRole('region', { name: 'Merge tool', exact: true });
    const output = tool.getByRole('textbox', { name: 'Output', exact: true });
    const box = (name) => tool.getByRole('checkbox', { name, exact: true });
    const panel = page.locator('[data-slot-name=right]');
    const unstagedRow = (p) => panel.getByRole('region', { name: 'Unstaged Files', exact: true }).locator(`[data-path="${p}"]`);
    const banner = page.getByRole('status', { name: 'Operation in progress', exact: true });
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const choose = async (...items) => { for (const item of items) await menu.last().getByRole('menuitem', { name: item, exact: true }).click(); };
    const dragRef = async (from, to) => {
      const src = await refRow(from).boundingBox();
      const dst = await refRow(to).boundingBox();
      await page.mouse.move(src.x + 40, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 });
      await page.mouse.up();
    };

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto(`${world.url}/?project=seq`);
    await commitRow(o.work).first().waitFor();

    // 1. the merge stops on app.txt (both modified) and gone.txt (deleted here, edited there)
    await dragRef('refs/heads/feature/merge', 'refs/heads/main');
    await choose('Merge feature/merge into main');
    await toast('The merge stopped on conflicts').waitFor();
    check(/\tapp\.txt$/m.test(unmerged()) && /\tgone\.txt$/m.test(unmerged()), 'git: app.txt and gone.txt are unmerged');

    // 2. the tool from the app.txt row: two conflicts, panes named after the branches
    await banner.waitFor();
    await unstagedRow('app.txt').click();
    await output.waitFor();
    check(await tool.getByRole('region', { name: 'Current: main', exact: true }).count() === 1 && await tool.getByRole('region', { name: 'Incoming: feature/merge', exact: true }).count() === 1, 'the panes are Current (main) and Incoming (feature/merge)');
    check(await tool.getByText('Conflict 1 of 2 · 2 unresolved', { exact: true }).count() === 1, 'two conflicts, both unresolved');
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await output.waitFor();
        await shot(`conflicts-tool-${scheme}-${vp}`);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(VIEWPORTS.desktop);

    // 3. picks: line 5 from incoming (conflict 1), all of conflict 2 from current; navigation; typing in Output
    await box('Take line 5 from incoming').check();
    await box('Take conflict 2 from current').check();
    const picked = appWith([1, 'L1 mine'], [5, 'L5 merge'], [10, 'L10 main'], [15, 'L15 main']);
    check(await output.inputValue() === picked, 'the Output holds the picked lines and no markers');
    await tool.getByRole('button', { name: 'Previous conflict', exact: true }).click();
    check(await tool.getByText(/^Conflict 1 of 2/).count() === 1, 'Previous conflict moves to conflict 1');
    await output.press('Alt+ArrowDown');
    check(await tool.getByText(/^Conflict 2 of 2/).count() === 1, 'Alt+↓ moves to conflict 2');
    await output.press('Control+End');
    await output.type('L21 typed\n');
    check(await output.inputValue() === `${picked}L21 typed\n`, 'typing in Output edits it');
    await shot('conflicts-picked-light-desktop');

    // 4. Save writes the worktree only; Mark resolved stages it and moves on to gone.txt
    await tool.getByRole('button', { name: 'Save', exact: true }).click();
    await toast('Saved app.txt').waitFor();
    check(disk('app.txt') === `${picked}L21 typed\n` && /\tapp\.txt$/m.test(unmerged()), 'git: the file is written, its stages are still there');
    await tool.getByRole('button', { name: 'Mark resolved', exact: true }).click();
    await toast('Marked app.txt resolved').waitFor();
    check(!/\tapp\.txt$/m.test(unmerged()) && git('show', ':app.txt') === `${picked}L21 typed`, 'git: app.txt is resolved with the saved content');
    await tool.getByRole('note').waitFor();
    check(/deleted on the other/.test(await tool.getByRole('note').textContent()), 'the tool moved to gone.txt: the modify/delete notice');
    await shot('conflicts-one-sided-light-desktop');
    await tool.getByRole('button', { name: 'Close merge tool', exact: true }).click();
    await tool.waitFor({ state: 'detached' });

    // 5. Take incoming from gone.txt's row menu: the edited file comes back, staged; then Continue commits the merge
    await unstagedRow('gone.txt').click({ button: 'right' });
    await choose('Take incoming (feature/merge)');
    await dialog.getByRole('button', { name: 'Take incoming', exact: true }).click();
    await toast(/^Took incoming/).waitFor();
    check(unmerged() === '' && disk('gone.txt') === 'gone, edited\n', 'git: gone.txt taken from feature/merge, nothing unmerged');
    await banner.getByText('Conflicts resolved: Continue', { exact: true }).waitFor();
    await banner.getByRole('button', { name: 'Continue', exact: true }).click();
    await toast('Merge committed').waitFor();
    check(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1).join(' ') === `${o.work} ${o.merge2}`, 'git: the merge commit of main and feature/merge');

    // 6. a binary conflict: the notice, Take current
    await dragRef('refs/heads/feature/bin', 'refs/heads/main');
    await choose('Merge feature/bin into main');
    await toast('The merge stopped on conflicts').waitFor();
    await unstagedRow('data.bin').click();
    await tool.getByRole('note').waitFor();
    check(/Binary file/.test(await tool.getByRole('note').textContent()), 'a binary conflict shows its notice');
    await shot('conflicts-binary-light-desktop');
    const ours = git('rev-parse', 'HEAD:data.bin');
    await tool.getByRole('button', { name: 'Take current (main)', exact: true }).click();
    await dialog.getByRole('button', { name: 'Take current', exact: true }).click();
    await toast(/^Took current/).waitFor();
    check(unmerged() === '' && git('rev-parse', ':data.bin') === ours, 'git: data.bin is main\'s version, staged');

    check(errors.length === 0, `no console error and no ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
