// The side panes' resize handles on the seeded `app` world, in light then dark, each on a fresh seed: A defaults (left
// 256, right 320, both handles visible, <main> as wide as the viewport) → B a drag on each handle resizes the real pane
// and aria-valuenow follows → C drags past both ends clamp, and the centre keeps 400 px → D keys (→ / ← step, Home, End)
// → E a reload keeps the widths, stored under code-git:shell:paneWidths → F a narrower window renders fitted widths (left
// first) and keeps the choice, a wider one brings it back, 1024 wide still leaves the centre 400 px, and below 1024 the
// handles and side slots are hidden → G the commit details' header handle, now on the shared Splitter, still drags.
// Screenshots go to out/panes/*-{light,dark}.png.
// Run: node harness/playwright/panes.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'panes');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const KEY = 'code-git:shell:paneWidths';
// The bounds, mirrored from PANE in state/paneWidths.ts (the page owns the real ones; these only check the result).
const LEFT = { default: 256, min: 192 };
const RIGHT = { default: 320, min: 320 };
const CENTER_MIN = 400;
const STEP = 16;
const check = (cond, what) => { if (!cond) throw new Error(`panes: ${what}`); console.log(`ok: ${what}`); };
const near = (a, b) => Math.abs(a - b) <= 1;

for (const scheme of ['light', 'dark']) {
  const world = await seed();
  try {
    await withPage(async (page) => {
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const shot = async (name) => {
        const file = path.join(outDir, `${name}-${scheme}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`screenshot: ${file}`);
      };
      const url = `${world.url}/?project=app`;
      const slotW = async (name) => (await page.locator(`[data-slot-name=${name}]`).boundingBox()).width;
      const widths = async () => ({ left: await slotW('left'), center: await slotW('center'), right: await slotW('right') });
      const handle = (side) => page.getByRole('separator', { name: `Resize ${side} pane`, exact: true });
      const num = async (side, attr = 'aria-valuenow') => Number(await handle(side).getAttribute(attr));
      const settle = () => page.waitForTimeout(150);
      // A drag by `dx` px from the handle's centre, with the real mouse.
      const dragBy = async (side, dx) => {
        const b = await handle(side).boundingBox();
        const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx / 2, y, { steps: 4 });
        await page.mouse.move(x + dx, y, { steps: 4 });
        await page.mouse.up();
        await settle();
      };
      const press = async (side, key) => { await handle(side).focus(); await page.keyboard.press(key); await settle(); };
      const centreOk = async (what) => {
        const w = await widths();
        check(w.center >= CENTER_MIN - 1, `${scheme}: ${what}: the centre keeps its minimum (${w.center} ≥ ${CENTER_MIN})`);
        return w;
      };
      const synced = async (what) => {
        const w = await widths();
        check(near(w.left, await num('left')) && near(w.right, await num('right')), `${scheme}: ${what}: aria-valuenow matches the rendered widths (${w.left} / ${w.right})`);
        return w;
      };

      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      await page.goto(url);
      await handle('left').waitFor();

      // A. Defaults.
      let w = await widths();
      const mainW = await page.locator('main').evaluate((el) => el.clientWidth);
      check(mainW === 1280, `${scheme}: A: <main> is as wide as the viewport (${mainW})`);
      check(near(w.left, LEFT.default) && near(w.right, RIGHT.default), `${scheme}: A: defaults ${w.left} / ${w.right}`);
      check(await handle('left').isVisible() && await handle('right').isVisible(), `${scheme}: A: both handles are visible`);
      await shot('defaults');

      // B. Drag each handle.
      await dragBy('left', 100);
      w = await synced('B left');
      check(near(w.left, LEFT.default + 100), `${scheme}: B: the left drag +100 gives ${w.left}`);
      await dragBy('right', -120);
      w = await synced('B right');
      check(near(w.right, RIGHT.default + 120), `${scheme}: B: the right drag −120 grows the pane to ${w.right}`);
      await shot('widened');

      // C. Clamps and the centre minimum.
      await dragBy('left', -600);
      w = await centreOk('C left far left');
      check(near(w.left, LEFT.min), `${scheme}: C: the left pane stops at its minimum (${w.left})`);
      await dragBy('left', 900);
      w = await centreOk('C left far right');
      check(near(w.left, await num('left', 'aria-valuemax')) && near(w.left + w.right + 16, 1280 - CENTER_MIN), `${scheme}: C: the left pane stops at its live maximum (${w.left}), leaving the centre ${CENTER_MIN}`);
      await dragBy('right', 900);
      w = await centreOk('C right far right');
      check(near(w.right, RIGHT.min), `${scheme}: C: the right pane stops at its minimum (${w.right})`);
      await dragBy('right', -900);
      await centreOk('C right far left');
      await synced('C');

      // D. Keys.
      await press('left', 'Home');
      w = await widths();
      check(near(w.left, LEFT.min), `${scheme}: D: Home gives the left pane its minimum`);
      await press('left', 'ArrowRight');
      check(near((await widths()).left, LEFT.min + STEP), `${scheme}: D: → widens the left pane by ${STEP}`);
      await press('left', 'End');
      await centreOk('D left End');
      check(near((await widths()).left, await num('left', 'aria-valuemax')), `${scheme}: D: End gives the left pane its live maximum`);
      await press('right', 'Home');
      check(near((await widths()).right, RIGHT.min), `${scheme}: D: Home gives the right pane its minimum`);
      await press('right', 'ArrowLeft');
      check(near((await widths()).right, RIGHT.min + STEP), `${scheme}: D: ← widens the right pane by ${STEP}`);
      await synced('D');

      // E. Persistence.
      const before = await widths();
      const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
      check(stored !== null && JSON.parse(stored).left > 0, `${scheme}: E: the choice is stored under ${KEY} (${stored})`);
      await page.reload();
      await handle('left').waitFor();
      const after = await widths();
      check(near(after.left, before.left) && near(after.right, before.right), `${scheme}: E: a reload keeps the widths (${after.left} / ${after.right})`);

      // F. Window resizing.
      await page.setViewportSize({ width: 1600, height: 800 });
      await settle();
      await press('left', 'End');
      await press('right', 'End');
      w = await widths();
      const choice = await page.evaluate((k) => localStorage.getItem(k), KEY);
      check(near(w.left, 480) && near(w.right, 640), `${scheme}: F: at 1600 the panes are at their ceilings (${w.left} / ${w.right})`);
      await shot('wide-window');
      await page.setViewportSize({ width: 1100, height: 800 });
      await settle();
      w = await widths();
      check(near(w.left, LEFT.min) && near(w.right, 1100 - 416 - LEFT.min), `${scheme}: F: at 1100 the left pane gives way first (${w.left} / ${w.right})`);
      await centreOk('F 1100');
      check(await page.evaluate((k) => localStorage.getItem(k), KEY) === choice, `${scheme}: F: the stored choice is untouched by the fit`);
      await shot('narrow-window');
      await page.setViewportSize({ width: 1600, height: 800 });
      await settle();
      w = await widths();
      check(near(w.left, 480) && near(w.right, 640), `${scheme}: F: back at 1600 the chosen widths return (${w.left} / ${w.right})`);
      await page.setViewportSize({ width: 1024, height: 800 });
      await settle();
      w = await centreOk('F 1024');
      check(near(w.left, LEFT.min) && near(w.right, 1024 - 416 - LEFT.min), `${scheme}: F: at 1024 the panes are ${w.left} / ${w.right}`);
      await page.setViewportSize({ width: 1000, height: 800 });
      await settle();
      check(!(await handle('left').isVisible()) && !(await handle('right').isVisible()), `${scheme}: F: below 1024 both handles are hidden`);
      check(!(await page.locator('[data-slot-name=left]').isVisible()) && !(await page.locator('[data-slot-name=right]').isVisible()), `${scheme}: F: below 1024 the side slots are hidden`);

      // G. The details' header handle, on the same Splitter.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator('[data-row-id]:not([data-row-id^="wip:"])').first().click();
      const details = page.getByRole('complementary', { name: 'Commit details', exact: true });
      const header = details.getByRole('region', { name: 'Commit information', exact: true });
      const hh = details.getByRole('separator', { name: 'Resize commit information', exact: true });
      await hh.waitFor();
      const h0 = (await header.boundingBox()).height;
      const hb = await hh.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 40, { steps: 6 });
      await page.mouse.up();
      await settle();
      check(near((await header.boundingBox()).height, h0 + 40) && near(Number(await hh.getAttribute('aria-valuenow')), h0 + 40), `${scheme}: G: the header handle still drags (${h0} → ${h0 + 40})`);
      await shot('details-header');

      check(errors.length === 0, `${scheme}: no console errors or ≥400 responses${errors.length ? `:\n${errors.join('\n')}` : ''}`);
    });
  } finally {
    await world.close();
  }
}
