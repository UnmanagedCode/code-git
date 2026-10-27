// The links to and from code-review on the `hist` world (historySeed.mjs, cc listing code-review as enabled), in light
// then dark, each on a fresh seed. Inbound: a `commit=` link selects the commit and shows its details, `commit=&path=`
// opens the file's history, a popstate steers to another commit, an invalid link opens the tab and applies nothing; the
// keys are always stripped from the URL. Outbound, inside a fake cc host page (same origin, a stub bridge defining
// `ccBridge` when framed): a commit's **Review in code-review** and a chain-to-HEAD's **Review range in code-review**
// set only the host's hash (no reload); a chain not ending at HEAD offers no range; standalone, neither item shows and
// api/integrations is never requested. Screenshots into out/links/. Fails on a console error or a ≥400 response other
// than the host URLs.
// Run: node harness/playwright/links.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedHistory } from './historySeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'links');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const PLUGINS = [{ id: 'code-git', enabled: true, hasFrontend: true }, { id: 'code-review', enabled: true, hasFrontend: true }];
const REVIEW = 'Review in code-review';
const REVIEW_RANGE = 'Review range in code-review';
const check = (cond, what) => { if (!cond) throw new Error(`links: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seedHistory({ plugins: PLUGINS });
  const o = world.oids;
  try {
    await withPage(async (page) => {
      const errors = [];
      const integrationRequests = [];
      page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('request', (r) => { if (r.url().includes('/api/integrations')) integrationRequests.push(r.url()); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const selected = (root, oid) => root.locator(`[data-row-id="${oid}"][aria-selected="true"]`);

      // 1. A commit link: the commit selected, its details shown, the keys stripped
      await page.goto(`${world.url}/?project=hist&commit=${o.edit1}`);
      await selected(page, o.edit1).waitFor();
      const details = page.getByRole('complementary', { name: 'Commit details', exact: true });
      await details.getByText('edit the intro', { exact: true }).first().waitFor();
      check(true, 'a commit link selects the commit and shows its details');
      check(await page.evaluate(() => location.search) === '?project=hist', 'the commit link\'s keys are stripped from the URL');
      await shot('commit-link');

      // 2. A path link: the file's history from that commit
      await page.goto(`${world.url}/?project=hist&commit=${o.edit2}&path=docs/guide.md`);
      const history = page.getByRole('region', { name: 'File history panel', exact: true });
      await history.getByRole('heading', { name: 'docs/guide.md', exact: true }).waitFor();
      const list = page.getByRole('listbox', { name: 'File history', exact: true });
      await list.getByRole('option').first().waitFor();
      check((await list.getByRole('option').first().textContent()).includes('tweak'), 'a path link opens the file\'s history from the linked commit');
      check(await page.evaluate(() => location.search) === '?project=hist', 'the path link\'s keys are stripped from the URL');
      await shot('path-link');

      // 3. A steer (cc's navigate arrives as popstate): the history gives way to the graph, the new commit selected
      await page.evaluate((c) => { history.replaceState(null, '', `?project=hist&commit=${c}`); window.dispatchEvent(new PopStateEvent('popstate')); }, o.rename1);
      await selected(page, o.rename1).waitFor();
      check(await history.count() === 0, 'a steered commit link hides the history panel');
      check(await page.evaluate(() => location.search) === '?project=hist', 'the steered link\'s keys are stripped from the URL');

      // 4. An invalid link: the tab opens, nothing applied, nothing shown as an error, the keys stripped
      await page.goto(`${world.url}/?project=hist&commit=abc&path=../x`);
      await page.locator(`[data-row-id="${o.local}"]`).waitFor();
      check(await page.locator('[aria-selected="true"][data-row-id]').count() === 0, 'an invalid link selects nothing');
      check(await history.count() === 0, 'an invalid link opens no history');
      check(await page.evaluate(() => location.search) === '?project=hist', 'an invalid link\'s keys are stripped from the URL');

      // 5. Standalone (before the host routes exist): no item, no integrations request
      await page.goto(`${world.url}/?project=hist`);
      await page.locator(`[data-row-id="${o.edit1}"]`).click({ button: 'right' });
      const plainMenu = page.getByRole('menu');
      await plainMenu.getByRole('menuitem').first().waitFor();
      check(await plainMenu.getByRole('menuitem', { name: REVIEW, exact: true }).count() === 0, 'standalone, a commit\'s menu has no Review in code-review');
      await page.keyboard.press('Escape');
      check(integrationRequests.length === 0, 'standalone, api/integrations is never requested');

      // 6. Outbound, inside a fake cc host page on the backend's origin
      await page.route(`${world.url}/host.html`, (r) => r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:0"><iframe title="Code Git" src="/?project=hist" style="border:0;width:100vw;height:100vh"></iframe></body></html>',
      }));
      await page.route('**/pluginBridge.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'if (window.self !== window.top) window.ccBridge = {};' }));
      await page.goto(`${world.url}/host.html`);
      await page.evaluate(() => { window.hostMarker = 'kept'; });
      const frame = page.frameLocator('iframe[title="Code Git"]');
      await frame.locator(`[data-row-id="${o.edit1}"]`).waitFor();
      const hostState = () => page.evaluate(() => ({ hash: location.hash, marker: window.hostMarker }));
      const menuIn = frame.getByRole('menu');

      // A single commit
      await frame.locator(`[data-row-id="${o.edit1}"]`).click({ button: 'right' });
      await menuIn.getByRole('menuitem', { name: REVIEW, exact: true }).waitFor();
      check(integrationRequests.length >= 1, 'inside cc, api/integrations is requested and offers Review in code-review');
      await shot('commit-menu');
      await menuIn.getByRole('menuitem', { name: REVIEW, exact: true }).click();
      await page.waitForFunction(() => location.hash.startsWith('#plugin/'));
      let s = await hostState();
      check(s.hash === `#plugin/code-review/?project=hist&view=new&sha=${o.edit1}`, `Review in code-review sets the host's hash (${s.hash})`);
      check(s.marker === 'kept', 'the host page did not reload');

      // A first-parent chain ending at HEAD
      await frame.locator(`[data-row-id="${o.local}"]`).click();
      await frame.locator(`[data-row-id="${o.rename2}"]`).click({ modifiers: ['Control'] });
      await frame.locator(`[data-row-id="${o.rename2}"]`).click({ button: 'right' });
      await menuIn.getByRole('menuitem', { name: REVIEW_RANGE, exact: true }).waitFor();
      await shot('range-menu');
      await menuIn.getByRole('menuitem', { name: REVIEW_RANGE, exact: true }).click();
      await page.waitForFunction(() => location.hash.includes('range='));
      s = await hostState();
      check(s.hash === `#plugin/code-review/?project=hist&view=new&range=${o.bigCy}...${o.local}`, `Review range in code-review sends base...HEAD's oid (${s.hash})`);
      check(s.marker === 'kept', 'the host page still did not reload');

      // A chain not ending at HEAD
      await frame.locator(`[data-row-id="${o.rename2}"]`).click();
      await frame.locator(`[data-row-id="${o.bigCy}"]`).click({ modifiers: ['Control'] });
      await frame.locator(`[data-row-id="${o.bigCy}"]`).click({ button: 'right' });
      await menuIn.getByRole('menuitem').first().waitFor();
      check(await menuIn.getByRole('menuitem', { name: REVIEW_RANGE, exact: true }).count() === 0, 'a chain not ending at HEAD offers no range');
      await page.keyboard.press('Escape');

      check(errors.length === 0, `no console errors or failed requests (${errors.join(' | ')})`);
    });
  } finally {
    await world.close();
  }
}
console.log('links: all checks passed');
