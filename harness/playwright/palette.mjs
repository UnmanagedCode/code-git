// The palette, the shortcut sheet and undo/redo on the `hist` world (historySeed.mjs), in light then dark, each on a
// fresh seed, every step checked against git: Ctrl/⌘+P → filter → Create branch… → Checkout branch… (a pick) → the
// header's Undo of that checkout → Ctrl/⌘+/ sheet → a commit from the Changes panel, header Undo (the change staged
// again), Ctrl/⌘+Shift+Z redo (the same commit) → a hard reset whose undo asks first → a stopped cherry-pick disables
// Undo. Screenshots at desktop and phone width into out/palette/. Fails on a console error or a ≥400 response other
// than the two host URLs.
// Run: node harness/playwright/palette.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedHistory } from './historySeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'palette');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`palette: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seedHistory();
  const o = world.oids;
  const git = (...args) => world.repo.git(...args);
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(VIEWPORTS.desktop);

      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const header = page.getByRole('banner', { name: 'Repository summary', exact: true });
      const undoButton = header.getByRole('button', { name: 'Undo', exact: true });
      const redoButton = header.getByRole('button', { name: 'Redo', exact: true });
      const palette = page.getByRole('combobox', { name: 'Command', exact: true });
      const dialog = page.getByRole('dialog');
      const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
      const away = () => page.locator('body').click({ position: { x: 5, y: 300 } });
      const waitHead = (name) => page.waitForFunction((n) => document.querySelector('[aria-label="HEAD"]')?.textContent === n, name);
      /** Waits until the header's Undo or Redo is enabled. */
      const waitEnabled = (name) => page.waitForFunction((n) => {
        const b = document.querySelector(`header[aria-label="Repository summary"] button[aria-label="${n}"]`);
        return !!b && !b.disabled;
      }, name);

      await page.goto(`${world.url}/?project=hist`);
      await page.locator(`[data-row-id="${o.local}"]`).waitFor();

      // 1. Ctrl/⌘+P → filter → Create branch… opens its dialog
      await away();
      await page.keyboard.press('ControlOrMeta+p');
      await palette.waitFor();
      await palette.fill('create br');
      const options = await page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option').allTextContents();
      check(options.length === 1 && options[0].startsWith('Create branch…'), `the filter leaves Create branch… (${options.join(' | ')})`);
      await palette.fill('');
      await shot('palette-desktop');
      await palette.fill('create br');
      await page.keyboard.press('Enter');
      await dialog.getByRole('textbox', { name: 'Branch name', exact: true }).waitFor();
      check(true, 'Enter runs it: the create-branch dialog is open');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });

      // 2. Checkout branch… picks side; the header's Undo switches back
      await away();
      await page.keyboard.press('ControlOrMeta+p');
      await palette.fill('checkout');
      await page.keyboard.press('Enter');
      const pick = page.getByRole('combobox', { name: 'Checkout branch…', exact: true });
      await pick.waitFor();
      const branches = await page.getByRole('listbox', { name: 'Checkout branch…', exact: true }).getByRole('option').allTextContents();
      check(branches.join('|') === 'side|origin/mainremote', `the pick lists side and origin/main, not HEAD's main (${branches.join('|')})`);
      await pick.fill('side');
      await page.keyboard.press('Enter');
      await waitHead('side');
      check(git('symbolic-ref', '--short', 'HEAD') === 'side', 'git agrees: side is checked out');
      await waitEnabled('Undo');
      check((await undoButton.getAttribute('title')) === 'Undo Checkout side (Ctrl/⌘+Z)', `Undo names the checkout (${await undoButton.getAttribute('title')})`);
      await undoButton.click();
      await waitHead('main');
      await toast('Undid Checkout side').waitFor();
      check(git('symbolic-ref', '--short', 'HEAD') === 'main', 'undo: back on main');
      await waitEnabled('Redo');

      // 3. Ctrl/⌘+/ opens the shortcut sheet
      await away();
      await page.keyboard.press('ControlOrMeta+/');
      const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
      await sheet.waitFor();
      const scopes = await sheet.getByRole('region').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-label')));
      check(['Global', 'Graph', 'Changes', 'Diff'].every((s) => scopes.includes(s)), `the sheet lists the scopes (${scopes.join(', ')})`);
      check(await sheet.locator('[data-shortcut="undo.undo"] dd').textContent() === 'Ctrl/⌘+Z', 'the sheet shows Undo as Ctrl/⌘+Z');
      await shot('sheet-desktop');
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached' });

      // 4. A commit from the Changes panel; Undo stages it again; Ctrl/⌘+Shift+Z re-commits it
      world.repo.write('new.txt', 'new\n');
      await page.getByRole('button', { name: 'Reload changes', exact: true }).click();
      await page.getByRole('button', { name: 'Stage all', exact: true }).first().click();
      await page.getByRole('button', { name: 'Commit changes to 1 file', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('add new.txt');
      await page.getByRole('button', { name: 'Commit changes to 1 file', exact: true }).click();
      await page.waitForFunction((before) => document.querySelector('[data-row-id]')?.getAttribute('data-row-id') !== before, o.local).catch(() => {});
      await toast('Committed').first().waitFor().catch(() => {});
      await page.waitForFunction(() => document.querySelector('button[aria-label="Undo"]')?.getAttribute('title')?.startsWith('Undo Commit “add new.txt”'));
      const committed = git('rev-parse', 'HEAD');
      check(committed !== o.local && git('log', '-1', '--format=%s') === 'add new.txt', 'the commit landed');
      await undoButton.click();
      await toast('Undid Commit “add new.txt”').waitFor();
      check(git('rev-parse', 'HEAD') === o.local, 'undo: HEAD back at the commit before');
      check(git('diff', '--cached', '--name-only') === 'new.txt', 'undo: new.txt is staged again');
      await waitEnabled('Redo');
      await away();
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await toast('Redid Commit “add new.txt”').waitFor();
      check(git('rev-parse', 'HEAD') === committed, 'Ctrl/⌘+Shift+Z: the same commit is back');

      // 5. A hard reset; its undo asks first
      await page.locator(`[data-row-id="${o.pushed}"]`).click({ button: 'right' });
      await page.getByRole('menu').getByRole('menuitem', { name: 'Reset main to this commit', exact: true }).click();
      await page.getByRole('menu').last().getByRole('menuitem', { name: 'Hard (discard changes)', exact: true }).click();
      await dialog.getByRole('button', { name: 'Reset hard', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('button[aria-label="Undo"]')?.getAttribute('title')?.includes('(hard)'));
      check(git('rev-parse', 'HEAD') === o.pushed, 'the hard reset moved main');
      await undoButton.click();
      const ask = page.getByRole('dialog').filter({ hasText: 'hard reset' });
      await ask.waitFor();
      check((await ask.getByRole('heading').textContent()).startsWith('Undo Reset main to'), 'undoing the hard reset asks first');
      await shot('undo-confirm-desktop');
      await page.setViewportSize(VIEWPORTS.phone);
      await shot('undo-confirm-phone');
      await page.setViewportSize(VIEWPORTS.desktop);
      await ask.getByRole('button', { name: 'Undo', exact: true }).click();
      await toast('Undid Reset main').waitFor();
      check(git('rev-parse', 'HEAD') === committed, 'confirmed: main is back');

      // 6. A stopped cherry-pick disables Undo and Redo
      await page.locator(`[data-row-id="${o.side}"]`).click({ button: 'right' });
      await page.getByRole('menu').getByRole('menuitem', { name: 'Cherry-pick commit', exact: true }).click();
      await toast('Cherry-pick stopped on conflicts').waitFor();
      await page.waitForFunction(() => document.querySelector('button[aria-label="Undo"]')?.hasAttribute('disabled'));
      check(/cherry-pick is in progress/.test(await undoButton.getAttribute('title')), `Undo is disabled with the reason (${await undoButton.getAttribute('title')})`);
      await shot('undo-disabled-desktop');
      await page.setViewportSize(VIEWPORTS.phone);
      await away();
      await page.keyboard.press('ControlOrMeta+p');
      await palette.waitFor();
      await shot('palette-phone');
      await page.keyboard.press('Escape');

      check(errors.length === 0, `no console errors or failed responses${errors.length ? `: ${errors.join('; ')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
console.log('palette: all checks passed');
