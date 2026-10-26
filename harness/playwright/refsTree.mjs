// The refs panel's folder tree and row controls, asserted on the `lanes` world (graphSeed.mjs) with extra prefixed
// branches, in light and dark at desktop width and in the phone Refs dialog; screenshots into out/refsTree/. Fails on a
// console error or a ≥400 response other than the two host URLs that 404 outside cc.
// Run: node harness/playwright/refsTree.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedGraph } from './graphSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'refsTree');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`refsTree: ${what}`); console.log(`ok: ${what}`); };

const CC = 'refs/heads/code-conductor/';
const SHORT = 'code-conductor/11e74f';
const LONG = `${CC}dedupe-settings-and-a-very-long-branch-name`;
const BACKUP = 'refs/heads/backup/pre-rebase';

const world = await seedGraph();
const o = world.oids;
const git = world.git;
const tree = git('rev-parse', `${o.D}^{tree}`);
const child = (msg) => git('commit-tree', tree, '-p', o.D, '-m', msg);
const x1 = child('cc one');
const x2 = child('cc two');
git('branch', 'code-conductor/11e74f', x1);
git('branch', 'code-conductor/dedupe-settings-and-a-very-long-branch-name', x2);
git('branch', 'backup/pre-rebase', o.B);
git('branch', 'feature/ui/deep', o.F);

