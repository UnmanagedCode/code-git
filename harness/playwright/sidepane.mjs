// The Changes side pane's layout, asserted on the seeded `stage` project with 63 unstaged and 60 staged files (far
// taller than any pane) and on `detached`: the pane never scrolls, each list scrolls inside its own section, the split
// is fit-then-equal, and the Summary field and commit button stay in view. Steps: A desktop with both lists long; B the
// Activity panel open (the pane about 354 px tall); C the Changes (n) dialog at 390×844; D one section empty; E both
// short, the commit box pinned at the bottom; F below the floors, where the pane scrolls as a last resort but each list
// keeps two rows and the commit box keeps Summary and its button. Runs in light then dark, each on a fresh seed;
// screenshots go to out/sidepane/*-{light,dark}.png.
// Run: node harness/playwright/sidepane.mjs   (needs `npm run prepare` first, for frontend/dist)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticEnv } from '../../tests/_git.js';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'sidepane');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const COUNT = 60;
const num = (n) => String(n).padStart(3, '0');
const check = (cond, what) => { if (!cond) throw new Error(`sidepane: ${what}`); console.log(`ok: ${what}`); };
// Within a pixel of layout rounding.
const near = (a, b) => Math.abs(a - b) <= 1;
const inside = (inner, outer) => inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;

