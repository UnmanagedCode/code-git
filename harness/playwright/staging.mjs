// The staging path, asserted on the seeded `stage` and `detached` projects (seed.mjs): the Changes panel lists, a hunk and
// two lines staged from the diff, lines discarded after a confirmation, the Discard all dialog cancelled, a commit with the
// template pre-filled, a message-only amend, the detached banner, and the Changes dialog on a phone. Each step is checked
// against git itself. Runs in light then dark, each on a fresh seed; screenshots go to out/staging-*.png.
// Run: node harness/playwright/staging.mjs   (needs `npm run prepare` first, for frontend/dist)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticEnv } from '../../tests/_git.js';
import { BROWSER } from './resolve.mjs';
import { seed, STAGE_BASE } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const check = (cond, what) => { if (!cond) throw new Error(`staging: ${what}`); console.log(`ok: ${what}`); };
const lines = (ls) => `${ls.join('\n')}\n`;

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  const { stage } = world;
  const git = (...args) => execFileSync('git', ['-C', stage.dir, ...args], { env: hermeticEnv(stage.home) }).toString();
  const indexOf = (p) => git('show', `:${p}`);
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const shot = async (name) => {
        const file = path.join(outDir, `staging-${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=stage`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=stage`);

      const panel = page.locator('[data-slot-name=right]');
      const unstaged = panel.getByRole('region', { name: 'Unstaged Files' });
      const staged = panel.getByRole('region', { name: 'Staged Files' });
      const commitBox = panel.getByRole('region', { name: 'Commit message' });
      const summary = commitBox.getByRole('textbox', { name: 'Summary' });
      const rowPaths = (region) => region.getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
      const diff = page.getByRole('region', { name: 'Diff' });
      const body = diff.locator('[data-diff-body]');

      // 1. The lists, and the template pre-filled.
      await unstaged.getByRole('option').first().waitFor();
      check(JSON.stringify(await rowPaths(unstaged)) === JSON.stringify(['old.txt', 'src/app.js', 'notes.md']), `${scheme}: unstaged lists the deleted, modified and untracked files`);
      check(await staged.getByText('Nothing staged.').isVisible(), `${scheme}: nothing staged yet`);
      await page.waitForFunction(() => document.querySelector('[data-slot-name=right] input[aria-label=Summary]')?.value === 'feat:');
      check(await commitBox.getByRole('button', { name: 'Commit', exact: true }).isDisabled(), `${scheme}: the unedited template cannot be committed (nothing staged either)`);
      await shot('panel');

      // 2. Open the unstaged diff of src/app.js: two hunks, each with Stage hunk.
      await unstaged.getByRole('option', { name: /src\/app\.js/ }).click();
      await body.locator('[data-hunk-header]').nth(1).waitFor();
      check(await diff.getByRole('button', { name: 'Stage hunk' }).count() === 2, `${scheme}: each hunk header offers Stage hunk`);
      check(await body.getByRole('button', { name: /^Select (added|removed) line/ }).count() === 5, `${scheme}: a toggle per added/removed line (2 + 3)`);
      await shot('diff');

      // 3. Stage the first hunk: the index gets line 3's change only.
      await diff.getByRole('button', { name: 'Stage hunk' }).first().click();
      await staged.getByRole('option', { name: /src\/app\.js/ }).waitFor();
      const afterHunk = STAGE_BASE.map((l, i) => (i === 2 ? 'const l3 = 300;' : l));
      check(indexOf('src/app.js') === lines(afterHunk), `${scheme}: Stage hunk staged exactly the first hunk`);

      // 4. Select two lines of the remaining hunk (l25's pair) and stage them; `extra` stays unstaged.
      await body.locator('[data-hunk-header]').first().waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-diff-body] [data-hunk-header]').length === 1);
      await body.getByRole('button', { name: 'Select removed line 25' }).click();
      await body.getByRole('button', { name: 'Select added line 25' }).click();
      const bar = diff.getByRole('toolbar', { name: 'Line selection' });
      check((await bar.textContent()).includes('2 lines selected'), `${scheme}: the selection bar counts 2 lines`);
      await shot('selection');
      await bar.getByRole('button', { name: 'Stage lines' }).click();
      await bar.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('[data-diff-body] [data-row=add]').length === 1);
      const afterLines = afterHunk.map((l, i) => (i === 24 ? 'const l25 = 2500;' : l));
      check(indexOf('src/app.js') === lines(afterLines), `${scheme}: Stage lines staged exactly the selected pair`);

      // 5. Discard the remaining added line, after the confirmation previews it.
      await body.getByRole('button', { name: 'Select added line 26' }).click();
      await diff.getByRole('button', { name: 'Discard lines…' }).click();
      const confirm = page.getByRole('dialog');
      await confirm.waitFor();
      check((await confirm.getByLabel('Lines').textContent()) === '+const extra = true;', `${scheme}: the discard confirmation previews the line`);
      await shot('discard-lines');
      await confirm.getByRole('button', { name: 'Discard lines' }).click();
      await confirm.waitFor({ state: 'detached' });
      await page.waitForFunction(() => ![...document.querySelectorAll('[data-slot-name=right] [role=region][aria-label="Unstaged Files"] [role=option]')].some((e) => e.getAttribute('data-path') === 'src/app.js'));
      check(readFileSync(path.join(stage.dir, 'src/app.js'), 'utf8') === lines(afterLines), `${scheme}: the worktree lost exactly the discarded line`);

      // 6. Discard all names the untracked file and the count; Cancel leaves everything.
      await unstaged.getByRole('button', { name: 'Discard all…' }).click();
      await confirm.waitFor();
      check((await confirm.getByRole('list', { name: 'Affected files' }).textContent()) === 'notes.md', `${scheme}: Discard all names the untracked file`);
      check(await confirm.getByText('1 file', { exact: true }).isVisible() && await confirm.getByText('This cannot be undone.').isVisible(), `${scheme}: Discard all shows the count and that it cannot be undone`);
      await shot('discard-all');
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await confirm.waitFor({ state: 'detached' });
      check(git('status', '--porcelain', '--', 'notes.md').startsWith('??'), `${scheme}: Cancel discarded nothing`);

      // 7. Commit: the template's summary completed, a description.
      await summary.fill('feat: stage hunks and lines');
      await commitBox.getByRole('textbox', { name: 'Description' }).fill('From the Changes panel.');
      await commitBox.getByRole('button', { name: 'Commit changes to 1 file' }).click();
      await staged.getByText('Nothing staged.').waitFor();
      check(git('log', '-1', '--format=%B') === 'feat: stage hunks and lines\n\nFrom the Changes panel.\n\n', `${scheme}: the commit has the joined message`);
      check(git('show', 'HEAD:src/app.js') === lines(afterLines), `${scheme}: the commit holds the staged content`);
      await page.waitForFunction(() => document.querySelector('[data-slot-name=right] input[aria-label=Summary]')?.value === 'feat:');
      check(true, `${scheme}: the template pre-fills the box again after the commit`);

      // 8. Message-only amend: the tree stays, the message changes.
      const tree = git('rev-parse', 'HEAD^{tree}');
      await panel.getByRole('checkbox', { name: 'Amend previous commit' }).check();
      await page.waitForFunction(() => document.querySelector('[data-slot-name=right] input[aria-label=Summary]')?.value === 'feat: stage hunks and lines');
      await summary.fill('feat: stage hunks and lines from the diff');
      await shot('amend');
      await commitBox.getByRole('button', { name: 'Update message only' }).click();
      await page.waitForFunction(() => !document.querySelector('[data-slot-name=right] input[type=checkbox]')?.checked);
      check(git('log', '-1', '--format=%s').trim() === 'feat: stage hunks and lines from the diff' && git('rev-parse', 'HEAD^{tree}') === tree, `${scheme}: Update message only rewrote the message and kept the tree`);
      check(git('rev-list', '--count', 'HEAD').trim() === '2', `${scheme}: the amend replaced HEAD (still 2 commits)`);

      // 9. The detached project shows the banner and says so on the button.
      await page.goto(`${world.url}/?project=detached`);
      const banner = panel.getByRole('status');
      await banner.waitFor();
      check((await banner.textContent()).startsWith('Detached HEAD at '), `${scheme}: the detached banner shows`);
      await shot('detached');

      // 10. Phone: the Changes button opens the dialog; a file is staged from it.
      await page.setViewportSize(PHONE);
      await page.goto(`${world.url}/?project=stage`);
      check(!(await panel.isVisible()), `${scheme}: the right slot is hidden on a phone`);
      await page.getByRole('button', { name: /^Changes \(\d+\)$/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Changes' });
      await dlg.getByRole('region', { name: 'Unstaged Files' }).getByRole('option').first().waitFor();
      await shot('phone-dialog');
      await dlg.getByRole('button', { name: 'Stage old.txt' }).click();
      await dlg.getByRole('region', { name: 'Staged Files' }).getByRole('option', { name: /old\.txt/ }).waitFor();
      check(git('status', '--porcelain', '--', 'old.txt').startsWith('D '), `${scheme}: staging from the phone dialog staged the deletion`);
      await shot('phone-staged');
      check(errors.length === 0, `${scheme}: no console errors or ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
