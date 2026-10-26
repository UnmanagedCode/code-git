// The commit graph, asserted on the `lanes` world (graphSeed.mjs) through data attributes, then screenshotted in light
// and dark at desktop and phone width into out/graph/. Fails on a console error or a ≥400 response other than the two
// host URLs that 404 outside cc.
// Run: node harness/playwright/graph.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedGraph, XSS_SUBJECT } from './graphSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'graph');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`graph: ${what}`); console.log(`ok: ${what}`); };

const world = await seedGraph();
const o = world.oids;
const a = world.ages;
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const row = (id) => page.locator(`[data-row-id="${id}"]`);
    const list = page.getByRole('listbox', { name: 'Commits' });
    const refs = page.getByRole('navigation', { name: 'Refs' });
    const col = async (id) => Number(await row(id).getAttribute('data-col'));
    /** The lanes a node's own edges reach: bottom edges leaving it, or top edges ending in it. */
    const nodeLanes = async (id, half) => {
      const c = String(await col(id));
      const edges = await row(id).locator(`[data-edge=${half}]`).evaluateAll((els) => els.map((e) => [e.getAttribute('data-from'), e.getAttribute('data-to')]));
      return new Set(half === 'bottom' ? edges.filter(([f]) => f === c).map(([, t]) => t) : edges.filter(([, t]) => t === c).map(([f]) => f));
    };
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async ({ wt = true } = {}) => {
      await page.goto(`${world.url}/?project=lanes`);
      await row(o.D).waitFor();
      if (wt) await row('wip:wt').waitFor();
    };
    const menuItems = async () => {
      const menu = page.getByRole('menu');
      await menu.waitFor();
      const items = await menu.getByRole('menuitem').allTextContents();
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      return items;
    };

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();

    // ---- lanes ----
    check((await nodeLanes(o.M1, 'bottom')).size === 2, 'the merge M1 continues into 2 lanes');
    check(await col(o.E) === await col(o.F) && await col(o.E) !== await col(o.M1), 'feature/a commits share a lane apart from main');
    check((await nodeLanes(o.B, 'top')).size === 2, 'B is where feature/a branched off: 2 lanes end in it');
    check(await col(o.G) !== await col(o.D), 'feature/b has its own lane');

    // ---- WIP, labels, stash ----
    const ids = await page.locator('[data-row-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id')));
    check(ids[0] === 'wip:' && ids[1] === 'wip:wt', 'two WIP rows: the own checkout first, then wt');
    check(await row('wip:').getByText('// WIP').count() === 1, 'a WIP row reads // WIP');
    check(await row(o.G).getByText('feature/b', { exact: true }).count() === 1 && await row(o.G).getByText('in wt').count() === 1, 'feature/b is labelled "in wt"');
    check(await row(o.C).locator('[data-label-kind=worktree]').getAttribute('title') === 'in side', 'code-conductor/side is labelled "in side"');
    check(await row(o.D).locator('[data-label-kind=head]').getAttribute('title') === 'main (also origin/main)', 'main and origin/main share one chip, the checked-out one');
    check(await row(o.B).getByText('v1.0').count() === 1 && await row(o.M1).getByText('v1.1').count() === 1, 'both tags label their commits');
    check(ids.indexOf(`stash:${o.stash}`) === ids.indexOf(o.D) - 1, 'the stash row sits directly above its base');

    // ---- untrusted text ----
    check(await page.getByText(XSS_SUBJECT, { exact: true }).isVisible(), 'an HTML-looking subject is shown as text');
    check(await page.locator('img').count() === 0, 'no img element exists');
    await shot('lanes-light-desktop');

    // ---- visibility, persisted ----
    await refs.getByRole('button', { name: 'Hide feature/b', exact: true }).click();
    await row(o.G).waitFor({ state: 'detached' });
    check(await row('wip:wt').count() === 0, 'hiding feature/b removes G and its worktree WIP row');
    await open({ wt: false });
    check(await row(o.G).count() === 0, 'the hide survives a reload');
    await refs.getByRole('button', { name: 'Show feature/b', exact: true }).click();
    await row(o.G).waitFor();
    await refs.getByRole('button', { name: 'Solo main', exact: true }).click();
    await row(o.G).waitFor({ state: 'detached' });
    check(await row(o.E).count() === 1 && await row(o.A).count() === 1, 'solo main shows only its ancestry');
    await refs.getByRole('button', { name: 'Unsolo main', exact: true }).click();
    await row(o.G).waitFor();
    await refs.getByRole('button', { name: 'Pin feature/a to left', exact: true }).click();
    await page.waitForFunction((e) => document.querySelector(`[data-row-id="${e}"]`)?.getAttribute('data-col') === '0', o.E);
    check(await col(o.E) === 0 && await col(o.F) === 0, 'pinned feature/a takes lane 0');
    await shot('pinned-light-desktop');
    await refs.getByRole('button', { name: 'Unpin feature/a', exact: true }).click();
    await page.waitForFunction((e) => document.querySelector(`[data-row-id="${e}"]`)?.getAttribute('data-col') !== '0', o.E);

    // ---- columns, persisted ----
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    for (const c of ['Author', 'Date', 'SHA', 'Changes']) await page.getByRole('menuitemcheckbox', { name: c }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-header-col=sha]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    const handle = page.getByRole('separator', { name: 'Resize Author', exact: true });
    const headerW = async (id) => (await page.locator(`[data-header-col=${id}]`).boundingBox()).width;
    const handleNow = async (name) => Number(await page.getByRole('separator', { name, exact: true }).getAttribute('aria-valuenow'));
    const storedGraph = () => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith('code-git:graph:') && k !== 'code-git:graph:detailsHeader').sort()));
    const orderNow = () => page.locator('[data-header-col]').evaluateAll((els) => els.map((e) => e.getAttribute('data-header-col')));
    const orderBefore = JSON.stringify(await orderNow());
    check(Math.abs(await handleNow('Resize Graph') - await headerW('graph')) <= 1, "the Graph handle starts at the column's rendered width");
    const box = await handle.boundingBox();
    const before = await headerW('author');
    await page.mouse.move(box.x + 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 62, box.y + 5, { steps: 5 });
    check(await handle.evaluate((el) => el.hasPointerCapture(1)), 'a handle drag holds the pointer capture');
    await page.mouse.up();
    await row(o.D).locator('[data-cell=changes]').getByText(/^\d+$/).waitFor();
    const dragged = await headerW('author');
    check(Math.abs(dragged - before - 60) <= 2, `the author width persists after a drag (+${dragged - before}px)`);
    // An abandoned drag restores the width and stores nothing, and a later move or release changes nothing.
    const abandon = async (end, what) => {
      const stored = await storedGraph();
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + 2, b.y + 5);
      await page.mouse.down();
      await page.mouse.move(b.x + 42, b.y + 5, { steps: 4 });
      await page.waitForFunction((w) => Math.abs(document.querySelector('[data-header-col=author]').getBoundingClientRect().width - w) > 20, dragged);
      await handle.evaluate(end);
      await page.waitForFunction((w) => Math.abs(document.querySelector('[data-header-col=author]').getBoundingClientRect().width - w) <= 1, dragged);
      await page.mouse.move(b.x + 100, b.y + 5, { steps: 3 });
      await page.mouse.up();
      check(Math.abs(await headerW('author') - dragged) <= 1 && await storedGraph() === stored, what);
    };
    await abandon((el) => el.releasePointerCapture(1), 'a lost pointer capture restores the width and stores nothing');
    await abandon((el) => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })), 'a pointercancel restores the width and stores nothing');
    check(JSON.stringify(await orderNow()) === orderBefore, 'resize drags do not reorder the columns');
    const aligned = async () => {
      const xs = await Promise.all(['author', 'sha', 'changes'].map(async (c) => [
        (await page.locator(`[data-header-col=${c}]`).boundingBox()).x, (await row(o.D).locator(`[data-cell=${c}]`).boundingBox()).x]));
      return xs.every(([h, b]) => Math.abs(h - b) <= 1);
    };
    check(await aligned(), 'header cells stay over their columns after a header menu took focus');
    await list.evaluate((el) => { el.scrollLeft = 200; });
    await page.waitForFunction(() => document.querySelector('[data-header-col]')?.closest('.overflow-hidden')?.scrollLeft === 200);
    check(await aligned(), 'the header scrolls sideways with the rows');
    await list.evaluate((el) => { el.scrollLeft = 0; });
    await shot('columns-light-desktop');
    // Keys on a focused handle: Tab from the header cell reaches it; ←/→ step, End/Home go to the bounds.
    const cellBtn = page.getByRole('button', { name: 'Author', exact: true });
    await cellBtn.focus();
    await page.keyboard.press('Tab');
    check(await handle.evaluate((el) => el === document.activeElement), 'Tab from the Author header cell reaches its resize handle');
    const step = 16;
    const w0 = await headerW('author');
    const n0 = await handleNow('Resize Author');
    await page.keyboard.press('ArrowRight');
    check(await handleNow('Resize Author') === n0 + step && Math.abs(await headerW('author') - w0 - step) <= 1, '→ widens the column by one step');
    await page.keyboard.press('End');
    check(await handleNow('Resize Author') === Number(await handle.getAttribute('aria-valuemax')), 'End goes to the maximum');
    await page.keyboard.press('Home');
    const colMin = Number(await handle.getAttribute('aria-valuemin'));
    check(await handleNow('Resize Author') === colMin && Math.abs(await headerW('author') - colMin) <= 1, 'Home goes to the minimum');
    await page.keyboard.press('ArrowRight');
    check(await handleNow('Resize Author') === colMin + step, '→ once more steps from the minimum');
    await shot('columns-handle-focus-light-desktop');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('columns-handle-focus-dark-desktop');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    check(await page.getByRole('menu').count() === 0, 'Enter and ArrowDown on a resize handle open no menu');
    await cellBtn.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await cellBtn.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    check(true, 'the header cell still opens its menu with Enter and Shift+F10');
    await open();
    const order = await orderNow();
    check(JSON.stringify(order) === JSON.stringify(['refs', 'graph', 'message', 'author', 'sha', 'date', 'changes']), `the column order persists (${order.join(', ')})`);
    const after = await headerW('author');
    check(Math.abs(after - (colMin + step)) <= 1, `the key-set author width persists (${after}px)`);

    // ---- search ----
    const box2 = page.getByRole('textbox', { name: 'Search commits' });
    const matched = () => page.locator('[data-match]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id')).sort());
    await box2.fill('feature');
    await page.locator('[data-match]').first().waitFor();
    check(JSON.stringify(await matched()) === JSON.stringify([o.E, o.F, o.G, o.M1].sort()), 'commits search "feature" marks its 4 matches');
    await box2.press('Enter');
    const firstMatch = ids.find((x) => [o.E, o.F, o.G, o.M1].includes(x));
    check(await page.locator('[role=option][aria-selected=true]').getAttribute('data-row-id') === firstMatch, 'Enter jumps to the first match');
    // Scoped: the details panel's File view toggle has a Path button too, once the jumped-to commit's details load.
    await page.getByRole('group', { name: 'Search by', exact: true }).getByRole('button', { name: 'Path', exact: true }).click();
    await box2.fill('src/b.js');
    await page.waitForFunction((want) => JSON.stringify([...document.querySelectorAll('[data-match]')].map((e) => e.getAttribute('data-row-id')).sort()) === want, JSON.stringify([o.E, o.F].sort()));
    check(true, 'path search src/b.js marks E and F');
    await page.getByRole('group', { name: 'Search by', exact: true }).getByRole('button', { name: 'Commits', exact: true }).click();
    await box2.fill('grace');
    await page.waitForFunction((want) => [...document.querySelectorAll('[data-match]')].map((e) => e.getAttribute('data-row-id')).join() === want, o.C);
    check(true, 'an author search finds Grace Hopper’s commit');
    await box2.fill(o.G.slice(0, 7));
    await page.waitForFunction((want) => [...document.querySelectorAll('[data-match]')].map((e) => e.getAttribute('data-row-id')).join() === want, o.G);
    check(true, 'a sha prefix finds its commit');
    await box2.fill('');
    await page.locator('[data-match]').first().waitFor({ state: 'detached' });

    // ---- keyboard, selection, details ----
    await row(o.C).click();
    const details = page.getByRole('complementary', { name: 'Commit details', exact: true });
    const header = details.getByRole('region', { name: 'Commit information', exact: true });
    const files = details.getByRole('listbox', { name: 'Changed files', exact: true });
    const headerHandle = details.getByRole('separator', { name: 'Resize commit information', exact: true });
    const headerHeight = async () => (await header.boundingBox()).height;
    const ariaNum = async (attr) => Number(await headerHandle.getAttribute(attr));
    // isVisible ignores scroll clipping: a header row counts as shown only once scrolled to and inside the header's box.
    const shownInHeader = async (loc) => {
      await loc.scrollIntoViewIfNeeded();
      const [b, h] = [await loc.boundingBox(), await header.boundingBox()];
      return b.y >= h.y - 0.5 && b.y + b.height <= h.y + h.height + 0.5;
    };
    // The file list's own scroller: its nearest scrolling ancestor.
    const listScroller = files.locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " overflow-y-auto ")][1]');
    const scroller = (fn) => listScroller.evaluate(fn);
    await details.getByText('Write the guide').waitFor();
    check(await shownInHeader(details.getByRole('region', { name: 'Co-authors', exact: true }).getByText('Alan Turing <alan@example.com>', { exact: true })), 'details list the co-author');
    check(await shownInHeader(details.getByLabel('Commit SHA', { exact: true })), 'details list the SHA');
    check(await shownInHeader(details.getByRole('button', { name: `Jump to parent ${o.B.slice(0, 7)}`, exact: true })), 'details list the parent');
    await header.evaluate((el) => { el.scrollTop = 0; });
    check(await details.getByText('docs/guide.md').isVisible(), 'details list the changed file');
    await details.getByRole('button', { name: 'Tree', exact: true }).click();
    check(await details.getByText('docs', { exact: true }).isVisible() && await details.getByText('guide.md', { exact: true }).isVisible(), 'the tree view nests the file under its directory');
    await shot('details-light-desktop');
    // The header's height is the user's (224 px by default); the files fill the rest of the panel, which fills the slot.
    const shortHeight = await headerHeight();
    const storedHeight = () => page.evaluate(() => localStorage.getItem('code-git:graph:detailsHeader'));
    check(await storedHeight() === null && Math.abs(shortHeight - await ariaNum('aria-valuenow')) <= 1, `the header starts at its default height, the separator's value (${shortHeight})`);
    const headerBox = await header.boundingBox();
    const asideBox = await details.boundingBox();
    const slotBox = await page.locator('[data-slot-name=right]').boundingBox();
    check(Math.abs(asideBox.y - slotBox.y) <= 1 && Math.abs(asideBox.y + asideBox.height - (slotBox.y + slotBox.height)) <= 1, `the details fill the right slot (${asideBox.y}–${asideBox.y + asideBox.height} vs ${slotBox.y}–${slotBox.y + slotBox.height})`);
    check((await files.boundingBox()).y >= headerBox.y + headerBox.height - 0.5, 'the file list starts below the commit information');
    const filesBottom = await scroller((s) => s.getBoundingClientRect().bottom);
    check(Math.abs(filesBottom - (asideBox.y + asideBox.height)) <= 1, `the file list reaches the panel's bottom (${filesBottom} vs ${asideBox.y + asideBox.height})`);
    // A merge: the "Changes against…" note keeps its gap above the "N files" row.
    await row(o.M1).click();
    const note = details.getByText('Changes against the first parent', { exact: true });
    await note.waitFor();
    const noteBox = await note.boundingBox();
    const countBox = await details.getByRole('heading', { name: '1 file', exact: true }).boundingBox();
    check(countBox.y - (noteBox.y + noteBox.height) >= 8, `a merge's note keeps its gap above the file count (${countBox.y - (noteBox.y + noteBox.height)}px)`);
    await shot('details-merge-light-desktop');
    // G: a 200-line message and 31 files.
    await row(o.G).click();
    // The body is one element: its whole text, never one line per node.
    const longBody = details.locator('[data-commit-body]', { hasText: 'Body line 200' });
    await longBody.waitFor();
    await details.getByRole('heading', { name: '31 files', exact: true }).waitFor();
    const longHeight = await headerHeight();
    check(Math.abs(longHeight - shortHeight) <= 0.5, `a 200-line message keeps the header's height (${longHeight} vs ${shortHeight})`);
    check(await header.evaluate((el) => el.scrollHeight > el.clientHeight), 'the long message scrolls inside the header');
    check(await files.isVisible() && await files.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; }), 'the file list stays in view below a long message');
    check(await scroller((s) => s.scrollHeight > s.clientHeight), 'the 31 files scroll in the list\'s own scroller');
    await scroller((s) => { s.scrollTop = s.scrollHeight; });
    check(await scroller((s) => s.scrollTop > 0) && Math.abs(await headerHeight() - shortHeight) <= 0.5, 'scrolling the files leaves the header where it was');
    await header.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // The body is taller than the header: its end, then the SHA, must lie inside the header's box.
    const endInHeader = async (loc) => {
      const [b, h] = [await loc.boundingBox(), await header.boundingBox()];
      return b.y + b.height > h.y && b.y + b.height <= h.y + h.height + 0.5;
    };
    check(await endInHeader(longBody) && await shownInHeader(details.getByLabel('Commit SHA', { exact: true })), 'the header scrolls to the end of the message and the SHA');
    await shot('details-long-light-desktop');

    // ---- resizing the commit information ----
    // Every bound comes from the separator itself (aria-valuemin / aria-valuemax), never re-derived here. Box heights
    // (getBoundingClientRect) and the app's clientHeight can differ by a fraction: ±1.
    const near = (a, b) => Math.abs(a - b) <= 1;
    const bounds = async () => [await ariaNum('aria-valuemin'), await ariaNum('aria-valuemax')];
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // The file rows wholly inside the list's scroller, scrolled to its end (only file rows there, no directory rows).
    const rowsShown = () => scroller((s) => {
      s.scrollTop = s.scrollHeight;
      const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('li[role="option"]')].filter((li) => { const b = li.getBoundingClientRect(); return b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5; }).length;
    });
    const drag = async (dy) => {
      const b = await headerHandle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, Math.max(0, Math.min(page.viewportSize().height - 1, b.y + b.height / 2 + dy)), { steps: 5 });
      await page.mouse.up();
    };
    const [min, max] = await bounds();
    check(min < max, `the separator has a range to resize in (${min}–${max})`);
    const clampTo = (px) => Math.max(min, Math.min(max, px));
    for (const dy of [-40, 20]) {
      const want = clampTo(await ariaNum('aria-valuenow') + dy);
      await drag(dy);
      const now = await ariaNum('aria-valuenow');
      check(near(now, want) && near(await headerHeight(), now), `a drag of ${dy}px resizes the header to ${now}px (wanted ${want})`);
    }
    check(await scroller((s) => s.getBoundingClientRect().top) >= (await header.boundingBox()).y + await headerHeight() - 0.5, 'the files stay below the resized header');
    await drag(-1000);
    check(await ariaNum('aria-valuenow') === min && near(await headerHeight(), min), `a drag far up stops at aria-valuemin (${await headerHeight()})`);
    await drag(1000);
    check(await ariaNum('aria-valuenow') === max && near(await headerHeight(), max), `a drag far down stops at aria-valuemax (${await headerHeight()})`);
    check(await rowsShown() >= 3, `at the maximum the files still show at least three whole rows (${await rowsShown()})`);
    await headerHandle.focus();
    await page.keyboard.press('ArrowUp');
    const stepped = await ariaNum('aria-valuenow');
    check(stepped < max && near(await headerHeight(), stepped), `↑ steps the header shorter (${max} → ${stepped})`);
    await page.keyboard.press('ArrowDown');
    check(await ariaNum('aria-valuenow') === max, '↓ steps it back');
    await page.keyboard.press('Home');
    check(near(await headerHeight(), min), 'Home goes to aria-valuemin');
    await page.keyboard.press('End');
    check(near(await headerHeight(), max), 'End goes to aria-valuemax');
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    const chosen = await ariaNum('aria-valuenow');
    check(chosen > min && chosen < max && await storedHeight() === String(chosen), `↓ steps the header taller, and the height is stored (${chosen})`);
    await open();
    await row(o.C).click();
    await details.getByText('Write the guide').waitFor();
    check(near(await headerHeight(), chosen), `the chosen height survives a reload (${await headerHeight()})`);
    await row(o.G).click();
    await longBody.waitFor();
    check(near(await headerHeight(), chosen), 'and another selection');
    await shot('details-resized-light-desktop');
    // A panel too short for the chosen height re-clamps the header instead of crushing the files, and keeps the choice.
    // How short the window must be depends on what else takes the height (the activity panel): step it down until the
    // separator's maximum falls between its minimum and the chosen height.
    let clampedAt = null;
    for (let h = VIEWPORTS.desktop.height - 40; h >= 400; h -= 40) {
      await page.setViewportSize({ width: VIEWPORTS.desktop.width, height: h });
      await frames();
      const [lo, hi] = await bounds();
      if (hi < chosen && hi > lo) { clampedAt = h; break; }
    }
    check(clampedAt !== null, `a window between 400 and ${VIEWPORTS.desktop.height - 40}px tall makes the panel too short for the chosen ${chosen}px header with room to clamp (last panel ${(await details.boundingBox()).height}px, max ${await ariaNum('aria-valuemax')})`);
    const shortMax = await ariaNum('aria-valuemax');
    check(await ariaNum('aria-valuenow') === shortMax && near(await headerHeight(), shortMax) && await storedHeight() === String(chosen), `at 1280×${clampedAt} the header re-clamps to aria-valuemax (${shortMax}) and the stored ${chosen} stays`);
    check(await rowsShown() >= 3, `the re-clamped files still show at least three whole rows (${await rowsShown()})`);
    await page.setViewportSize(VIEWPORTS.desktop);
    await frames();
    check(near(await headerHeight(), chosen), 'the chosen height comes back when the panel grows');
    // Back to the default: no stored height.
    await page.evaluate(() => localStorage.removeItem('code-git:graph:detailsHeader'));
    await open();
    await row(o.G).click();
    await longBody.waitFor();
    check(near(await headerHeight(), shortHeight), 'back to the default height');
    await row(o.C).click();
    await details.getByText('Write the guide').waitFor();
    // The left slot: the refs panel first, the diff's Compare panel below it, both reachable.
    const left = page.locator('[data-slot-name=left]');
    const refsBox = await left.getByRole('navigation', { name: 'Refs' }).boundingBox();
    const compareBox = await left.getByRole('region', { name: 'Commit' }).boundingBox();
    check(refsBox && compareBox && compareBox.y > refsBox.y, 'the left slot stacks the refs panel above the Compare panel');
    await left.getByRole('textbox', { name: 'Commit (sha or ref)' }).scrollIntoViewIfNeeded();
    await shot('left-slot-light-desktop');
    // A file in the details opens that commit's diff at the file; Esc brings the graph back.
    await details.getByRole('option', { name: /guide\.md/ }).click();
    const diff = page.getByRole('region', { name: 'Diff' });
    // The details' list is now the diff's: it marks the viewed file.
    await details.locator('[data-path="docs/guide.md"][aria-current="true"]').waitFor();
    check(await diff.getByRole('listbox').count() === 0, 'the diff has no file list of its own: the details drive it');
    check(await diff.getByLabel('Diff source').textContent().then((t) => t.includes(o.C.slice(0, 7))), 'a file click opens that commit’s diff');
    await shot('file-diff-light-desktop');
    await diff.locator('[data-diff-body]').click();
    await page.keyboard.press('Escape');
    await row(o.C).waitFor();
    check(await diff.count() === 0, 'Esc closes the diff and the graph is back');
    await list.press('j');
    const below = ids[ids.indexOf(o.C) + 1];
    check(await page.locator('[role=option][aria-selected=true]').getAttribute('data-row-id') === below, 'j moves the selection down');
    await list.press('k');
    check(await page.locator('[role=option][aria-selected=true]').getAttribute('data-row-id') === o.C, 'k moves it back');
    await row(o.D).click();
    await row(o.F).click({ modifiers: ['Shift'] });
    check(await page.locator('[role=option][aria-selected=true]').count() === 3, 'Shift-click selects the range D…F');
    await row(o.M1).click({ modifiers: ['Control'] });
    check(await page.locator('[role=option][aria-selected=true]').count() === 2, 'Ctrl-click toggles one row off');
    await details.getByText('2 selected').waitFor();

    // ---- menus ----
    await row(o.A).click({ button: 'right' });
    check((await menuItems()).includes('Copy SHA'), 'a commit row menu offers Copy SHA');
    await row(o.F).locator('[data-label-kind=local]').click({ button: 'right' });
    const branchItems = await menuItems();
    check(['Hide', 'Solo', 'Pin to left'].every((x) => branchItems.includes(x)), `a branch chip menu offers Hide, Solo, Pin (${branchItems.join(', ')})`);

    // ---- hover and drag ----
    await page.keyboard.press('Escape');
    await row(o.G).locator('[data-label-kind=local]').hover();
    await page.waitForFunction((e) => document.querySelector(`[data-row-id="${e}"]`)?.hasAttribute('data-dimmed'), o.E);
    check(await row(o.G).getAttribute('data-dimmed') === null && await row(o.C).getAttribute('data-dimmed') === null, 'hovering feature/b dims the commits it does not reach');
    await shot('hover-light-desktop');
    const src = await row(o.F).locator('[data-label-kind=local]').boundingBox();
    const dst = await row(o.D).locator('[data-label-kind=head]').boundingBox();
    await page.mouse.move(src.x + 10, src.y + 8);
    await page.mouse.down();
    await page.mouse.move(dst.x + 10, dst.y + 8, { steps: 8 });
    check(await row(o.D).locator('[data-label-kind=head]').getAttribute('data-drop-active') === '', 'dragging feature/a over main marks main the drop target');
    await shot('drag-light-desktop');
    await page.mouse.up();
    // The drop menu, in order: merge and rebase (features/sequence/actions.ts, orders 100–120), then the branches card's
    // Fast-forward (200) and Reset (300; main is HEAD, so the Reset submenu, not the branch move).
    const dropItems = await menuItems();
    const DROP_ITEMS = [
      'Merge feature/a into main', 'Merge feature/a into main (no fast-forward)', 'Squash feature/a into main',
      'Rebase main onto feature/a', 'Interactive rebase main onto feature/a…', 'Fast-forward main to feature/a', 'Reset main to feature/a',
    ];
    check(dropItems.join('|') === DROP_ITEMS.join('|'), `the drop opens the branch-drop menu (${dropItems.join(', ')})`);

    // ---- age markers, on the `ages` world ----
    await page.goto(`${world.url}/?project=ages`);
    await row(a.a6).waitFor();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    for (const c of ['Date']) await page.getByRole('menuitemcheckbox', { name: c }).click();
    await page.keyboard.press('Escape');
    const markers = await page.locator('[data-age-marker]').evaluateAll((els) => els.map((e) => [e.closest('[data-row-id]').getAttribute('data-row-id'), e.getAttribute('data-age-marker')]));
    const want = [[a.a5, 'last week'], [a.a4, 'last month'], [a.a2, '3 months ago'], [a.a1, '1 year ago'], [a.a0, '2 years ago']];
    check(JSON.stringify(markers) === JSON.stringify(want), `the age markers sit on their rows in order (${markers.map((m) => m[1]).join(', ')})`);
    check(await row(a.a3).locator('[data-age-marker]').count() === 0 && await row(a.a6).locator('[data-age-marker]').count() === 0, 'a newer commit below a crossing, and the first row, carry no marker');
    const boxes = await page.locator('[data-row-id]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.height]; }));
    check(boxes.length === 7 && boxes.every(([top, h], i) => h === 28 && (i === 0 || top - boxes[i - 1][0] === 28)), 'every row is 28px tall, 28px apart');
    check((await page.locator('[data-row-id] [data-cell=graph] svg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))).every((h) => h === 28), 'the lane svgs keep their 28px height');
    // A border-based marker would shrink the row's content box and shift the lane svg down: the svg's top is its row's top.
    check(await page.evaluate((id) => {
      const r = document.querySelector(`[data-row-id="${id}"]`);
      return r.querySelector('[data-age-marker]') && r.querySelector('[data-cell=graph] svg').getBoundingClientRect().top === r.getBoundingClientRect().top;
    }, a.a5), 'on a marked row the lane svg starts at the row top');
    // Every optional column on: the columns overflow the list, and each pill must still lie inside the list's visible rect.
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    for (const c of ['Author', 'SHA', 'Changes']) await page.getByRole('menuitemcheckbox', { name: c }).click();
    await page.keyboard.press('Escape');
    const pillsVisible = () => page.evaluate(() => {
      const l = document.querySelector('[role=listbox][aria-label=Commits]').getBoundingClientRect();
      const pills = [...document.querySelectorAll('[data-age-marker] > span')].map((e) => e.getBoundingClientRect());
      return { overflow: document.querySelector('[role=listbox][aria-label=Commits]').scrollWidth > Math.ceil(l.width), n: pills.length, ok: pills.every((p) => p.left >= l.left && p.right <= l.right + 0.5) };
    });
    for (const [vp, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      const v = await pillsVisible();
      check(v.overflow && v.n === 5 && v.ok, `${vp}, every optional column on: the columns overflow and all 5 pills lie within the list's visible rect`);
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    await row(a.a4).click();
    check(await row(a.a4).getAttribute('aria-selected') === 'true', 'clicking a marked row selects it');
    await list.press('j');
    check(await row(a.a3).getAttribute('aria-selected') === 'true', 'j moves the selection past the marker to the next row');
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await page.goto(`${world.url}/?project=ages`);
        await row(a.a6).waitFor();
        await shot(`ages-${scheme}-${vp}`);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(VIEWPORTS.desktop);

    // ---- every scheme and viewport ----
    await page.mouse.move(0, 0); // off every chip: no hover dimming in the screenshots
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await open();
        await shot(`graph-${scheme}-${vp}`);
        if (vp === 'phone') {
          check(await refs.count() === 0, `${scheme} phone: the refs panel is not squeezed beside the graph`);
          await page.getByRole('button', { name: 'Refs', exact: true }).click();
          await page.getByRole('dialog', { name: 'Refs' }).getByRole('navigation', { name: 'Refs' }).waitFor();
          await shot(`refs-dialog-${scheme}-phone`);
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: 'Compare', exact: true }).click();
          await page.getByRole('dialog', { name: 'Compare' }).getByRole('textbox', { name: 'Commit (sha or ref)' }).waitFor();
          await shot(`compare-dialog-${scheme}-phone`);
          await page.keyboard.press('Escape');
          await row(o.C).click();
          await page.getByRole('dialog', { name: 'Details', exact: true }).getByText('Write the guide').waitFor();
          await shot(`details-dialog-${scheme}-phone`);
          await page.keyboard.press('Escape');
          await row(o.G).click();
          await page.getByRole('dialog', { name: 'Details', exact: true }).locator('[data-commit-body]', { hasText: 'Body line 200' }).waitFor();
          check(await page.getByRole('dialog', { name: 'Details', exact: true }).getByRole('separator').count() === 0, `${scheme} phone: the details dialog has no resize handle (the header keeps its default height)`);
          await shot(`details-dialog-long-${scheme}-phone`);
          await page.keyboard.press('Escape');
        }
      }
    }
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  });
} finally {
  await world.close();
}