// Everything the steps measure, read in one page.evaluate: the pane, each section and its list scroller, the commit box.
const measure = (page, paneSelector) => page.evaluate((sel) => {
  const pane = document.querySelector(sel);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
  const section = (name) => {
    const sec = [...pane.querySelectorAll('section')].find((s) => s.getAttribute('aria-label') === name);
    const list = sec.querySelector('[data-section-list]');
    const lr = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('li[role=option]')].filter((li) => {
      const r = li.getBoundingClientRect();
      return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
    });
    return { rect: rect(sec), listRect: rect(list), scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, scrollTop: list.scrollTop, visibleRows: rows.length };
  };
  const box = [...pane.querySelectorAll('section')].find((s) => s.getAttribute('aria-label') === 'Commit message');
  const fields = box.querySelector('[data-commit-fields]');
  const summary = box.querySelector('input[aria-label=Summary]');
  const button = [...box.querySelectorAll('button')].find((b) => /^Commit/.test(b.textContent));
  return {
    pane: { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, scrollTop: pane.scrollTop, rect: rect(pane) },
    unstaged: section('Unstaged Files'),
    staged: section('Staged Files'),
    commit: { rect: rect(box), fields: { scrollHeight: fields.scrollHeight, clientHeight: fields.clientHeight, scrollTop: fields.scrollTop, rect: rect(fields) } },
    summary: rect(summary),
    button: rect(button),
    innerHeight: window.innerHeight,
  };
}, paneSelector);

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  const { stage } = world;
  const git = (...args) => execFileSync('git', ['-C', stage.dir, ...args], { env: hermeticEnv(stage.home) }).toString();
  // Before the first page load: COUNT untracked and COUNT staged files under bulk/.
  mkdirSync(path.join(stage.dir, 'bulk'), { recursive: true });
  for (let i = 1; i <= COUNT; i++) {
    writeFileSync(path.join(stage.dir, 'bulk', `u-${num(i)}.txt`), `u ${i}\n`);
    writeFileSync(path.join(stage.dir, 'bulk', `s-${num(i)}.txt`), `s ${i}\n`);
  }
  git('add', 'bulk/s-*');
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=stage`);
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${world.url}/?project=stage`);

      const SLOT = '[data-slot-name=right]';
      const slot = page.locator(SLOT);
      const unstaged = slot.getByRole('region', { name: 'Unstaged Files', exact: true });
      const staged = slot.getByRole('region', { name: 'Staged Files', exact: true });
      await unstaged.getByRole('option').first().waitFor();
      await staged.getByRole('option').first().waitFor();
      const activity = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('button', { name: 'Activity', exact: true });
      const setActivity = async (open) => {
        if ((await activity.getAttribute('aria-expanded')) !== String(open)) await activity.click();
        await page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute('aria-expanded') === String(want), ['[aria-label=Activity] button[aria-expanded]', open]);
      };
      const paneHeight = () => page.evaluate((sel) => document.querySelector(sel).clientHeight, SLOT);
      // The wheel over a list's middle scrolls that list only.
      const wheelOver = async (region, deltaY) => {
        const b = await region.locator('[data-section-list]').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(150);
      };
      const lastRowInside = (region, file) => region.locator('[data-section-list]').evaluate((list, f) => {
        const li = list.querySelector(`li[data-path="${f}"]`);
        const r = li.getBoundingClientRect(); const lr = list.getBoundingClientRect();
        return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
      }, file);

      // A. Desktop, both lists long, Activity collapsed.
      await setActivity(false);
      let m = await measure(page, SLOT);
      check(m.pane.scrollHeight <= m.pane.clientHeight, `${scheme}: A: the pane does not scroll (${m.pane.scrollHeight} ≤ ${m.pane.clientHeight})`);
      check(m.unstaged.scrollHeight > m.unstaged.clientHeight && m.staged.scrollHeight > m.staged.clientHeight, `${scheme}: A: both lists overflow and scroll on their own`);
      check(near(m.unstaged.rect.height, m.staged.rect.height), `${scheme}: A: two long sections split equally (${m.unstaged.rect.height} / ${m.staged.rect.height})`);
      check(inside(m.commit.rect, m.pane.rect) && m.commit.rect.bottom <= m.innerHeight && m.commit.fields.scrollHeight <= m.commit.fields.clientHeight,
        `${scheme}: A: the whole commit box is in view and its fields do not overflow`);
      await wheelOver(unstaged, 300);
      m = await measure(page, SLOT);
      check(m.unstaged.scrollTop > 0 && m.pane.scrollTop === 0 && m.staged.scrollTop === 0, `${scheme}: A: a wheel over the unstaged list scrolls only that list`);
      await unstaged.locator('[data-section-list]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await staged.locator('[data-section-list]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      check(await lastRowInside(unstaged, `bulk/u-${num(COUNT)}.txt`), `${scheme}: A: the unstaged list scrolls to its last row`);
      check(await lastRowInside(staged, `bulk/s-${num(COUNT)}.txt`), `${scheme}: A: the staged list scrolls to its last row`);
      await shot('long-desktop');

      // B. Activity open: the pane is about 354 px tall.
      await setActivity(true);
      await page.waitForFunction(([sel, before]) => document.querySelector(sel).clientHeight < before, [SLOT, m.pane.clientHeight]);
      // A scrolled list cuts a row at its top: count the rows from the top.
      await page.evaluate(() => document.querySelectorAll('[data-slot-name=right] [data-section-list]').forEach((el) => { el.scrollTop = 0; }));
      m = await measure(page, SLOT);
      console.log(`B: pane height with Activity open: ${m.pane.clientHeight}`);
      check(m.pane.clientHeight <= 360, `${scheme}: B: the pane is short (${m.pane.clientHeight} ≤ 360)`);
      check(m.pane.scrollHeight <= m.pane.clientHeight, `${scheme}: B: the pane does not scroll at ${m.pane.clientHeight}px`);
      check(m.unstaged.visibleRows >= 2 && m.staged.visibleRows >= 2, `${scheme}: B: each list shows two rows (${m.unstaged.visibleRows} / ${m.staged.visibleRows})`);
      check(near(m.unstaged.rect.height, m.staged.rect.height), `${scheme}: B: the sections stay equal`);
      check(inside(m.summary, m.commit.fields.rect) && inside(m.summary, m.pane.rect), `${scheme}: B: Summary is fully visible in the fields and the pane`);
      check(inside(m.button, m.pane.rect) && inside(m.button, m.commit.rect), `${scheme}: B: the commit button is fully visible`);
      check(m.commit.fields.scrollHeight > m.commit.fields.clientHeight, `${scheme}: B: the commit fields overflow and scroll inside the box`);
      {
        const b = m.commit.fields.rect;
        const x = (await slot.boundingBox()).x + 20;
        await page.mouse.move(x, (b.top + b.bottom) / 2);
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(150);
        m = await measure(page, SLOT);
        check(m.commit.fields.scrollTop > 0 && m.pane.scrollTop === 0, `${scheme}: B: a wheel over the commit fields scrolls them, not the pane`);
      }
      await shot('long-activity');
      await setActivity(false);

      // C. Phone: the Changes (n) dialog.
      await page.setViewportSize(PHONE);
      await page.goto(`${world.url}/?project=stage`);
      await page.getByRole('button', { name: /^Changes \(\d+\)$/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Changes', exact: true });
      const dUnstaged = dlg.getByRole('region', { name: 'Unstaged Files', exact: true });
      const dStaged = dlg.getByRole('region', { name: 'Staged Files', exact: true });
      await dUnstaged.getByRole('option').first().waitFor();
      await dStaged.getByRole('option').first().waitFor();
      // measure() takes a selector: mark the dialog (the slot's own pane is hidden at this width).
      const dialogSel = '[data-test-pane]';
      await page.evaluate(() => document.querySelector('[role=dialog]').setAttribute('data-test-pane', ''));
      m = await measure(page, dialogSel);
      check(m.pane.scrollHeight <= m.pane.clientHeight, `${scheme}: C: the dialog does not scroll (${m.pane.scrollHeight} ≤ ${m.pane.clientHeight})`);
      check(m.unstaged.scrollHeight > m.unstaged.clientHeight && m.staged.scrollHeight > m.staged.clientHeight, `${scheme}: C: both lists overflow and scroll on their own`);
      check(m.unstaged.visibleRows >= 2 && m.staged.visibleRows >= 2, `${scheme}: C: each list shows two rows`);
      check(near(m.unstaged.rect.height, m.staged.rect.height), `${scheme}: C: the sections are equal`);
      check(inside(m.summary, m.pane.rect) && m.summary.bottom <= m.innerHeight && inside(m.button, m.pane.rect) && m.button.bottom <= m.innerHeight,
        `${scheme}: C: Summary and the commit button are inside the dialog and the viewport`);
      await wheelOver(dStaged, 300);
      m = await measure(page, dialogSel);
      check(m.staged.scrollTop > 0 && m.unstaged.scrollTop === 0 && m.pane.scrollTop === 0, `${scheme}: C: a wheel over the staged list scrolls only it`);
      await shot('phone');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
      await page.setViewportSize(DESKTOP);
      await page.goto(`${world.url}/?project=stage`);
      await unstaged.getByRole('option').first().waitFor();
      await setActivity(false);

      // D. One section empty: the long one takes the rest.
      const oneEmpty = async (emptyKey, what) => {
        const mm = await measure(page, SLOT);
        const [e, l] = emptyKey === 'unstaged' ? [mm.unstaged, mm.staged] : [mm.staged, mm.unstaged];
        check(e.scrollHeight <= e.clientHeight && e.rect.height < l.rect.height, `${scheme}: D: ${what}: the empty section is short and does not scroll`);
        check(near(e.rect.height + l.rect.height, mm.commit.rect.top - Math.min(e.rect.top, l.rect.top)), `${scheme}: D: ${what}: the long section takes the rest`);
        check(l.scrollHeight > l.clientHeight && mm.pane.scrollHeight <= mm.pane.clientHeight, `${scheme}: D: ${what}: the long list scrolls and the pane does not`);
      };
      await slot.getByRole('button', { name: 'Stage all', exact: true }).click();
      await unstaged.getByText('No unstaged changes.').waitFor();
      check(git('diff', '--name-only') === '' && git('ls-files', '--others', '--exclude-standard') === '', `${scheme}: D: git has nothing unstaged`);
      await oneEmpty('unstaged', 'no unstaged changes');
      await slot.getByRole('button', { name: 'Unstage all', exact: true }).click();
      await staged.getByText('Nothing staged.').waitFor();
      check(git('diff', '--cached', '--name-only') === '', `${scheme}: D: git has nothing staged`);
      await oneEmpty('staged', 'nothing staged');
      await shot('one-empty');

      // E. Both short: the commit box is pinned at the bottom.
      await page.goto(`${world.url}/?project=detached`);
      await slot.getByRole('region', { name: 'Commit message', exact: true }).waitFor();
      await unstaged.getByRole('option').first().waitFor();
      await setActivity(false);
      m = await measure(page, SLOT);
      check(m.unstaged.scrollHeight <= m.unstaged.clientHeight && m.staged.scrollHeight <= m.staged.clientHeight, `${scheme}: E: neither list overflows`);
      check(near(m.commit.rect.bottom, m.pane.rect.bottom), `${scheme}: E: the commit box is pinned to the pane's bottom (${m.commit.rect.bottom} / ${m.pane.rect.bottom})`);
      check(m.pane.scrollHeight <= m.pane.clientHeight, `${scheme}: E: the pane does not scroll`);
      await shot('short');

      // F. Last resort: below the floors the pane scrolls, and the floors hold. D left nothing staged: stage bulk/s-* again.
      git('add', 'bulk/s-*');
      await page.goto(`${world.url}/?project=stage`);
      await unstaged.getByRole('option').first().waitFor();
      await staged.getByRole('option').first().waitFor();
      await page.setViewportSize({ width: 1280, height: 560 });
      await setActivity(true);
      m = await measure(page, SLOT);
      console.log(`F: pane height ${m.pane.clientHeight}`);
      check(m.pane.scrollHeight > m.pane.clientHeight, `${scheme}: F: the pane scrolls as a last resort (${m.pane.scrollHeight} > ${m.pane.clientHeight})`);
      check(m.unstaged.visibleRows >= 2 && m.staged.visibleRows >= 2, `${scheme}: F: each list keeps two full rows`);
      check(inside(m.summary, m.commit.rect) && inside(m.button, m.commit.rect), `${scheme}: F: Summary and the commit button are inside the commit box`);
      check(near(m.unstaged.rect.height + m.staged.rect.height, 176), `${scheme}: F: the lists sit at their floor (${m.unstaged.rect.height + m.staged.rect.height} = 176)`);
      check(near(m.commit.rect.height, 100), `${scheme}: F: the commit box sits at its floor (${m.commit.rect.height} = 100)`);
      await shot('last-resort');
      check(errors.length === 0, `${scheme}: no console errors or ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