try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const row = (id) => page.locator(`[data-row-id="${id}"]`);
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const opacity = (loc) => loc.evaluate((e) => getComputedStyle(e).opacity);
    const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

    const scenario = async (scheme, vp, full) => {
      const tag = `${scheme} ${vp}`;
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(VIEWPORTS[vp]);
      await page.goto(`${world.url}/?project=lanes`);
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('code-git:graph:')) localStorage.removeItem(k); });
      await page.goto(`${world.url}/?project=lanes`);
      await row(x1).waitFor();
      const openPanel = async () => {
        if (vp === 'phone') {
          await page.getByRole('button', { name: 'Refs', exact: true }).click();
          return page.getByRole('dialog', { name: 'Refs' }).getByRole('navigation', { name: 'Refs' });
        }
        return page.getByRole('navigation', { name: 'Refs' });
      };
      let panel = await openPanel();
      await panel.waitFor();
      const leaf = (name) => panel.locator(`[data-ref="${name}"]`);
      const folder = (prefix) => panel.locator(`[data-folder="${prefix}"]`);
      const wrapper = (li) => li.locator('div.relative').first();
      const idle = () => page.mouse.move(0, 0);
      /** Hover the row so its overlay shows, then click the inactive toggle (an active one is clicked directly). */
      const toggle = async (host, label) => { await host.hover(); await host.getByRole('button', { name: label, exact: true }).click(); };

      // ---- A. tree ----
      for (const prefix of [CC, 'refs/heads/feature/', 'refs/heads/feature/ui/', 'refs/heads/backup/']) check(await folder(prefix).count() === 1, `${tag}: folder ${prefix} is listed`);
      const following = (prefix) => folder(prefix).evaluate((li) => li.nextElementSibling?.getAttribute('data-ref') ?? li.nextElementSibling?.getAttribute('data-folder'));
      check(await following('refs/heads/backup/') === BACKUP, `${tag}: the single-child folder backup/ holds its leaf`);
      check(await following('refs/heads/feature/') === 'refs/heads/feature/ui/', `${tag}: feature/ lists its sub-folder first`);
      check(await leaf('refs/heads/feature/ui/deep').count() === 1 && await leaf(`${CC}11e74f`).count() === 1, `${tag}: leaves sit under their folders`);
      await idle();
      await shot(`tree-${scheme}-${vp}`);

      if (!full) {
        // ---- I. phone ----
        await folder(CC).locator('button[aria-expanded]').click();
        check(await leaf(`${CC}11e74f`).count() === 0, `${tag}: a folder toggle collapses it in the dialog`);
        await folder(CC).locator('button[aria-expanded]').click();
        await toggle(folder(CC), 'Hide folder code-conductor');
        await row(x1).waitFor({ state: 'detached' });
        check(await panel.getByRole('button', { name: 'Show folder code-conductor', exact: true }).isVisible(), `${tag}: the folder hide is shown in flow in the dialog`);
        await panel.getByRole('button', { name: 'Show folder code-conductor', exact: true }).click();
        await row(x1).waitFor();
        await page.keyboard.press('Escape');
        return;
      }

      // ---- B. zero width ----
      const pre = leaf(BACKUP);
      const rowBox = await pre.boundingBox();
      const nameBtn = pre.locator('button[title]');
      const nameBox = await nameBtn.boundingBox();
      check(rowBox.x + rowBox.width - (nameBox.x + nameBox.width) <= 12, `${tag}: an idle row reserves no width for its controls`);
      check(await opacity(pre.locator('[data-row-overlay]')) === '0', `${tag}: the idle overlay is transparent`);
      check(await leaf(LONG).locator('button[title]').evaluate((b) => b.scrollWidth > b.clientWidth), `${tag}: the long name overflows its row (truncated)`);

      // ---- C. hover ----
      await pre.hover();
      const overlay = pre.locator('[data-row-overlay]');
      check(await opacity(overlay) === '1', `${tag}: hovering the row shows the overlay`);
      const wrapBox = await wrapper(pre).boundingBox();
      for (const b of await overlay.getByRole('button').all()) check(inside(await b.boundingBox(), wrapBox), `${tag}: a hover toggle lies over the name wrapper`);
      check((await overlay.evaluate((e) => getComputedStyle(e).backgroundImage)).includes('gradient'), `${tag}: the overlay fades in with a gradient`);
      await shot(`hover-${scheme}-${vp}`);

      // ---- D. keyboard ----
      await idle();
      await panel.getByRole('textbox', { name: 'Filter refs' }).focus();
      for (let i = 0; i < 60 && await page.evaluate(() => document.activeElement?.getAttribute('title')) !== BACKUP; i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Pin backup/pre-rebase to left', `${tag}: Tab from the name reaches the row's first toggle`);
      check(await opacity(overlay) === '1', `${tag}: keyboard focus shows the overlay`);
      check(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow !== 'none'), `${tag}: the focused toggle has a visible ring`);
      await nameBtn.click();
      await idle();
      check(await opacity(overlay) === '0', `${tag}: after a mouse click on the name and the pointer leaving, the overlay is hidden`);

      // ---- E. active indicators ----
      const inFlow = async (host, label) => {
        await idle();
        const b = host.getByRole('button', { name: label, exact: true });
        check(await b.isVisible(), `${tag}: "${label}" is visible without hover`);
        const w = await wrapper(host).boundingBox();
        const bb = await b.boundingBox();
        check(bb.x >= w.x + w.width - 1, `${tag}: "${label}" sits right of the name wrapper`);
        check(await host.locator('[data-row-overlay]').getByRole('button', { name: label, exact: true }).count() === 0, `${tag}: "${label}" is outside the overlay`);
        return b;
      };
      const cc1 = leaf(`${CC}11e74f`);
      await toggle(cc1, `Hide ${SHORT}`);
      await row(x1).waitFor({ state: 'detached' });
      await (await inFlow(cc1, `Show ${SHORT}`)).click();
      await row(x1).waitFor();
      check(await cc1.getByRole('button', { name: `Hide ${SHORT}`, exact: true }).count() === 1, `${tag}: undoing a hide restores the overlay toggle`);
      await toggle(cc1, `Pin ${SHORT} to left`);
      await (await inFlow(cc1, `Unpin ${SHORT}`)).click();
      check(await cc1.getByRole('button', { name: `Pin ${SHORT} to left`, exact: true }).count() === 1, `${tag}: Unpin undoes the pin`);
      await toggle(cc1, `Solo ${SHORT}`);
      await row(o.G).waitFor({ state: 'detached' });
      await (await inFlow(cc1, `Unsolo ${SHORT}`)).click();
      await row(o.G).waitFor();
      const tagsHead = panel.locator('div.group\\/row', { has: panel.getByRole('button', { name: /^Tags/ }) }).first();
      await toggle(tagsHead, 'Hide Tags');
      await (await inFlow(tagsHead, 'Show Tags')).click();
      check(await row(o.B).getByText('v1.0').count() === 1, `${tag}: the section's Show undoes its hide`);
      const originHead = panel.locator('div.group\\/row', { has: panel.getByRole('button', { name: 'origin', exact: true }) }).first();
      await toggle(originHead, 'Hide remote origin');
      await (await inFlow(originHead, 'Show remote origin')).click();
      const ccFolder = folder(CC);
      await toggle(ccFolder, 'Hide folder code-conductor');
      await row(x1).waitFor({ state: 'detached' });
      await (await inFlow(ccFolder, 'Show folder code-conductor')).click();
      await row(x1).waitFor();

      // ---- F. collapse ----
      await ccFolder.locator('button[aria-expanded]').click();
      check(await leaf(`${CC}11e74f`).count() === 0 && await folder(CC).count() === 1, `${tag}: collapsing code-conductor detaches its rows`);
      await page.reload();
      await row(x1).waitFor();
      panel = await openPanel();
      check(await leaf(`${CC}11e74f`).count() === 0 && await folder(CC).count() === 1, `${tag}: the collapse survives a reload`);
      const filter = panel.getByRole('textbox', { name: 'Filter refs' });
      await filter.fill('11e7');
      await leaf(`${CC}11e74f`).waitFor();
      check(await folder('refs/heads/feature/').count() === 0, `${tag}: the filter expands the collapsed folder and drops folders without a match`);
      await filter.fill('');
      await leaf(`${CC}11e74f`).waitFor({ state: 'detached' });
      check(await folder(CC).count() === 1, `${tag}: clearing the filter collapses it again`);

      // ---- H. range over a collapsed folder (cc is still collapsed) ----
      await leaf(BACKUP).locator('button[title]').click({ modifiers: ['Control'] });
      await leaf('refs/heads/feature/a').locator('button[title]').click({ modifiers: ['Shift'] });
      const picked = await panel.locator('[data-selected]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')));
      check(JSON.stringify(picked) === JSON.stringify([BACKUP, 'refs/heads/feature/ui/deep', 'refs/heads/feature/a']), `${tag}: a Shift range skips the collapsed folder's refs (${picked})`);
      await leaf('refs/heads/main').locator('button[title]').click();
      await folder(CC).locator('button[aria-expanded]').click();
      await leaf(`${CC}11e74f`).waitFor();

      // ---- G. folder hide / solo, inherited by a later ref ----
      await toggle(folder(CC), 'Hide folder code-conductor');
      await row(x1).waitFor({ state: 'detached' });
      check(await row(x2).count() === 0, `${tag}: hiding the folder removes every commit under it`);
      const later = child(`cc later ${scheme}`);
      git('branch', `code-conductor/later-${scheme}`, later);
      await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
      const laterLeaf = leaf(`${CC}later-${scheme}`);
      await laterLeaf.waitFor();
      check((await laterLeaf.getAttribute('class')).includes('opacity-50') && await row(later).count() === 0, `${tag}: a ref created later under the hidden folder inherits the hide`);
      await toggle(leaf(`${CC}11e74f`), `Solo ${SHORT}`);
      await row(x1).waitFor();
      check(await row(x2).count() === 0 && await row(later).count() === 0 && await row(o.G).count() === 0, `${tag}: soloing a ref inside the hidden folder shows only it`);
      await leaf(`${CC}11e74f`).getByRole('button', { name: `Unsolo ${SHORT}`, exact: true }).click();
      await panel.getByRole('button', { name: 'Show folder code-conductor', exact: true }).click();
      await row(x2).waitFor();
      check(await row(later).count() === 1, `${tag}: undoing the folder hide brings the later ref's commit back`);
    };

    await scenario('light', 'desktop', true);
    await scenario('dark', 'desktop', true);
    await scenario('light', 'phone', false);
    await scenario('dark', 'phone', false);
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  });
} finally {
  await world.close();
}
