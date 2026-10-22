// Visual check of the UI: seeds one world (seed.mjs), then screenshots each screen in light and dark at desktop and
// phone width into out/, and fails on console errors or ≥400 responses other than the two host URLs that 404 outside cc.
// Run: node harness/playwright/snap.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

const world = await seed();
try {
  await withPage(async (page) => {
    const errors = [];
    let expected409 = false; // the not-a-repo tab's summary answers 409 NOT_A_REPO by design
    page.on('console', (m) => {
      if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !HOST_URLS.test(r.url()) && !(expected409 && r.status() === 409)) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        const shot = async (name) => {
          const file = path.join(outDir, `${name}-${scheme}-${vp}.png`);
          await page.screenshot({ path: file, animations: 'disabled' });
          console.log(`screenshot: ${file}`);
        };
        await page.goto(world.url);
        await page.getByText('No repository open.').waitFor();
        const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        if (dark !== (scheme === 'dark')) throw new Error(`${scheme}: html.dark is ${dark}`);
        await shot('empty');

        await page.getByRole('button', { name: 'Open a repository' }).click();
        await page.getByRole('button', { name: 'gone', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Show worktrees of app' }).click();
        await page.getByRole('button', { name: '(main checkout)' }).waitFor();
        await shot('picker');

        await page.getByRole('button', { name: '(main checkout)' }).click();
        await page.getByText('2 unstaged').or(page.getByText('1 unstaged')).first().waitFor();
        await page.goto(`${world.url}/?project=app&worktree=feat`);
        await page.getByRole('heading', { name: 'app/feat' }).waitFor();
        await page.getByText('feature/login').first().waitFor();
        await shot('two-tabs');

        expected409 = true;
        await page.goto(`${world.url}/?project=notes`);
        await page.getByText('Not a git repository', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Show output' }).first().click();
        await shot('activity-failed');
        // Leave no persisted tab behind that would re-request the not-a-repo summary on the next pass.
        await page.evaluate(() => localStorage.clear());
        await page.goto('about:blank');
        expected409 = false;
      }
    }
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  });
} finally {
  await world.close();
}
