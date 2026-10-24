// The diff viewer, asserted on the seeded `diffs` project (tests/_diffRepo.js): sources from the Compare panel, the
// file list that drives it from the right slot (counts, Tree, the phone's Files (n) dialog), every Diff scope × Diff
// layout combination, Ignore whitespace, the prefs persisted and a legacy stored value cleaned, File view, search and
// change navigation, every file-state placeholder, a patch download, untrusted text, and Esc. Runs in light then dark;
// screenshots go to out/diff-*.png (desktop, plus phone for Hunk+Split and Full+Split).
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
    const right = page.locator('[data-slot-name=right]');
    // A Compare-panel diff's list: the right slot's Changed files panel.
    const filesPanel = right.getByRole('complementary', { name: 'Changed files panel', exact: true });
    const files = filesPanel.getByRole('listbox', { name: 'Changed files', exact: true });
    const option = (name) => files.getByRole('option', { name });
    const body = diff.locator('[data-diff-body]');
    const scope = (name) => diff.getByRole('group', { name: 'Diff scope', exact: true }).getByRole('button', { name, exact: true });
    const layout = (name) => diff.getByRole('group', { name: 'Diff layout', exact: true }).getByRole('button', { name, exact: true });

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
      await page.getByRole('region', { name: 'Commit graph' }).waitFor();

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
      check(await diff.getByRole('listbox').count() === 0, `${scheme}: the diff has no file list of its own`);
      check(/\+\d+ −\d+/.test(await option(/src\/app\.ts/).textContent()), `${scheme}: a text file shows its +added −deleted`);
      check((await option(/bin\.dat/).textContent()).includes('binary') && !/[+−]\d/.test(await option(/bin\.dat/).textContent()), `${scheme}: a binary file says binary, no numbers`);
      check((await option(/vendor\/lib/).textContent()).includes('submodule'), `${scheme}: a gitlink says submodule`);
      // Tree: the panel's toggle nests the files, and a tree row still drives the diff.
      await filesPanel.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Tree', exact: true }).click();
      await files.getByRole('group', { name: 'src', exact: true }).waitFor();
      await files.getByRole('group', { name: 'src', exact: true }).getByRole('option', { name: /app\.ts/ }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Viewed file"]')?.textContent?.includes('src/app.ts'));
      check(await files.locator('[data-path="src/app.ts"][aria-current="true"]').count() === 1, `${scheme}: Tree nests the files and a tree row views its file`);
      await shot('tree');
      await filesPanel.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Path', exact: true }).click();

      // 2–4. Each Diff scope × Diff layout: syntax tokens and word emphasis on both sides everywhere; two hunk headers in
      // Hunk scope, none in Full; Inline one column (Full: every file line plus the 2 deleted ones); Split two equal
      // columns, checked at phone width with and without Wrap.
      await option(/src\/app\.ts/).click();
      const appLines = readFileSync(path.join(world.diffs.repo.dir, 'src/app.ts'), 'utf8').split('\n').length - 1;
      for (const [s, l] of [['Hunk', 'Inline'], ['Hunk', 'Split'], ['Full', 'Inline'], ['Full', 'Split']]) {
        const name = `${s.toLowerCase()}-${l.toLowerCase()}`;
        await scope(s).click();
        await layout(l).click();
        check(await scope(s).getAttribute('aria-pressed') === 'true' && await layout(l).getAttribute('aria-pressed') === 'true', `${scheme}: ${name}: both toggles pressed`);
        const headers = s === 'Hunk' ? 2 : 0;
        if (l === 'Inline') {
          const rows = s === 'Full' ? appLines + 2 : null;
          await page.waitForFunction(({ headers, rows }) => {
            const v = document.querySelector('[data-diff-body] [data-view=unified]');
            return !!v && v.querySelectorAll('[data-hunk-header]').length === headers && (rows === null || v.querySelectorAll('[data-row]').length === rows);
          }, { headers, rows });
          if (rows !== null) check(true, `${scheme}: ${name} shows every line of the file plus the 2 deleted ones`);
        } else {
          await page.waitForFunction((headers) => {
            const v = document.querySelector('[data-diff-body] [data-view=split]');
            return !!v && v.querySelectorAll('[data-hunk-header]').length === headers && v.querySelectorAll('[data-side=new]').length > 0;
          }, headers);
          check(await body.locator('[data-side=old]').count() === await body.locator('[data-side=new]').count(), `${scheme}: ${name} has an old and a new column per row`);
        }
        check(await body.locator('[data-hunk-header]').count() === headers, `${scheme}: ${name} shows ${headers} hunk headers`);
        await body.locator('[data-token]').first().waitFor();
        check(await body.locator('[data-token]').count() > 0, `${scheme}: ${name} is syntax-highlighted`);
        const [oldSide, newSide] = l === 'Inline' ? ['[data-row=del]', '[data-row=add]'] : ['[data-side=old]', '[data-side=new]'];
        check(await body.locator(`${oldSide} [data-emphasis]`).count() > 0 && await body.locator(`${newSide} [data-emphasis]`).count() > 0, `${scheme}: ${name} emphasises words on both sides`);
        await shot(name);
        if (l === 'Split') {
          await page.setViewportSize(PHONE);
          await body.scrollIntoViewIfNeeded();
          const firstRow = body.locator('[data-side=new]').first();
          const h0 = (await firstRow.boundingBox()).height;
          await diff.getByRole('button', { name: 'Wrap lines', exact: true }).click();
          await body.scrollIntoViewIfNeeded();
          const h1 = (await firstRow.boundingBox()).height;
          check(h1 > h0 * 1.5, `${scheme}: ${name}: Wrap wraps a long line (row ${h0}px → ${h1}px)`);
          await shot(`${name}-wrap-phone`);
          await diff.getByRole('button', { name: 'Wrap lines', exact: true }).click();
          await body.scrollIntoViewIfNeeded();
          await shot(`${name}-phone`);
          await page.setViewportSize(DESKTOP);
        }
      }

      // 4b. Ignore whitespace: w.txt's change is whitespace only ('a b' → 'a  b'), so under git's -w it is no change at
      // all and leaves the list; off, it is listed (+1 −1) and shows its change again.
      const ignoreWs = diff.getByRole('button', { name: 'Ignore whitespace', exact: true });
      await scope('Hunk').click();
      await layout('Inline').click();
      await option(/w\.txt/).click();
      await body.locator('[data-row=add]').first().waitFor();
      check(await body.locator('[data-row=del]').count() === 1 && await body.locator('[data-row=add]').count() === 1, `${scheme}: w.txt shows its whitespace change`);
      check((await option(/w\.txt/).textContent()).includes('+1 −1'), `${scheme}: w.txt's row counts +1 −1`);
      await ignoreWs.click();
      check(await ignoreWs.getAttribute('aria-pressed') === 'true', `${scheme}: Ignore whitespace is pressed`);
      await option(/w\.txt/).waitFor({ state: 'detached' });
      await option(/src\/app\.ts/).click();
      await body.locator('[data-row=add]').first().waitFor();
      check(await option(/w\.txt/).count() === 0 && await option(/src\/app\.ts/).count() === 1, `${scheme}: Ignore whitespace drops the whitespace-only w.txt from the list and keeps src/app.ts`);
      await shot('ignore-ws');
      await ignoreWs.click();
      await option(/w\.txt/).waitFor();
      await option(/w\.txt/).click();
      await body.locator('[data-row=add]').first().waitFor();
      check(await ignoreWs.getAttribute('aria-pressed') === 'false' && (await option(/w\.txt/).textContent()).includes('+1 −1'), `${scheme}: Ignore whitespace off brings w.txt's change back`);

      // 4c. Full+Split and Ignore whitespace survive a reload; a stored legacy value (mode, whitespace) loads as the
      // defaults and is rewritten without its legacy keys.
      const reopen = async () => {
        await page.reload();
        await page.getByRole('textbox', { name: 'Commit (sha or ref)' }).fill('HEAD~1');
        await page.getByRole('button', { name: 'Show commit' }).click();
        await files.waitFor();
        await scope('Hunk').waitFor();
      };
      const isPressed = async (b) => (await b.getAttribute('aria-pressed')) === 'true';
      await scope('Full').click();
      await layout('Split').click();
      await ignoreWs.click();
      await reopen();
      check(await isPressed(scope('Full')) && await isPressed(layout('Split')) && await isPressed(ignoreWs), `${scheme}: Full, Split and Ignore whitespace persist across a reload`);
      await page.evaluate(() => localStorage.setItem('code-git:diff-prefs', JSON.stringify({ mode: 'split', whitespace: 'eol' })));
      await reopen();
      check(await isPressed(scope('Hunk')) && await isPressed(layout('Inline')) && !(await isPressed(ignoreWs)), `${scheme}: a legacy stored mode / whitespace loads as Hunk+Inline, whitespace shown`);
      const storedPrefs = JSON.parse(await page.evaluate(() => localStorage.getItem('code-git:diff-prefs')));
      check(!('mode' in storedPrefs) && !('whitespace' in storedPrefs) && storedPrefs.scope === 'hunk', `${scheme}: the stored prefs were rewritten without mode / whitespace`);
      await option(/src\/app\.ts/).click();
      await body.locator('[data-hunk-header]').first().waitFor();

      // 5. File view: content without markers.
      await diff.getByRole('group', { name: 'View' }).getByRole('button', { name: 'File', exact: true }).click();
      await body.locator('[data-view=file]').waitFor();
      const fileText = await body.locator('[data-view=file]').textContent();
      check(await body.locator('[data-row=file]').count() === appLines && fileText.includes('foo(baz)') && !fileText.includes('foo(bar)'), `${scheme}: File view shows the new content only`);
      await shot('file-view');
      await diff.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Diff', exact: true }).click();
      await scope('Hunk').click();
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

      // Phone (no right slot): the diff header's Files (n) opens the list as a dialog; a plain click views the file and closes it.
      await page.setViewportSize(PHONE);
      await diff.getByRole('button', { name: /^Files \(\d+\)$/ }).click();
      const filesDialog = page.getByRole('dialog', { name: 'Changed files', exact: true });
      await filesDialog.getByRole('option', { name: /huge\.txt/ }).waitFor();
      await shot('files-dialog-phone');
      await filesDialog.getByRole('option', { name: /huge\.txt/ }).click();
      await filesDialog.waitFor({ state: 'hidden' });
      await diff.getByText(/^Large diff \(\d+ changed lines\)$/).waitFor();
      check(await diff.getByLabel('Viewed file').textContent().then((t) => t.includes('huge.txt')), `${scheme}: phone: Files (n) picks huge.txt and closes`);
      await page.setViewportSize(DESKTOP);

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
      // Their lists are the Changes panel's sections.
      const unstaged = right.getByRole('region', { name: 'Unstaged Files', exact: true });
      const staged = right.getByRole('region', { name: 'Staged Files', exact: true });
      await page.getByRole('button', { name: /^Unstaged changes/ }).click();
      await unstaged.getByRole('option', { name: /notes\.txt/ }).waitFor();
      check(await unstaged.getByRole('option', { name: /notes\.txt/ }).count() === 1, `${scheme}: unstaged lists the untracked file`);
      await unstaged.getByRole('option', { name: /notes\.txt/ }).click();
      await body.locator('[data-row=add]').first().waitFor();
      check(await unstaged.locator('[data-path="notes.txt"][aria-current="true"]').count() === 1, `${scheme}: the unstaged section marks the viewed file`);
      await page.getByRole('button', { name: /^Staged changes/ }).click();
      await staged.getByRole('option', { name: /tail\.txt/ }).waitFor();
      check(await staged.getByRole('option').count() === 1, `${scheme}: staged lists the staged file`);
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
      await page.getByRole('region', { name: 'Commit graph' }).waitFor();
      check(!(await diff.isVisible()), `${scheme}: Esc closes the diff and the commit graph is back`);
    }
    check(errors.length === 0, `no console errors or unexpected ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
  });
} finally {
  await world.close();
}
