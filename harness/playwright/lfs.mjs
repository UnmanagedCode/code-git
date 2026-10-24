// The LFS path on the `lfs` world (lfsSeed.mjs), in light then dark, each on a fresh seed, every step checked against
// git: Repository actions → LFS… (only lfs.status is posted) → Track `*.dat` → listed, Untrack → gone → List files (its
// helper text says what git-lfs may write) → a.bin not downloaded → Pull: a.bin's bytes,
// Downloaded Yes → Prune… (the destructive step) → confirmed: old.bin's object deleted, a.bin's kept → a System without
// git-lfs: the not-installed state. Screenshots (the dialog at 1280×800 and 390×844, the prune step, the absent state)
// into out/lfs/. Fails on a console error or a ≥400 response other than the two host URLs. Exits with a SKIP line when
// this machine's git-lfs is missing or older than 3.2.0.
// Run: node harness/playwright/lfs.mjs   (needs `npm run prepare` first, for frontend/dist)
import fs, { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { LFS_SKIP, lfsAvailable } from '../../tests/_lfs.js';
import { seedLfs } from './lfsSeed.mjs';

if (!lfsAvailable()) {
  console.log(`lfs: SKIP: ${LFS_SKIP}`);
  process.exit(0);
}
const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'lfs');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`lfs: ${what}`); console.log(`ok: ${what}`); };

/** Drives one world in `scheme`: `fn(page, h)` with the shared helpers; fails on unexpected errors. */
async function drive(world, scheme, fn) {
  await withPage(async (page) => {
    const errors = [];
    const ops = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('request', (r) => { const op = /\/api\/ops\/([\w.]+)$/.exec(new URL(r.url()).pathname)?.[1]; if (op) ops.push(op); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(VIEWPORTS.desktop);
    const shot = async (name) => {
      const file = path.join(outDir, `${name}-${scheme}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const dialog = page.getByRole('dialog', { name: 'Git LFS', exact: true });
    const openDialog = async () => {
      await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
      await page.getByRole('menu').getByRole('menuitem', { name: 'LFS…', exact: true }).click();
      await dialog.waitFor();
    };
    await page.goto(`${world.url}/?project=lfs`);
    await page.getByRole('group', { name: 'HEAD', exact: true }).waitFor();
    await fn(page, { dialog, openDialog, shot, ops });
    check(errors.length === 0, `no console errors or failed responses${errors.length ? `: ${errors.join('; ')}` : ''}`);
  });
}

for (const scheme of ['light', 'dark']) {
  const world = await seedLfs();
  const git = (...args) => world.repo.git(...args);
  try {
    await drive(world, scheme, async (page, { dialog, openDialog, shot, ops }) => {
      const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
      const patterns = dialog.getByRole('region', { name: 'Tracked patterns', exact: true });
      const files = dialog.getByRole('region', { name: 'LFS files', exact: true });

      // 1. Opening reads only
      await openDialog();
      await patterns.getByText('*.bin', { exact: true }).waitFor();
      check((await dialog.getByRole('paragraph').first().textContent()).startsWith('git-lfs 3.'), 'the dialog names the System\'s git-lfs version');
      check(!ops.some((o) => o.startsWith('lfs.') && o !== 'lfs.status'), `opening posts lfs.status only (${ops.filter((o) => o.startsWith('lfs.')).join(', ')})`);
      await shot('dialog-desktop');
      await page.setViewportSize(VIEWPORTS.phone);
      await shot('dialog-phone');
      await page.setViewportSize(VIEWPORTS.desktop);

      // 2. Track, then Untrack
      await dialog.getByRole('textbox', { name: 'Pattern', exact: true }).fill('*.dat');
      await dialog.getByRole('button', { name: 'Track', exact: true }).click();
      await patterns.getByText('*.dat', { exact: true }).waitFor();
      check(fs.readFileSync(path.join(world.repo.dir, '.gitattributes'), 'utf8').includes('*.dat filter=lfs diff=lfs merge=lfs -text'), 'git agrees: .gitattributes tracks *.dat');
      await dialog.getByRole('button', { name: 'Untrack *.dat', exact: true }).click();
      await patterns.getByText('*.dat', { exact: true }).waitFor({ state: 'detached' });
      check(!fs.readFileSync(path.join(world.repo.dir, '.gitattributes'), 'utf8').includes('*.dat'), 'git agrees: *.dat is untracked');

      // 3. List files: the helper text, then the table
      check((await files.textContent()).includes('may create .git/lfs and install its hooks'), 'List files says what git-lfs may write');
      await files.getByRole('button', { name: 'List files', exact: true }).click();
      const row = files.getByRole('row').filter({ hasText: 'a.bin' });
      await row.waitFor();
      check((await row.getByRole('cell').allTextContents()).join(' | ') === 'a.bin | 4 B | No', 'a.bin is listed, not downloaded');

      // 4. Pull
      await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
      await toast('Pulled LFS files').waitFor();
      await row.filter({ hasText: 'Yes' }).waitFor();
      check(fs.readFileSync(path.join(world.repo.dir, 'a.bin'), 'utf8') === 'one\n', 'git agrees: a.bin holds its bytes');
      check(git('status', '--porcelain') === '', 'the checkout stays clean');

      // 5. Prune: the destructive step, then confirmed
      git('lfs', 'fetch', '--all', 'origin');
      check(fs.existsSync(world.objectPath('old\n')), 'old.bin\'s object was fetched for the prune');
      await dialog.getByRole('button', { name: 'Prune…', exact: true }).click();
      const step = page.getByRole('dialog', { name: 'Prune LFS objects?', exact: true });
      await step.waitFor();
      check((await step.textContent()).includes('they must be downloaded again'), 'the prune step says what it deletes');
      await shot('prune-desktop');
      await step.getByRole('button', { name: 'Prune', exact: true }).click();
      await toast('Pruned LFS objects').waitFor();
      await dialog.waitFor();
      check(!fs.existsSync(world.objectPath('old\n')) && fs.existsSync(world.objectPath('one\n')), 'git agrees: old.bin\'s object pruned, a.bin\'s kept');
      await files.getByRole('row').filter({ hasText: 'a.bin' }).waitFor();
      check(true, 'back from the step, the session\'s file list is shown again');
    });
  } finally {
    await world.close();
  }

  // 6. A System without git-lfs
  const absent = await seedLfs({ absent: true });
  try {
    await drive(absent, scheme, async (page, { dialog, openDialog, shot }) => {
      await openDialog();
      await dialog.getByText("git-lfs is not installed on this project's System.", { exact: true }).waitFor();
      check(await dialog.getByRole('button', { name: 'Pull', exact: true }).count() === 0, 'no op is offered without git-lfs');
      await shot('absent-desktop');
    });
  } finally {
    await absent.close();
  }
}
console.log('lfs: all checks passed');
