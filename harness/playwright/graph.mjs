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
    const handle = page.getByRole('separator', { name: 'Resize Author' });
    const box = await handle.boundingBox();
    const before = (await page.locator('[data-header-col=author]').boundingBox()).width;
    await page.mouse.move(box.x + 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 62, box.y + 5, { steps: 5 });
    await page.mouse.up();
    await row(o.D).locator('[data-cell=changes]').getByText(/^\d+$/).waitFor();
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
    await open();
    const order = await page.locator('[data-header-col]').evaluateAll((els) => els.map((e) => e.getAttribute('data-header-col')));
    check(JSON.stringify(order) === JSON.stringify(['refs', 'graph', 'message', 'author', 'sha', 'date', 'changes']), `the column order persists (${order.join(', ')})`);
    const after = (await page.locator('[data-header-col=author]').boundingBox()).width;
    check(Math.abs(after - before - 60) <= 2, `the author width persists (+${after - before}px)`);

    // ---- search ----
    const box2 = page.getByRole('textbox', { name: 'Search commits' });
    const matched = () => page.locator('[data-match]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-id')).sort());
    await box2.fill('feature');
    await page.locator('[data-match]').first().waitFor();
    check(JSON.stringify(await matched()) === JSON.stringify([o.E, o.F, o.G, o.M1].sort()), 'commits search "feature" marks its 4 matches');
    await box2.press('Enter');
    const firstMatch = ids.find((x) => [o.E, o.F, o.G, o.M1].includes(x));
    check(await page.locator('[role=option][aria-selected=true]').getAttribute('data-row-id') === firstMatch, 'Enter jumps to the first match');
    await page.getByRole('button', { name: 'Path', exact: true }).click();
    await box2.fill('src/b.js');
    await page.waitForFunction((want) => JSON.stringify([...document.querySelectorAll('[data-match]')].map((e) => e.getAttribute('data-row-id')).sort()) === want, JSON.stringify([o.E, o.F].sort()));
    check(true, 'path search src/b.js marks E and F');
    await page.getByRole('button', { name: 'Commits', exact: true }).click();
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
    const details = page.getByRole('complementary', { name: 'Commit details' });
    await details.getByText('Write the guide').waitFor();
    check(await details.getByRole('region', { name: 'Co-authors' }).getByText('Alan Turing').isVisible(), 'details list the co-author');
    check(await details.getByRole('button', { name: `Jump to parent ${o.B.slice(0, 7)}` }).isVisible(), 'details list the parent');
    check(await details.getByText('docs/guide.md').isVisible(), 'details list the changed file');
    await details.getByRole('button', { name: 'Tree' }).click();
    check(await details.getByText('docs', { exact: true }).isVisible() && await details.getByText('guide.md', { exact: true }).isVisible(), 'the tree view nests the file under its directory');
    await shot('details-light-desktop');
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
    check(await page.getByRole('menu').count() === 0, 'the drop opens no menu (no branch-drop actions yet)');

    // ---- every scheme and viewport ----
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
          await row(o.C).click();
          await page.getByRole('dialog', { name: 'Details' }).getByText('Write the guide').waitFor();
          await shot(`details-dialog-${scheme}-phone`);
          await page.keyboard.press('Escape');
        }
      }
    }
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  });
} finally {
  await world.close();
}
