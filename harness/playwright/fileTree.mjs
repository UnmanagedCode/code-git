// Collapsible Tree folders, asserted on the seeded `stage` project (seed.mjs: unstaged src/app.js, old.txt deleted,
// notes.md untracked; one commit touching src/app.js and old.txt): in the Changes panel's Unstaged list a folder
// collapses (its row leaves the list), stays collapsed across Reload changes, opens again when the viewer's Previous
// file lands on a file inside it; in a commit's details the same toggle collapses by click and expands by Space and →.
// Runs in light then dark, each on a fresh seed; screenshots go to out/fileTree/*-{light,dark}.png.
// Run: node harness/playwright/fileTree.mjs   (needs `npm run prepare` first, for frontend/dist)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticEnv } from '../../tests/_git.js';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'fileTree');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const check = (cond, what) => { if (!cond) throw new Error(`fileTree: ${what}`); console.log(`ok: ${what}`); };

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  const { stage } = world;
  const git = (...args) => execFileSync('git', ['-C', stage.dir, ...args], { env: hermeticEnv(stage.home) }).toString();
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const panel = page.locator('[data-slot-name=right]');
      const shot = async (name, target = page) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await target.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=stage`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=stage`);

      const unstaged = panel.getByRole('region', { name: 'Unstaged Files', exact: true });
      const srcToggle = (scope) => scope.getByRole('button', { name: 'src', exact: true });
      const appRow = (scope) => scope.locator('li[role="option"][data-path="src/app.js"]');
      const expanded = async (scope) => (await srcToggle(scope).getAttribute('aria-expanded')) === 'true';
      const diff = page.getByRole('region', { name: 'Diff', exact: true });
      const viewedIs = (p) => page.waitForFunction((want) => document.querySelector('[aria-label="Viewed file"] span')?.textContent === want, p);

      // 1. Changes → Tree: src is a folder toggle, expanded; a click collapses it and its file leaves the list.
      await unstaged.getByRole('option').first().waitFor();
      await panel.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Tree', exact: true }).click();
      await srcToggle(unstaged).waitFor();
      check(await expanded(unstaged), `${scheme}: src starts expanded`);
      check(await appRow(unstaged).count() === 1, `${scheme}: src/app.js is listed under src`);
      await shot('changes-expanded', panel);
      await srcToggle(unstaged).click();
      await appRow(unstaged).waitFor({ state: 'detached' });
      check(!(await expanded(unstaged)), `${scheme}: a click collapses src (aria-expanded false)`);
      check(await unstaged.getByRole('group', { name: 'src', exact: true }).count() === 0, `${scheme}: the collapsed folder renders no group`);
      await shot('changes-collapsed', panel);

      // 2. Reload changes: the list is refetched, the folder stays collapsed.
      const reloaded = page.waitForResponse((r) => r.url().includes('/api/ops/diff.files') && r.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Reload changes', exact: true }).click();
      await reloaded;
      await srcToggle(unstaged).waitFor();
      check(!(await expanded(unstaged)) && await appRow(unstaged).count() === 0, `${scheme}: src stays collapsed after Reload changes`);

      // 3. Open notes.md, then the viewer's Previous file (tree order: src/app.js, notes.md, old.txt): src opens.
      await unstaged.locator('li[role="option"][data-path="notes.md"]').click();
      await viewedIs('notes.md');
      check(!(await expanded(unstaged)), `${scheme}: viewing notes.md leaves src collapsed`);
      await diff.getByRole('button', { name: 'Previous file', exact: true }).click();
      await viewedIs('src/app.js');
      await appRow(unstaged).waitFor();
      check(await expanded(unstaged), `${scheme}: Previous file onto src/app.js expands src`);
      check(await appRow(unstaged).getAttribute('aria-current') === 'true', `${scheme}: src/app.js is the viewed row`);
      await shot('changes-revealed');

      // 4. A commit's details: the same toggle collapses by click, expands by Space, collapses and expands by ← / →.
      await page.keyboard.press('Escape');
      await diff.waitFor({ state: 'detached' });
      const oid = git('rev-parse', 'HEAD').trim();
      await page.locator(`[data-row-id="${oid}"]`).click();
      const details = page.getByRole('complementary', { name: 'Commit details', exact: true });
      const files = details.getByRole('listbox', { name: 'Changed files', exact: true });
      await srcToggle(files).waitFor();
      check(await expanded(files) && await appRow(files).count() === 1, `${scheme}: the details list src expanded with src/app.js`);
      await srcToggle(files).click();
      await appRow(files).waitFor({ state: 'detached' });
      check(!(await expanded(files)), `${scheme}: a click collapses src in the details`);
      await shot('details-collapsed', panel);
      await srcToggle(files).focus();
      await page.keyboard.press('Space');
      await appRow(files).waitFor();
      check(await expanded(files), `${scheme}: Space expands the focused folder`);
      await page.keyboard.press('ArrowLeft');
      await appRow(files).waitFor({ state: 'detached' });
      check(!(await expanded(files)), `${scheme}: ← collapses the focused folder`);
      await page.keyboard.press('ArrowRight');
      await appRow(files).waitFor();
      check(await expanded(files), `${scheme}: → expands it`);
      await page.keyboard.press('ArrowDown');
      check(await page.evaluate(() => document.activeElement?.getAttribute('data-path')) === 'src/app.js', `${scheme}: ↓ from the folder toggle focuses its first file`);
      await shot('details-expanded', panel);

      check(errors.length === 0, `${scheme}: no console errors or ≥400 responses (${errors.join('; ')})`);
    });
  } finally {
    await world.close();
  }
}
console.log('fileTree: all checks passed');
