// The diff viewer, asserted on the seeded `diffs` project (tests/_diffRepo.js): sources from the Compare panel, the
// three modes, File view, search and change navigation, every file-state placeholder, a patch download, untrusted text,
// and Esc. Runs in light then dark; screenshots go to out/diff-*.png (desktop, plus phone for Hunk and Split).
// Run: node harness/playwright/diff.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const check = (cond, what) => { if (!cond) throw new Error(`diff: ${what}`); console.log(`ok: ${what}`); };

const world = await seed();
const { oids } = world.diffs;
try {
  await withPage(async (page) => {
    const errors = [];
    let expectedRefusals = 0; // the one bad ref typed on purpose answers 404 REV_UNKNOWN
    page.on('console', (m) => {
      if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() < 400 || HOST_URLS.test(r.url())) return;
      if (r.status() === 404 && r.url().endsWith('/api/ops/diff.files') && expectedRefusals > 0) { expectedRefusals--; return; }
      errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const diff = page.getByRole('region', { name: 'Diff' });
    const files = diff.getByRole('listbox', { name: 'Changed files' });
    const option = (name) => files.getByRole('option', { name });
    const body = diff.locator('[data-diff-body]');
    const mode = (name) => diff.getByRole('group', { name: 'Diff mode' }).getByRole('button', { name, exact: true });

    for (const scheme of ['light', 'dark']) {
      const shot = async (name) => {
        const file = path.join(outDir, `diff-${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const phoneShot = async (name) => {
        await page.setViewportSize(PHONE);
        // Below md the panel scrolls as a whole: bring the diff body into view.
        await body.scrollIntoViewIfNeeded();
        await shot(`${name}-phone`);
        await page.setViewportSize(DESKTOP);
      };
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=diffs`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=diffs`);
      await page.getByText('The commit graph is coming').waitFor();

      // 12 (part): a bad ref is refused inline, and no diff opens.
      expectedRefusals = 1;
      await page.getByRole('textbox', { name: 'Commit (sha or ref)' }).fill('no-such-ref');
      await page.getByRole('button', { name: 'Show commit' }).click();
      const alert = page.getByRole('region', { name: 'Commit' }).getByRole('alert');
      await alert.waitFor();
      check((await alert.textContent()).includes('no-such-ref'), `${scheme}: a bad ref is refused inline`);
      check(!(await diff.isVisible()), `${scheme}: no diff opens for a bad ref`);

      // 1. A commit from the Compare panel.
      await page.getByRole('textbox', { name: 'Commit (sha or ref)' }).fill('HEAD~1');
      await page.getByRole('button', { name: 'Show commit' }).click();
      await files.waitFor();
      for (const p of [/src\/app\.ts/, /bin\.dat/, /old\/name\.js → new\/name\.js/, /big\.bin/, /huge\.txt/]) {
        check(await option(p).count() === 1, `${scheme}: the file list shows ${p.source}`);
      }

      // 2. Hunk: syntax tokens, word emphasis on a del and an add row, hunk headers.
      await option(/src\/app\.ts/).click();
      await mode('Hunk').click();
      await body.locator('[data-token]').first().waitFor();
      check(await body.locator('[data-token]').count() > 0, `${scheme}: Hunk mode is syntax-highlighted`);
      check(await body.locator('[data-row=del] [data-emphasis]').count() > 0 && await body.locator('[data-row=add] [data-emphasis]').count() > 0, `${scheme}: word emphasis on a deleted and an added row`);
      check(await body.locator('[data-hunk-header]').count() === 2, `${scheme}: Hunk mode shows its hunk headers`);
      await shot('hunk');
      await phoneShot('hunk');

      // 3. Inline: the whole file plus its deleted lines.
      await mode('Inline').click();
      await body.locator('[data-view=unified]').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-diff-body] [data-hunk-header]').length === 0);
      const appLines = readFileSync(path.join(world.diffs.repo.dir, 'src/app.ts'), 'utf8').split('\n').length - 1;
      check(await body.locator('[data-row]').count() === appLines + 2, `${scheme}: Inline shows every line of the file plus the 2 deleted ones`);
      await shot('inline');

      // 4. Split: two numbered sides with emphasis on both; Wrap.
      await mode('Split').click();
      await body.locator('[data-view=split]').waitFor();
      check(await body.locator('[data-side=old] [data-emphasis]').count() > 0 && await body.locator('[data-side=new] [data-emphasis]').count() > 0, `${scheme}: Split emphasises both sides`);
      check(await body.locator('[data-side=old]').count() === await body.locator('[data-side=new]').count(), `${scheme}: Split has an old and a new column per row`);
      await shot('split');
      await page.setViewportSize(PHONE);
      const firstRow = body.locator('[data-side=new]').first();
      const h0 = (await firstRow.boundingBox()).height;
      await diff.getByRole('button', { name: 'Wrap lines' }).click();
      await body.scrollIntoViewIfNeeded();
      const h1 = (await firstRow.boundingBox()).height;
      check(h1 > h0 * 1.5, `${scheme}: Wrap wraps a long line (row ${h0}px → ${h1}px)`);
      await shot('split-wrap-phone');
      await diff.getByRole('button', { name: 'Wrap lines' }).click();
      await shot('split-phone');
      await page.setViewportSize(DESKTOP);

      // 5. File view: content without markers.
      await diff.getByRole('group', { name: 'View' }).getByRole('button', { name: 'File', exact: true }).click();
      await body.locator('[data-view=file]').waitFor();
      const fileText = await body.locator('[data-view=file]').textContent();
      check(await body.locator('[data-row=file]').count() === appLines && fileText.includes('foo(baz)') && !fileText.includes('foo(bar)'), `${scheme}: File view shows the new content only`);
      await shot('file-view');
      await diff.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Diff', exact: true }).click();
      await mode('Hunk').click();
      await body.locator('[data-hunk-header]').first().waitFor();

      // 6. Search and change navigation.
      await body.click();
      await page.keyboard.press('Control+f');
      await diff.getByRole('textbox', { name: 'Find in file' }).fill('const');
      const counter = diff.getByLabel('Match', { exact: true });
      check(/^1\/\d+$/.test(await counter.textContent()), `${scheme}: search counts matches (${await counter.textContent()})`);
      check(await body.locator('[data-match]').count() > 0, `${scheme}: search marks its matches`);
      await shot('search');
      await page.keyboard.press('Escape');
      check(await diff.getByRole('textbox', { name: 'Find in file' }).count() === 0 && await diff.isVisible(), `${scheme}: Esc closes the search, not the diff`);
      await page.keyboard.press('Alt+ArrowDown');
      check(await diff.getByLabel('Change position').textContent() === 'change 2 of 2', `${scheme}: Alt+↓ moves to change 2`);
      const inView = await body.locator('[data-change-index="1"]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      });
      check(inView, `${scheme}: change 2 is in the viewport`);

      // 7. File states.
      await option(/bin\.dat/).click();
      await diff.getByText('Binary file — not shown').waitFor();
      await shot('binary');
      await option(/new\/name\.js/).click();
      check(await diff.getByLabel('Viewed file').textContent().then((t) => t.includes('old/name.js → new/name.js')), `${scheme}: a rename shows old → new`);
      await body.locator('[data-row=add]').first().waitFor();
      await shot('rename');
      await option(/big\.bin/).click();
      const lfs = diff.getByLabel('Git LFS pointer');
      await lfs.waitFor();
      check((await lfs.textContent()).includes('a'.repeat(12)) && (await lfs.textContent()).includes('b'.repeat(12)), `${scheme}: LFS card shows both oids`);
      await shot('lfs');
      await option(/huge\.txt/).click();
      await diff.getByText(/^Large diff \(\d+ changed lines\)$/).waitFor();
      check(await diff.getByRole('button', { name: 'Show anyway' }).isVisible(), `${scheme}: an oversized file offers Show anyway`);
      await shot('oversized');
      await option(/vendor\/lib/).click();
      await diff.getByText('Submodule pointer').waitFor();
      check((await body.textContent()).includes('1111111 → 2222222'), `${scheme}: a gitlink shows its submodule pointers`);
      await shot('submodule');

      // 10. Untrusted text renders as text; Prism ran in manual mode in the built bundle.
      await option(/xss\.html/).click();
      await body.getByText('<img src=x onerror=alert(1)>').first().waitFor();
      check(await diff.locator('img').count() === 0, `${scheme}: a diff line holding <img …> creates no img element`);
      check(await page.evaluate(() => window.Prism?.manual) === true, `${scheme}: window.Prism.manual is true in the built bundle`);

      // 9. Create patch → Download.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
          await diff.getByRole('button', { name: /Create patch/ }).click();
          await page.getByRole('menuitem', { name: 'Download .patch' }).click();
        })(),
      ]);
      const saved = path.join(outDir, `diff-download-${scheme}.patch`);
      await download.saveAs(saved);
      check(download.suggestedFilename() === `${oids.change.slice(0, 7)}.patch`, `${scheme}: the download is named ${download.suggestedFilename()}`);
      check(readFileSync(saved, 'utf8').startsWith(`From ${oids.change} `), `${scheme}: the downloaded patch is a mailbox patch of the commit`);

      // 8. Work in progress and two refs.
      await page.getByRole('button', { name: /^Unstaged changes/ }).click();
      await option(/notes\.txt/).waitFor();
      check(await option(/notes\.txt/).count() === 1, `${scheme}: unstaged lists the untracked file`);
      await option(/notes\.txt/).click();
      await body.locator('[data-row=add]').first().waitFor();
      await page.getByRole('button', { name: /^Staged changes/ }).click();
      await option(/tail\.txt/).waitFor();
      check(await files.getByRole('option').count() === 1, `${scheme}: staged lists the staged file`);
      const compare = async (range) => {
        await page.getByRole('textbox', { name: 'From' }).fill('main');
        await page.getByRole('textbox', { name: 'To' }).fill('side');
        await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: range, exact: true }).click();
        await page.getByRole('button', { name: 'Compare', exact: true }).click();
        await diff.getByLabel('Diff source').filter({ hasText: `main${range}side` }).waitFor();
        await option(/side\.txt/).waitFor();
        return files.getByRole('option').count();
      };
      const two = await compare('..');
      const three = await compare('...');
      check(two !== three, `${scheme}: main..side (${two} files) and main...side (${three} files) differ`);
      await shot('compare');

      // 11. Esc closes the diff.
      await body.click();
      await page.keyboard.press('Escape');
      await page.getByText('The commit graph is coming').waitFor();
      check(!(await diff.isVisible()), `${scheme}: Esc closes the diff and the graph placeholder is back`);
    }
    check(errors.length === 0, `no console errors or unexpected ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
  });
} finally {
  await world.close();
}
