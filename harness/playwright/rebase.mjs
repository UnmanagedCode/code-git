// The merge/rebase card's interactive editor on the `seq` world (sequenceSeed.mjs), every step checked against git:
// topic checked out → "Interactive rebase from here…" on main's tip → a row dragged to the top, D / S / R keys, the reword
// dialog → Start (the drop confirmation) → git's history is the rows' → Cherry-pick 2 commits… (pick mode) → Squash 2
// commits… (the preset) → an Edit stop → the banner's Continue. Then the editor and the reword dialog in light and dark
// at desktop and phone width into out/c7/. Fails on a console error or a ≥400 response other than the two host URLs.
// Run: node harness/playwright/rebase.mjs   (needs `npm run prepare` first, for frontend/dist)
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedSequence } from './sequenceSeed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'c7');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`rebase: ${what}`); console.log(`ok: ${what}`); };

const world = await seedSequence();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
const rebasing = () => existsSync(path.join(world.repo.dir, '.git', 'rebase-merge'));
const subjects = (range) => git('log', '--format=%s', range).split('\n').filter(Boolean);
const files = (rev) => git('ls-tree', '--name-only', rev).split('\n');
const a7 = (oid) => oid.slice(0, 7);
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !HOST_URLS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const refRow = (name) => page.locator(`[data-ref="${name}"]`);
    const nameButton = (name) => refRow(name).locator(`button[title="${name}"]`);
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const editor = page.getByRole('region', { name: 'Interactive rebase', exact: true });
    const list = editor.getByRole('list', { name: 'Commits to rebase', exact: true });
    const row = (oid) => list.locator(`[aria-label^="${a7(oid)}"]`);
    const order = () => list.locator('[data-row-index]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label').slice(0, 7)}:${e.getAttribute('data-action')}`));
    const banner = page.getByRole('status', { name: 'Operation in progress', exact: true });
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async () => {
      await page.goto(`${world.url}/?project=seq`);
      await commitRow(git('rev-parse', 'HEAD')).first().waitFor();
    };
    const choose = async (...items) => { for (const item of items) await menu.last().getByRole('menuitem', { name: item, exact: true }).click(); };
    const waitHead = (name) => page.waitForFunction((n) => document.querySelector('[aria-label="HEAD"]')?.textContent === n, name);
    const selectTwo = async (a, b) => {
      await commitRow(a).click();
      await commitRow(b).click({ modifiers: ['Shift'] });
    };

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();
    await nameButton('refs/heads/topic').dblclick();
    await waitHead('topic');

    // 1. the editor from a commit: the commits after main's tip, oldest first
    await commitRow(o.work).click({ button: 'right' });
    await choose('Interactive rebase from here…');
    await list.waitFor();
    check((await editor.getByRole('heading').textContent()) === `Interactive rebase topic onto ${a7(o.work)}`, 'the header names the branch and the base');
    check((await order()).join(' ') === [o.t1, o.t2, o.t3, o.t4].map((x) => `${a7(x)}:pick`).join(' '), 'rows t1…t4, oldest first, all pick');

    // 2. drag t4 to the top by its handle
    const handle = await row(o.t4).getByRole('button', { name: `Drag ${a7(o.t4)}`, exact: true }).boundingBox();
    const first = await row(o.t1).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, first.y + 2, { steps: 10 });
    await page.mouse.up();
    check((await order()).map((x) => x.slice(0, 7)).join(' ') === [o.t4, o.t1, o.t2, o.t3].map(a7).join(' '), 'dragging t4 by its handle puts it first');

    // 3. keys: D on t3, S on t2; R on t4 opens the reword dialog
    await row(o.t3).focus();
    await page.keyboard.press('d');
    await row(o.t2).focus();
    await page.keyboard.press('s');
    await row(o.t4).focus();
    await page.keyboard.press('r');
    await dialog.getByRole('textbox', { name: 'Summary', exact: true }).fill('t4 reworded');
    await shot('rebase-reword-light-desktop');
    await dialog.getByRole('button', { name: 'Save message', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    check((await order()).join(' ') === `${a7(o.t4)}:reword ${a7(o.t1)}:pick ${a7(o.t2)}:squash ${a7(o.t3)}:drop`, 'R / S / D set the actions');
    await shot('rebase-editor-light-desktop');

    // 4. Start: the drop confirmation, then git's history is the rows'
    await editor.getByRole('button', { name: 'Start', exact: true }).click();
    await dialog.getByRole('button', { name: 'Drop and start', exact: true }).click();
    await toast(`Rebased topic onto ${a7(o.work)}`).waitFor();
    await list.waitFor({ state: 'detached' });
    check(subjects(`${o.work}..topic`).join('|') === 't1|t4 reworded', 'git: t4 reworded first, then t1 with t2 melded in; t3 dropped');
    check(git('log', '-1', '--format=%B', 'topic').trim() === 't1\n\nt2', 'git: the squash chain carries the default message (t1, then t2)');
    check(files('topic').includes('t2.txt') && !files('topic').includes('t3.txt'), 'git: t2.txt kept, t3.txt gone');

    // 5. Cherry-pick 2 commits… (p2, p3) onto topic
    await selectTwo(o.p3, o.p2);
    await commitRow(o.p2).click({ button: 'right' });
    await choose('Cherry-pick 2 commits…');
    await list.waitFor();
    check((await order()).join(' ') === `${a7(o.p2)}:pick ${a7(o.p3)}:pick`, 'the cherry-pick editor lists p2 then p3');
    const before = git('rev-parse', 'topic');
    await editor.getByRole('button', { name: 'Start', exact: true }).click();
    await toast('Cherry-picked 2 commits onto topic').waitFor();
    check(git('rev-parse', 'topic~2') === before && subjects('topic~2..topic').join('|') === 'p3|p2', 'git: p2 then p3 added on topic');

    // 6. Squash 2 commits… (the new p2, p3): the preset squashes the newer into the older
    await page.keyboard.press('Escape');
    const p3 = git('rev-parse', 'topic');
    const p2 = git('rev-parse', 'topic~1');
    await commitRow(p3).waitFor();
    await selectTwo(p3, p2);
    await commitRow(p3).click({ button: 'right' });
    await choose('Squash 2 commits…');
    await list.waitFor();
    check((await order()).join(' ') === `${a7(p2)}:pick ${a7(p3)}:squash`, 'the squash preset: the older picked, the newer squashed');
    await editor.getByRole('button', { name: 'Start', exact: true }).click();
    await toast('Squashed into one commit on topic').waitFor();
    check(git('rev-parse', 'topic~1') === before && git('log', '-1', '--format=%B', 'topic').trim() === 'p2\n\np3', 'git: one commit "p2" + "p3" on the old tip');

    // 7. an Edit stop: the banner says so; Continue finishes
    await page.keyboard.press('Escape');
    const tip = git('rev-parse', 'topic');
    await commitRow(before).waitFor();
    await commitRow(before).click({ button: 'right' });
    await choose('Interactive rebase from here…');
    await row(tip).focus();
    await page.keyboard.press('e');
    await editor.getByRole('button', { name: 'Start', exact: true }).click();
    await toast(/^Stopped to edit/).waitFor();
    await banner.waitFor();
    check(rebasing() && git('rev-parse', 'REBASE_HEAD') === tip, 'git: the rebase stopped at the edited commit');
    check(await banner.getByText(`Stopped at ${a7(tip)}: amend if you like, then Continue`, { exact: true }).count() === 1, 'the banner says it stopped to edit');
    await banner.getByRole('button', { name: 'Continue', exact: true }).click();
    await toast('Rebase finished').waitFor();
    // git leaves REBASE_HEAD behind after an edit stop: the state directory is what says a rebase is in progress.
    check(!rebasing() && git('symbolic-ref', 'HEAD') === 'refs/heads/topic' && git('rev-parse', 'topic') === tip, 'git: the rebase finished, topic unchanged');
    await banner.waitFor({ state: 'detached' });

    // ---- every scheme and viewport: the editor (with a reword dialog) ----
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await open();
        await commitRow(o.work).click({ button: 'right' });
        if (vp === 'phone' && await dialog.isVisible()) { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); await commitRow(o.work).click({ button: 'right' }); }
        await choose('Interactive rebase from here…');
        await list.waitFor();
        const rows = list.locator('[data-row-index]');
        await rows.nth(1).focus();
        await page.keyboard.press('s');
        await rows.nth(2).focus();
        await page.keyboard.press('d');
        await shot(`rebase-editor-${scheme}-${vp}`);
        await rows.nth(0).focus();
        await page.keyboard.press('r');
        await dialog.getByRole('textbox', { name: 'Summary', exact: true }).waitFor();
        await shot(`rebase-reword-${scheme}-${vp}`);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await editor.getByRole('button', { name: 'Reset', exact: true }).click();
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
        await list.waitFor({ state: 'detached' });
      }
    }

    check(errors.length === 0, `no console error and no ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
