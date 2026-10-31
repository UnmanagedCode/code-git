// cc's sidebar row ⋮ items (manifest `menuItems`) on the seeded world (seed.mjs), in light then dark, each on a fresh
// seed. `?ccProject=app` opens app's main checkout; a cc navigate (replace + popstate) to `ccWorktree=feat` opens the
// worktree's tab in place (no reload); `?ccProject=box` opens the remote-System project with its badge; `gone` (System
// unreachable) and `ghost` (unlisted) toast the name and change no tab. The cc keys never stay in the URL. Screenshots
// into out/menu/. Fails on a console error or a ≥400 response other than cc's host files.
// Run: node harness/playwright/menu.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';
import { toasted } from './toasts.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'menu');
mkdirSync(outDir, { recursive: true });

// cc's host files, absent standalone.
const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const check = (cond, what) => { if (!cond) throw new Error(`menu: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const heading = (name) => page.getByRole('heading', { name, exact: true });
      const tabs = page.getByRole('tablist', { name: 'Open repositories', exact: true }).getByRole('tab');
      const selectedTab = () => page.locator('[role="tab"][aria-selected="true"]').textContent();
      const search = () => page.evaluate(() => location.search);
      const navigate = (q) => page.evaluate((s) => { history.replaceState(null, '', s); window.dispatchEvent(new PopStateEvent('popstate')); }, q);

      // 1. A project row on load: app's main checkout, the cc keys replaced by its route
      await page.goto(`${world.url}/?ccProject=app`);
      await heading('app').waitFor();
      check(await search() === '?project=app', 'Open repository on load opens app and leaves ?project=app in the URL');
      check(await tabs.count() === 1, 'one tab is open');
      await shot('project');

      // 2. A worktree row on the open page (cc's navigate): retargets in place
      await page.evaluate(() => { window.menuMarker = 'kept'; });
      await navigate('?ccProject=app&ccWorktree=feat');
      await heading('app/feat').waitFor();
      check(await tabs.count() === 2, 'Open worktree adds app/feat beside app');
      check(await selectedTab() === 'app/feat', 'app/feat is the active tab');
      check(await search() === '?project=app&worktree=feat', 'the URL holds the worktree tab\'s route');
      check(await page.evaluate(() => window.menuMarker) === 'kept', 'the page did not reload');
      await shot('worktree');

      // 3. A project on a remote System: opens like a local one, with the System badge
      await page.goto(`${world.url}/?ccProject=box`);
      await heading('box').waitFor();
      await page.locator('header[aria-label="Repository summary"]').getByText('docker · cc-box', { exact: true }).waitFor();
      check(await tabs.count() === 3, 'box opens beside the persisted tabs');
      check(await search() === '?project=box', 'the URL holds box\'s route');
      await shot('remote');

      // 4. A project the picker disables: an error toast with the name and the reason, no tab change
      await toasted(page, /“gone”.*could not be reached/, () => navigate('?ccProject=gone&ccWorktree=w'));
      check(await tabs.count() === 3 && await selectedTab() === 'box', 'an unreachable project changes no tab');
      check(await search() === '?project=box', 'the refused cc keys gave way to the active tab\'s route');
      await shot('refused-unreachable');

      // 5. An unlisted project: an error toast quoting it
      await toasted(page, /no project “ghost”/, () => navigate('?ccProject=ghost'));
      check(await tabs.count() === 3 && await selectedTab() === 'box', 'an unknown project changes no tab');
      check(await search() === '?project=box', 'the URL still holds the active tab\'s route');
      await shot('refused-unknown');

      check(errors.length === 0, `no console errors or failed requests (${errors.join(' | ')})`);
    });
  } finally {
    await world.close();
  }
}
console.log('menu: all checks passed');
