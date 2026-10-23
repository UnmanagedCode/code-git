// The history card's golden path on the `hist` world (historySeed.mjs), in light then dark, each on a fresh seed: the
// palette's File history… → the rename rows → the viewer (Diff with its line counts, then File) → Blame (author colours) → a 1500-line blame
// paging as it scrolls → Show in graph → the Reflog and its row menu → a branch's Show reflog. Screenshots at desktop
// and phone width into out/history/. Fails on a console error or a ≥400 response other than the two host URLs.
// Run: node harness/playwright/history.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { BIG_LINES, seedHistory, XSS_SUBJECT } from './historySeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'history');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`history: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seedHistory();
  const o = world.oids;
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
      const palette = page.getByRole('combobox', { name: 'Command', exact: true });
      /** Ctrl/⌘+P, the command, then (for a pick) the item. */
      const run = async (command, item) => {
        await page.locator('body').click({ position: { x: 5, y: 300 } });
        await page.keyboard.press('ControlOrMeta+p');
        await palette.fill(command);
        await page.keyboard.press('Enter');
        if (item === undefined) return;
        const pick = page.getByRole('combobox', { name: `${command}…`, exact: true });
        await pick.fill(item);
        await page.getByRole('option', { name: item, exact: true }).waitFor();
        await page.keyboard.press('Enter');
      };

      await page.goto(`${world.url}/?project=hist`);
      await page.locator(`[data-row-id="${o.local}"]`).waitFor();

      // 1. File history of guide.md: five commits across two renames
      await run('File history', 'guide.md');
      const list = page.getByRole('listbox', { name: 'File history', exact: true });
      await list.getByRole('option').nth(4).waitFor();
      const rows = await list.getByRole('option').allTextContents();
      check(rows.length === 5, `five commits touch guide.md through its renames (${rows.length})`);
      const renamed = await list.locator('[data-renamed]').allTextContents();
      check(renamed.join('|') === 'renamed from docs/guide.md|renamed from docs/intro.md', `the two renames are marked (${renamed.join('|')})`);
      check(rows[1].includes(XSS_SUBJECT), 'a markup subject is shown as text');
      check(await page.locator('[data-history-viewer] img').count() === 0 && await list.locator('img').count() === 0, 'no <img> from the subject');

      // 2. The viewer: a content edit in Diff, then File
      await list.getByRole('option').nth(1).click();
      const viewer = page.locator('[data-history-viewer]');
      await viewer.locator('[data-view="unified"] [data-row="add"]').first().waitFor();
      check(await viewer.locator('[data-row="add"]').count() > 0, 'the edit shows its added lines in the diff view');
      // The toolbar's counts are the loaded change's own lines.
      const adds = await viewer.locator('[data-row="add"]').count();
      const dels = await viewer.locator('[data-row="del"]').count();
      const toolbarText = await page.getByRole('toolbar', { name: 'Change view', exact: true }).textContent();
      check(toolbarText.includes(`+${adds} −${dels}`), `the change view's toolbar shows +${adds} −${dels}`);
      await shot('history-desktop');
      await page.getByRole('toolbar', { name: 'Change view', exact: true }).getByRole('button', { name: 'File', exact: true }).click();
      await viewer.locator('[data-view="file"]').waitFor();
      check(await viewer.locator('[data-row="file"]').count() === 4, 'File view shows the whole file at that commit');
      await page.getByRole('toolbar', { name: 'Change view', exact: true }).getByRole('button', { name: 'Diff', exact: true }).click();

      // 3. Blame: three authors, a colour each
      await page.getByRole('group', { name: 'History or blame', exact: true }).getByRole('button', { name: 'Blame', exact: true }).click();
      const blame = page.getByRole('table', { name: 'Blame', exact: true });
      await blame.locator('[data-blame-line="4"]').waitFor();
      const gutters = await blame.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
      check(gutters.length >= 2, `blame marks each run (${gutters.join(' | ')})`);
      const lanes = await blame.locator('[data-blame-line] > [role="cell"]:first-child').evaluateAll((cs) => [...new Set(cs.map((c) => [...c.classList].find((k) => k.startsWith('lane-'))))]);
      check(lanes.length >= 2, `authors get distinct colours (${lanes.join(', ')})`);
      await shot('blame-desktop');
      // A gutter click picks that commit in History
      await blame.getByRole('button').first().click();
      await list.waitFor();
      check(await list.locator('[aria-selected="true"]').count() === 1, 'the blame gutter picks a commit in History');

      // 4. A 1500-line blame pages as it scrolls
      await run('Blame', 'big.txt');
      await blame.locator('[data-blame-line="1000"]').waitFor();
      check(await blame.locator('[data-blame-line]').count() === 1000, 'the first blame page is 1000 lines');
      await blame.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
      await blame.locator(`[data-blame-line="${BIG_LINES}"]`).waitFor();
      check(await blame.locator('[data-blame-line]').count() === BIG_LINES, `scrolling loads the rest (${BIG_LINES} lines)`);
      const bigLanes = await blame.locator('[data-blame-line="1"] > [role="cell"]:first-child, [data-blame-line="1500"] > [role="cell"]:first-child')
        .evaluateAll((cs) => cs.map((c) => [...c.classList].find((k) => k.startsWith('lane-'))));
      check(bigLanes[0] !== bigLanes[1], `Ann's and Cy's halves differ in colour (${bigLanes.join(' vs ')})`);

      // 5. Show in graph: the graph comes back on the picked commit
      await page.getByRole('group', { name: 'History or blame', exact: true }).getByRole('button', { name: 'History', exact: true }).click();
      await list.getByRole('option').first().waitFor();
      await page.getByRole('button', { name: 'Show in graph', exact: true }).click();
      await page.getByRole('region', { name: 'Commit graph', exact: true }).waitFor();
      await page.locator(`[data-row-id="${o.bigCy}"][aria-selected="true"]`).waitFor();
      check(await page.getByRole('listbox', { name: 'File history', exact: true }).count() === 0, 'Show in graph closes the history and selects the picked commit in the graph');

      // 6. Reflog of HEAD and its row menu
      await run('Reflog');
      const entries = page.getByRole('list', { name: 'Reflog entries', exact: true });
      await entries.locator('[data-reflog-row="HEAD@{0}"]').waitFor();
      const count = await entries.locator('[data-reflog-row]').count();
      check(count >= 6, `the reflog lists HEAD's moves (${count})`);
      check((await entries.locator('[data-reflog-row="HEAD@{0}"]').textContent()).includes('reset: moving to'), 'HEAD@{0} is the last reset');
      await shot('reflog-desktop');
      await page.getByRole('button', { name: 'Actions for HEAD@{1}', exact: true }).click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      const items = await menu.getByRole('menuitem').allTextContents();
      check(items.join('|') === 'View changes|Create branch here…|Reset HEAD to here|Copy SHA', `the reflog row menu (${items.join('|')})`);
      await menu.getByRole('menuitem', { name: 'Create branch here…', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await shot('reflog-branch-dialog-desktop');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });

      // 7. A branch's Show reflog
      await page.getByRole('button', { name: 'Close reflog', exact: true }).click();
      await page.getByRole('region', { name: 'Commit graph', exact: true }).waitFor();
      await page.locator('[data-ref="refs/heads/side"] button[title="refs/heads/side"]').click({ button: 'right' });
      await page.getByRole('menu').getByRole('menuitem', { name: 'Show reflog', exact: true }).click();
      await page.getByRole('combobox', { name: 'Reflog of', exact: true }).waitFor();
      check(await page.getByRole('combobox', { name: 'Reflog of', exact: true }).inputValue() === 'refs/heads/side', "the branch menu's Show reflog opens side's reflog");
      await entries.locator('[data-reflog-row="side@{0}"]').waitFor();

      // 8. Phone width
      await page.setViewportSize(VIEWPORTS.phone);
      await shot('reflog-phone');
      await run('File history', 'guide.md');
      await page.getByRole('listbox', { name: 'File history', exact: true }).getByRole('option').nth(4).waitFor();
      await shot('history-phone');
      await page.getByRole('group', { name: 'History or blame', exact: true }).getByRole('button', { name: 'Blame', exact: true }).click();
      await page.getByRole('table', { name: 'Blame', exact: true }).locator('[data-blame-line="1"]').waitFor();
      await shot('blame-phone');

      check(errors.length === 0, `no console errors or failed responses${errors.length ? `: ${errors.join('; ')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
console.log('history: all checks passed');
