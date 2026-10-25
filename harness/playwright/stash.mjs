// The stash path, asserted on the seeded `stash` project (seed.mjs): save selected files from the Changes panel (the
// graph and the refs panel show the new stash), the header's Undo and Redo of that save, the stash's view switch, one
// file applied from the details, a rename (to the top), lines stashed from the diff, pop, drop (cancelled, then
// confirmed; undone and redone through its confirmation), a whole stash applied (undone, redone, undone again), a branch
// from a stash, and the dialogs on a phone. Each step is checked against git itself. Runs in light then dark, each on a
// fresh seed; screenshots go to out/stash/.
// Run: node harness/playwright/stash.mjs   (needs `npm run prepare` first, for frontend/dist)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticEnv } from '../../tests/_git.js';
import { BROWSER } from './resolve.mjs';
import { toasted as waitForToast } from './toasts.mjs';
import { seed, STAGE_BASE, STAGE_EDITED } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'stash');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const check = (cond, what) => { if (!cond) throw new Error(`stash: ${what}`); console.log(`ok: ${what}`); };
const lines = (ls) => `${ls.join('\n')}\n`;

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  const repo = world.stash;
  const git = (...args) => execFileSync('git', ['-C', repo.dir, ...args], { env: hermeticEnv(repo.home) }).toString();
  /** [{oid, subject}] newest first. */
  const stashes = () => git('stash', 'list', '--format=%H %gs').split('\n').filter(Boolean).map((l) => ({ oid: l.slice(0, 40), subject: l.slice(41) }));
  const file = (p) => (existsSync(path.join(repo.dir, p)) ? readFileSync(path.join(repo.dir, p), 'utf8') : null);
  const base = git('rev-parse', 'HEAD').trim();
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const shot = async (name) => {
        const f = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: f, animations: 'disabled' });
        console.log(`screenshot: ${f}`);
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=stash`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=stash`);

      const right = page.locator('[data-slot-name=right]');
      const row = (id) => page.locator(`[data-row-id="${id}"]`);
      const refsStashes = page.getByRole('navigation', { name: 'Refs', exact: true }).getByRole('list', { name: 'Stashes', exact: true });
      const diff = page.getByRole('region', { name: 'Diff', exact: true });
      const menu = page.getByRole('menu');
      const toasted = (text, action) => waitForToast(page, text, action);
      const saveDialog = page.getByRole('dialog', { name: 'Stash changes', exact: true });
      const header = page.getByRole('banner', { name: 'Repository summary', exact: true });
      const undoButton = header.getByRole('button', { name: 'Undo', exact: true });
      const redoButton = header.getByRole('button', { name: 'Redo', exact: true });
      /** Waits until the header's `name` button (Undo / Redo) is enabled and titled after `label` (its slot's label). */
      const slotReady = (name, label) => page.waitForFunction(([n, l]) => {
        const b = document.querySelector(`header[aria-label="Repository summary"] button[aria-label="${n}"]`);
        return !!b && !b.disabled && !!b.getAttribute('title')?.startsWith(`${n} ${l} (`);
      }, [name, label]);
      const rowMenu = async (id, item) => {
        await row(id).click({ button: 'right' });
        await menu.getByRole('menuitem', { name: item, exact: true }).click();
      };
      /** Back to the Changes panel: a stash selected in the graph puts its details in the right slot. */
      const showChanges = async () => {
        await row('wip:').click();
        await right.getByRole('button', { name: 'Stash changes…', exact: true }).waitFor();
      };
      // The open diff's file list is in the right slot: the stash's details when it is selected, else the Changed files panel.
      const viewList = right.getByRole('listbox', { name: 'Changed files', exact: true });
      const viewFiles = () => viewList.getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));

      // 1. Save selected files (the staged lib/util.js and the untracked todo.txt) from the Changes panel.
      await right.getByRole('button', { name: 'Stash changes…', exact: true }).click();
      await saveDialog.waitFor();
      await saveDialog.getByRole('textbox', { name: 'Stash message', exact: true }).fill('selected files');
      await saveDialog.getByRole('radio', { name: 'Selected files', exact: true }).check();
      await saveDialog.getByRole('checkbox', { name: /lib\/util\.js$/ }).check();
      await saveDialog.getByRole('checkbox', { name: /todo\.txt$/ }).check();
      check(await saveDialog.getByRole('checkbox', { name: 'Include untracked files', exact: true }).isChecked(), `${scheme}: ticking the untracked file ticks Include untracked`);
      await shot('save-dialog');
      await toasted('Stashed as stash@{0}', () => saveDialog.getByRole('button', { name: 'Stash', exact: true }).click());
      await saveDialog.waitFor({ state: 'detached' });
      const saved = stashes()[0];
      check(saved.subject === 'On main: selected files' && stashes().length === 3, `${scheme}: git lists the new stash on top`);
      check(file('todo.txt') === null && file('lib/util.js') === 'export const util = 1;\n' && file('src/app.js') === lines(STAGE_EDITED), `${scheme}: only the selected files left the worktree`);
      check(git('show', `${saved.oid}^3:todo.txt`) === 'todo\n', `${scheme}: the untracked file is in the stash`);
      await row(`stash:${saved.oid}`).waitFor();
      const ids = await page.locator('[data-row-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id')));
      check(ids.indexOf(`stash:${saved.oid}`) !== -1 && ids.indexOf(`stash:${saved.oid}`) < ids.indexOf(base), `${scheme}: the graph shows the stash row above its base`);
      await refsStashes.getByText('On main: selected files').waitFor();
      check(true, `${scheme}: the refs panel lists the stash`);
      await shot('saved');

      // 1b. The header's Undo takes the save back: the files return to the Changes panel, the stash row goes. Redo
      // stores the same stash again. Neither asks.
      await slotReady('Undo', 'Stash “selected files”');
      await toasted('Undid Stash “selected files”', () => undoButton.click());
      await row(`stash:${saved.oid}`).waitFor({ state: 'detached' });
      check(!stashes().some((s) => s.oid === saved.oid) && stashes().length === 2, `${scheme}: Undo dropped the save's stash`);
      check(file('todo.txt') === 'todo\n' && git('diff', '--cached', '--name-only').split('\n').includes('lib/util.js'), `${scheme}: Undo put todo.txt back and lib/util.js staged again`);
      await right.getByRole('region', { name: 'Staged Files', exact: true }).getByRole('option', { name: /lib\/util\.js/ }).waitFor();
      await right.getByRole('region', { name: 'Unstaged Files', exact: true }).getByRole('option', { name: /todo\.txt/ }).waitFor();
      check(true, `${scheme}: the Changes panel lists both files again`);
      await shot('save-undone');
      await slotReady('Redo', 'Stash “selected files”');
      await toasted('Redid Stash “selected files”', () => redoButton.click());
      await row(`stash:${saved.oid}`).waitFor();
      check(stashes()[0].oid === saved.oid && file('todo.txt') === null, `${scheme}: Redo stored the same stash and took the files again`);

      // 2. View the stash: the switch's three views list what each part holds.
      await rowMenu(`stash:${saved.oid}`, 'View changes');
      const sw = diff.getByRole('radiogroup', { name: 'Stash view', exact: true });
      await sw.waitFor();
      check(JSON.stringify(await sw.locator('label').allTextContents()) === JSON.stringify(['All changes', 'Staged', 'Untracked']), `${scheme}: the switch offers All changes / Staged / Untracked`);
      check(await diff.getByRole('combobox', { name: 'Compare with parent' }).count() === 0, `${scheme}: no parent select for a stash`);
      await viewList.getByRole('option', { name: /lib\/util\.js/ }).waitFor();
      check(JSON.stringify(await viewFiles()) === '["lib/util.js"]', `${scheme}: All changes lists lib/util.js`);
      await shot('view-all');
      await sw.getByText('Staged', { exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Diff source"]')?.textContent?.length);
      await viewList.getByRole('option', { name: /lib\/util\.js/ }).waitFor();
      check(await sw.getByRole('radio', { name: 'Staged', exact: true }).isChecked(), `${scheme}: Staged is checked`);
      check(JSON.stringify(await viewFiles()) === '["lib/util.js"]', `${scheme}: Staged lists lib/util.js`);
      await sw.getByText('Untracked', { exact: true }).click();
      await viewList.getByRole('option', { name: /todo\.txt/ }).waitFor();
      check(JSON.stringify(await viewFiles()) === '["todo.txt"]', `${scheme}: Untracked lists todo.txt`);
      await shot('view-untracked');
      await diff.getByRole('button', { name: 'Close diff', exact: true }).click();
      await diff.waitFor({ state: 'detached' });

      // 3. Apply one file of "docs draft" from the details panel.
      const draft = stashes().find((s) => s.subject === 'On main: docs draft');
      await row(`stash:${draft.oid}`).click();
      const details = page.getByRole('complementary', { name: 'Commit details', exact: true });
      const detailFile = details.locator('[data-path="docs/guide.md"]');
      await detailFile.waitFor();
      await detailFile.click({ button: 'right' });
      await toasted('Applied docs/guide.md from stash@{1}', () => menu.getByRole('menuitem', { name: 'Apply this file', exact: true }).click());
      check(file('docs/guide.md') === '# Guide\n\nA draft section.\n' && git('diff', '--cached', '--name-only', '--', 'docs/guide.md') === '', `${scheme}: Apply this file changed the worktree file only`);
      check(stashes().some((s) => s.oid === draft.oid), `${scheme}: the stash stays`);

      // 4. Rename "docs draft": it moves to stash@{0}.
      await rowMenu(`stash:${draft.oid}`, 'Rename…');
      const rename = page.getByRole('dialog', { name: 'Rename stash@{1}', exact: true });
      await rename.waitFor();
      check(await rename.getByText('A renamed stash moves to the top (stash@{0}).', { exact: true }).isVisible(), `${scheme}: the rename dialog says the stash moves to the top`);
      await rename.getByRole('textbox', { name: 'Stash message', exact: true }).fill('guide draft');
      await shot('rename');
      await toasted('Renamed the stash: it is now stash@{0}', () => rename.getByRole('button', { name: 'Rename', exact: true }).click());
      await rename.waitFor({ state: 'detached' });
      check(stashes()[0].subject === 'On main: guide draft' && !stashes().some((s) => s.oid === draft.oid) && stashes().length === 3, `${scheme}: git lists the renamed stash at stash@{0}, the original gone`);
      await refsStashes.getByText('On main: guide draft').waitFor();

      // 5. Stash one line from the unstaged diff of src/app.js.
      await showChanges();
      await right.getByRole('region', { name: 'Unstaged Files', exact: true }).getByRole('option', { name: /src\/app\.js/ }).click();
      const body = diff.locator('[data-diff-body]');
      await body.locator('[data-hunk-header]').nth(1).waitFor();
      check(await diff.getByRole('button', { name: 'Stash hunk…', exact: true }).count() === 2, `${scheme}: each hunk offers Stash hunk…`);
      await body.getByRole('button', { name: 'Select added line 26', exact: true }).click();
      await diff.getByRole('toolbar', { name: 'Line selection', exact: true }).getByRole('button', { name: 'Stash lines…', exact: true }).click();
      await saveDialog.waitFor();
      check(await saveDialog.getByText('1 line of src/app.js', { exact: true }).isVisible(), `${scheme}: the dialog names the line and the file`);
      await saveDialog.getByRole('textbox', { name: 'Stash message', exact: true }).fill('one line');
      await shot('lines-dialog');
      await toasted('Stashed as stash@{0}', () => saveDialog.getByRole('button', { name: 'Stash', exact: true }).click());
      await saveDialog.waitFor({ state: 'detached' });
      const lineStash = stashes()[0];
      check(lineStash.subject === 'On main: one line', `${scheme}: git lists the line stash on top`);
      check(file('src/app.js') === lines(STAGE_EDITED.filter((l) => l !== 'const extra = true;')), `${scheme}: exactly the selected line left the worktree`);
      check(git('show', `${lineStash.oid}:src/app.js`) === lines(STAGE_BASE.flatMap((l, i) => (i === 24 ? [l, 'const extra = true;'] : [l]))), `${scheme}: the stash holds HEAD plus that line`);
      await diff.getByRole('button', { name: 'Close diff', exact: true }).click();
      await diff.waitFor({ state: 'detached' });

      // 6. Pop "selected files": lib/util.js (staged part) and todo.txt come back; the stash is dropped.
      await toasted('Popped stash@{2}', () => rowMenu(`stash:${saved.oid}`, 'Pop'));
      check(!stashes().some((s) => s.oid === saved.oid), `${scheme}: Pop dropped exactly that stash`);
      check(file('todo.txt') === 'todo\n' && file('lib/util.js') === 'export const util = 2;\n', `${scheme}: Pop restored the files`);

      // 7. Drop the line stash: Cancel keeps it, Drop removes it.
      await rowMenu(`stash:${lineStash.oid}`, 'Drop…');
      const confirm = page.getByRole('dialog', { name: 'Drop stash@{0}?', exact: true });
      await confirm.waitFor();
      await shot('drop-confirm');
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await confirm.waitFor({ state: 'detached' });
      check(stashes().some((s) => s.oid === lineStash.oid), `${scheme}: Cancel dropped nothing`);
      await rowMenu(`stash:${lineStash.oid}`, 'Drop…');
      await toasted('Dropped stash@{0}', () => confirm.getByRole('button', { name: 'Drop stash', exact: true }).click());
      check(!stashes().some((s) => s.oid === lineStash.oid), `${scheme}: Drop removed the stash`);
      await row(`stash:${lineStash.oid}`).waitFor({ state: 'detached' });

      // 7b. Undo the drop: the stash is back at stash@{0} at once. Redo asks first, listing its message; confirmed, it goes.
      await slotReady('Undo', 'Drop stash “On main: one line”');
      await toasted('Undid Drop stash “On main: one line”', () => undoButton.click());
      await row(`stash:${lineStash.oid}`).waitFor();
      check(stashes()[0].oid === lineStash.oid && stashes()[0].subject === 'On main: one line', `${scheme}: Undo stored the stash back at stash@{0}`);
      await slotReady('Redo', 'Drop stash “On main: one line”');
      await redoButton.click();
      const redoAsk = page.getByRole('dialog', { name: 'Redo Drop stash “On main: one line”?', exact: true });
      await redoAsk.waitFor();
      check(JSON.stringify(await redoAsk.getByRole('listitem').allTextContents()) === '["On main: one line"]', `${scheme}: the redo confirmation lists the stash it drops`);
      check(stashes()[0].oid === lineStash.oid, `${scheme}: nothing dropped before confirming`);
      await shot('redo-drop-confirm');
      await page.setViewportSize(PHONE);
      await shot('redo-drop-confirm-phone');
      await page.setViewportSize(DESKTOP);
      await toasted('Redid Drop stash “On main: one line”', () => redoAsk.getByRole('button', { name: 'Redo', exact: true }).click());
      await row(`stash:${lineStash.oid}`).waitFor({ state: 'detached' });
      check(!stashes().some((s) => s.oid === lineStash.oid), `${scheme}: the confirmed redo dropped it again`);

      // 7c. Apply "earlier experiment" from its row menu. The header's Undo takes the apply back (README.md as at HEAD,
      // its untracked file gone, the stash still listed); Redo applies it again; neither asks. A last Undo leaves the
      // checkout as step 8 expects.
      const earlier = stashes().find((s) => s.subject === 'On main: earlier experiment');
      const applyLabel = 'Apply “On main: earlier experiment”';
      const isApplied = () => file('README.md') === '# stash demo\n\nAn earlier experiment.\n' && file('scratch/notes.txt') === 'scratch\n';
      const unappliedStatus = git('status', '--porcelain');
      const isUnapplied = () => file('README.md') === '# stash demo\n' && file('scratch/notes.txt') === null && git('status', '--porcelain') === unappliedStatus;
      check(isUnapplied(), `${scheme}: README.md is HEAD's and scratch/ is absent before the apply`);
      await toasted(/^Applied stash@\{\d\}$/, () => rowMenu(`stash:${earlier.oid}`, 'Apply'));
      check(isApplied() && stashes().some((s) => s.oid === earlier.oid), `${scheme}: Apply wrote the stash's files and kept the stash`);
      await slotReady('Undo', applyLabel);
      await shot('apply-undo-ready');
      await toasted(`Undid ${applyLabel}`, () => undoButton.click());
      check(isUnapplied(), `${scheme}: Undo took the apply back (git status as before, the untracked file removed)`);
      check(stashes().some((s) => s.oid === earlier.oid), `${scheme}: the stash is still listed after the undo`);
      await row(`stash:${earlier.oid}`).waitFor();
      await slotReady('Redo', applyLabel);
      await toasted(`Redid ${applyLabel}`, () => redoButton.click());
      check(isApplied(), `${scheme}: Redo applied the stash again`);
      await slotReady('Undo', applyLabel);
      await toasted(`Undid ${applyLabel}`, () => undoButton.click());
      check(isUnapplied(), `${scheme}: a second Undo leaves the checkout as before the apply`);

      // 8. Create a branch from "earlier experiment": checked out at its base, the stash applied and dropped.
      await rowMenu(`stash:${earlier.oid}`, 'Create branch…');
      const branch = page.getByRole('dialog', { name: /^Create branch from stash@\{\d\}$/ });
      await branch.waitFor();
      await branch.getByRole('textbox', { name: 'Branch name', exact: true }).fill('experiment');
      await shot('branch-dialog');
      await toasted(/^Created experiment from stash@\{\d\}$/, () => branch.getByRole('button', { name: 'Create branch', exact: true }).click());
      await branch.waitFor({ state: 'detached' });
      check(git('symbolic-ref', 'HEAD').trim() === 'refs/heads/experiment' && git('rev-parse', 'HEAD').trim() === base, `${scheme}: the branch is checked out at the stash's base`);
      check(file('README.md') === '# stash demo\n\nAn earlier experiment.\n' && file('scratch/notes.txt') === 'scratch\n', `${scheme}: the stash was applied, untracked files included`);
      check(!stashes().some((s) => s.oid === earlier.oid) && stashes().length === 1, `${scheme}: the stash was dropped`);
      await shot('after-branch');

      // 9. Phone: the save dialog from the Changes dialog.
      await page.setViewportSize(PHONE);
      await page.goto(`${world.url}/?project=stash`);
      await page.getByRole('button', { name: /^Changes \(\d+\)$/ }).click();
      const changes = page.getByRole('dialog', { name: 'Changes', exact: true });
      await changes.getByRole('button', { name: 'Stash changes…', exact: true }).click();
      await saveDialog.waitFor();
      await saveDialog.getByRole('radio', { name: 'Selected files', exact: true }).check();
      await shot('phone-save');
      await saveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await saveDialog.waitFor({ state: 'detached' });
      await page.keyboard.press('Escape');
      await changes.waitFor({ state: 'detached' });

      // 10. Phone: a stash row's menu in the Refs dialog (the press that opens it is not taken as an item's click).
      await page.getByRole('button', { name: 'Refs', exact: true }).click();
      const refsDialog = page.getByRole('dialog', { name: 'Refs', exact: true });
      await refsDialog.getByRole('list', { name: 'Stashes', exact: true }).getByRole('button', { name: 'stash@{0} On main: guide draft', exact: true }).click({ button: 'right' });
      await menu.waitFor();
      const items = (await menu.getByRole('menuitem').allTextContents()).slice(0, 6);
      check(JSON.stringify(items) === JSON.stringify(['Apply', 'Apply with staged changes', 'Pop', 'Create branch…', 'Rename…', 'Drop…']), `${scheme}: the phone stash menu lists the stash actions first`);
      check(stashes().length === 1, `${scheme}: opening the menu ran nothing`);
      await shot('phone-menu');
      await menu.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
      const phoneRename = page.getByRole('dialog', { name: 'Rename stash@{0}', exact: true });
      await phoneRename.waitFor();
      await shot('phone-rename');
      await phoneRename.getByRole('button', { name: 'Cancel', exact: true }).click();
      await phoneRename.waitFor({ state: 'detached' });
      check(stashes()[0].subject === 'On main: guide draft', `${scheme}: Cancel renamed nothing`);
      check(errors.length === 0, `${scheme}: no console errors or ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
