// The remotes card's golden path on the `remotes` world (remoteSeed.mjs), every step checked against git, then its
// toolbar, Pull menu and dialogs screenshotted in light and dark at desktop and phone width (the phone ones over the
// Refs dialog) into out/remotes/. Fails on a console error or a ≥400 response other than the two host URLs and the
// deliberate refusals the path triggers (counted per op).
// Run: node harness/playwright/remotes.mjs   (needs `npm run prepare` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seedRemotes, XSS_BRANCH } from './remoteSeed.mjs';
import { recordAlerts, recordReadsDuringWrites } from './settled.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'remotes');
mkdirSync(outDir, { recursive: true });

const HOST_URLS = /pluginBridge\.js|pluginTheme\.css/;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const check = (cond, what) => { if (!cond) throw new Error(`remotes: ${what}`); console.log(`ok: ${what}`); };

const world = await seedRemotes();
const o = world.oids;
const git = (...args) => world.repo.git(...args);
const config = (key) => { try { return git('config', '--get', key); } catch { return null; } };
/** Refusals the path provokes on purpose, per op: each ≥400 answer of that op uses one. */
const expected = { 'remote.add': 1, 'remote.pull': 1, 'remote.push': 2, 'remote.fetch': 1 };
try {
  await withPage(async (page) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !HOST_URLS.test(m.text()) && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => {
      if (r.status() < 400 || HOST_URLS.test(r.url())) return;
      const op = /\/api\/ops\/([\w.]+)$/.exec(new URL(r.url()).pathname)?.[1];
      if (op && expected[op] > 0) { expected[op]--; return; }
      errors.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // The rebase pull (fetch, then rebase, and the reads around them) must never be read half-done: no watcher read may
    // start while it is in flight, the header never shows a detached HEAD, and no alert shows in the header or main.
    const alerts = await recordAlerts(page);
    const pullReads = recordReadsDuringWrites(page, /\/api\/ops\/remote\.pull$/);

    const refs = page.getByRole('navigation', { name: 'Refs', exact: true });
    const toolbar = page.getByRole('group', { name: 'Remote', exact: true });
    const tool = (name) => toolbar.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog');
    const menu = page.getByRole('menu');
    // hasText is a case-insensitive substring: pass a RegExp anchored at the title where an earlier toast could match.
    const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
    const refRow = (name) => page.locator(`[data-ref="${name}"]`);
    const nameButton = (name) => refRow(name).locator(`button[title="${name}"]`);
    const remoteRow = (name) => refs.getByRole('button', { name, exact: true });
    const commitRow = (oid) => page.locator(`[data-row-id="${oid}"]`);
    const shot = async (name) => {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const open = async (q = 'project=remotes') => {
      await page.goto(`${world.url}/?${q}`);
      await commitRow(o.mine).or(commitRow(git('rev-parse', 'HEAD'))).first().waitFor();
    };
    const choose = async (...items) => {
      for (const item of items) {
        const m = menu.last();
        await m.getByRole('menuitem', { name: item, exact: true }).or(m.getByRole('menuitemradio', { name: item, exact: true })).click();
      }
    };
    const pullMenu = async (...items) => { await tool('Pull options').click(); await menu.waitFor(); await choose(...items); };
    const confirmWith = async (label) => {
      await dialog.getByRole('button', { name: label, exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    };

    await page.setViewportSize(VIEWPORTS.desktop);
    await open();

    // 1. Add remote: an ext:: url is refused inline; a valid one is added (no fetch: it stays without branches)
    await refs.getByRole('button', { name: 'Add remote', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('upstream');
    await dialog.getByRole('textbox', { name: 'Fetch URL', exact: true }).fill('ext::sh');
    await dialog.getByRole('button', { name: 'Add remote', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    check(/<transport>:: url runs a remote helper/.test(await dialog.getByRole('alert').textContent()), 'an ext:: url is refused inline (BAD_URL)');
    check(config('remote.upstream.url') === null, 'nothing was written');
    await dialog.getByRole('textbox', { name: 'Fetch URL', exact: true }).fill(world.upstreamDir);
    await dialog.getByRole('checkbox', { name: 'Fetch after adding', exact: true }).uncheck();
    await shot('add-remote-light-desktop');
    await dialog.getByRole('button', { name: 'Add remote', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await toast('Added remote upstream').waitFor();
    check(config('remote.upstream.url') === world.upstreamDir, 'git config has remote upstream');

    // 2. upstream is listed with no branches
    await remoteRow('upstream').waitFor();
    check(await refs.getByRole('list', { name: 'Branches on upstream', exact: true }).getByRole('listitem').count() === 0, 'upstream is listed with no branch');

    // 3. Fetch all, held: busy button, running toast and Cancel in the activity panel; released → done
    let heldOnce = false;
    world.cc.state.execHook = (body) => (!heldOnce && body.argv.includes('fetch') ? ((heldOnce = true), 'hold') : undefined);
    await tool('Fetch').click();
    const held = await world.cc.nextHeld();
    world.cc.state.execHook = null;
    await toast('Fetching all remotes…').waitFor();
    check(await tool('Fetch').isDisabled() && await tool('Fetch').getAttribute('aria-busy') === 'true', 'Fetch is busy and disabled while it runs');
    const running = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem', { name: 'remote.fetch running', exact: true });
    await running.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
    await shot('fetch-running-light-desktop');
    held.release();
    await toast('Fetched').first().waitFor();
    const fetched = await toast('Fetched').first().textContent();
    check(/locked needs credentials/.test(fetched) && /markup/.test(fetched), `the fetch reports the remotes it could not fetch (${fetched})`);
    check(git('rev-parse', 'origin/main') === o.theirs, 'git: origin/main is their commit');
    check(!(await tool('Fetch').isDisabled()), 'Fetch is enabled again');

    // 4. Pull: rebase made the default (persisted across a reload); ff-only refused on the diverged main; a merge pull
    await pullMenu('Rebase');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[aria-label="Pull"]')?.getAttribute('title') === 'Pull (rebase)');
    check(await tool('Pull').getAttribute('title') === 'Pull (rebase)', 'the rebase default survives a reload');
    await pullMenu('Pull (fast-forward only)');
    await toast('Diverged: pick Pull (fast-forward if possible) or Pull (rebase)').waitFor();
    check(git('rev-parse', 'HEAD') === o.mine, 'ff-only changed nothing');
    await shot('pull-diverged-light-desktop');
    await alerts.reset();
    pullReads.overlaps.length = 0;
    // Hold the rebase alone: the fetch and the checks before it have closed, the run has not ended.
    world.cc.state.execHook = (body) => (body.argv.includes('rebase') ? 'hold' : undefined);
    await tool('Pull').click();
    const rebaseHeld = await world.cc.nextHeld();
    world.cc.state.execHook = null;
    // Once the activity panel shows the held rebase running, every earlier command's close has reached the UI.
    await page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem', { name: 'remote.pull running', exact: true }).waitFor();
    check(pullReads.overlaps.length === 0, `no watcher read started while the rebase was held${pullReads.overlaps.length ? `: ${pullReads.overlaps.join('; ')}` : ''}`);
    rebaseHeld.release();
    await toast('Rebased main onto origin/main').waitFor();
    const during = await alerts.read();
    check(pullReads.overlaps.length === 0, `no watcher read started during the rebase pull${pullReads.overlaps.length ? `: ${pullReads.overlaps.join('; ')}` : ''}`);
    check(!during.detached, 'the header never showed a detached HEAD during the rebase pull');
    check(during.alerts.length === 0, `no alert showed in the header or main during the rebase pull${during.alerts.length ? `: ${during.alerts.join(' | ')}` : ''}`);
    check(git('rev-parse', 'HEAD~1') === o.theirs && git('log', '-1', '--format=%s') === 'mine', 'git: main is rebased onto their commit');
    const theirs2 = world.pushElsewhere('main', { 'theirs2.txt': 't2\n' }, 'theirs 2');
    const mine2 = world.repo.commit({ 'mine2.txt': 'm2\n' }, 'mine 2');
    await pullMenu('Pull (fast-forward if possible)');
    await toast("Merged origin/main into main").waitFor();
    check(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1).join(' ') === `${mine2} ${theirs2}`, 'git: a merge commit of main and their new commit');

    // 5. Push feature/new through the dialog: created on origin, upstream set
    await nameButton('refs/heads/feature/new').click({ button: 'right' });
    await choose('Push to remote', 'origin');
    await dialog.getByRole('textbox', { name: 'Branch on the remote', exact: true }).waitFor();
    check(await dialog.getByRole('checkbox', { name: 'Set as upstream', exact: true }).isChecked(), 'Set as upstream is on for a branch without one');
    await shot('push-dialog-light-desktop');
    await dialog.getByRole('button', { name: 'Push', exact: true }).click();
    await toast('Pushed feature/new to a new branch origin/feature/new (upstream set)').waitFor();
    check(world.onOrigin('refs/heads/feature/new') === o.base && config('branch.feature/new.remote') === 'origin', 'git: feature/new is on origin and tracks it');

    // 6. Push main, rejected: Force with lease… on a stale tracking ref offers Fetch; after it, the lease confirmation forces
    const theirs3 = world.pushElsewhere('main', { 'theirs3.txt': 't3\n' }, 'theirs 3');
    const mine3 = git('rev-parse', 'HEAD');
    await tool('Push').click();
    await toast('The remote rejected the push').waitFor();
    await toast('The remote rejected the push').getByRole('button', { name: 'Force with lease…', exact: true }).click();
    await dialog.getByRole('button', { name: 'Fetch origin', exact: true }).waitFor();
    check(/moved since the last fetch/.test(await dialog.textContent()), 'a stale tracking ref: Fetch is offered, not force');
    await shot('force-stale-light-desktop');
    await confirmWith('Fetch origin');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-sonner-toast]')].some((t) => t.textContent?.startsWith('Fetched origin')));
    check(world.onOrigin('refs/heads/main') === theirs3, 'git: origin still has their commit');
    await tool('Push').click();
    await toast('The remote rejected the push').waitFor();
    await toast('The remote rejected the push').getByRole('button', { name: 'Force with lease…', exact: true }).click();
    await dialog.getByRole('button', { name: 'Force push', exact: true }).waitFor();
    check((await dialog.textContent()).includes(`Overwrite origin/main (at ${theirs3.slice(0, 7)}) with main (${mine3.slice(0, 7)})`), 'the force confirmation names both commits');
    await shot('force-confirm-light-desktop');
    await confirmWith('Force push');
    await toast('Force-pushed main to origin/main').waitFor();
    check(world.onOrigin('refs/heads/main') === mine3, 'git: origin/main was overwritten by the lease');

    // 7. drag feature/track onto origin/feature/track → Push
    await refs.getByRole('textbox', { name: 'Filter refs', exact: true }).fill('feature/track');
    await refRow('refs/heads/main').waitFor({ state: 'detached' });
    const src = await refRow('refs/heads/feature/track').boundingBox();
    const dst = await refRow('refs/remotes/origin/feature/track').boundingBox();
    await page.mouse.move(src.x + 40, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 });
    await page.mouse.up();
    await menu.waitFor();
    const dropItems = await menu.getByRole('menuitem').allTextContents();
    check(dropItems.includes('Push feature/track to origin/feature/track'), `the drop menu offers Push (${dropItems.join(', ')})`);
    await shot('drop-push-light-desktop');
    await choose('Push feature/track to origin/feature/track');
    await toast('Pushed feature/track to origin/feature/track').waitFor();
    check(world.onOrigin('refs/heads/feature/track') === o.track2, 'git: origin/feature/track has the local commit');
    await refs.getByRole('textbox', { name: 'Filter refs', exact: true }).fill('');

    // 8. Fetch locked: the auth refusal's readable message, at once
    const t0 = Date.now();
    await remoteRow('locked').click({ button: 'right' });
    await choose('Fetch locked');
    await toast(/^locked needs credentials and code-git cannot prompt/).waitFor();
    check(Date.now() - t0 < 15_000, `the auth failure came back without waiting on a prompt (${Date.now() - t0} ms)`);
    await shot('auth-toast-light-desktop');

    // 9. Fetch origin (prune)… asks, then prunes origin/gone
    check(git('for-each-ref', 'refs/remotes/origin/gone') !== '', 'origin/gone exists before the prune');
    await remoteRow('origin').click({ button: 'right' });
    await choose('Fetch origin (prune)…');
    check(/local branches and tags are untouched/.test(await dialog.textContent()), 'the prune confirmation says what it deletes');
    await shot('prune-confirm-light-desktop');
    await confirmWith('Fetch and prune');
    await toast(/^Fetched origin: .*pruned/).waitFor();
    check(git('for-each-ref', 'refs/remotes/origin/gone') === '', 'git: origin/gone was pruned');

    // 10. Remove upstream: confirmed, gone from config
    await remoteRow('upstream').click({ button: 'right' });
    await choose('Remove…');
    check(/Remove remote upstream\?/.test(await dialog.textContent()), 'the remove confirmation names the remote');
    await confirmWith('Remove remote');
    await toast('Removed remote upstream').waitFor();
    check(config('remote.upstream.url') === null, 'git: upstream is removed');
    await remoteRow('upstream').waitFor({ state: 'detached' });

    // 11. a commit with Push after commit
    world.repo.write('notes.md', 'notes\npushed after commit\n');
    git('add', 'notes.md');
    await page.getByRole('button', { name: 'Reload changes', exact: true }).first().click();
    const box = page.getByRole('region', { name: 'Commit message', exact: true }).first();
    await box.getByRole('checkbox', { name: 'Push after commit', exact: true }).check();
    await box.getByRole('textbox', { name: 'Summary', exact: true }).fill('Ship notes');
    await box.getByRole('button', { name: /^Commit changes/ }).click();
    // A toast filter is a case-insensitive substring ("Force-pushed main…" would match): wait on git and the exact toast.
    await page.locator('[data-sonner-toast]').filter({ hasText: /^Pushed main to origin\/main$/ }).waitFor();
    check(git('log', '-1', '--format=%s') === 'Ship notes' && world.onOrigin('refs/heads/main') === git('rev-parse', 'HEAD'), 'git: the commit is on origin/main');

    // 12. the cc worktree's tab: Push stops at the cc warning
    await open('project=remotes&worktree=wt');
    await tool('Push').click();
    await dialog.getByRole('button', { name: 'Push anyway', exact: true }).waitFor();
    check(/owned by code-conductor/.test(await dialog.textContent()), 'pushing code-conductor/wt shows the cc warning');
    await shot('cc-push-light-desktop');
    const ccBefore = world.onOrigin('refs/heads/code-conductor/wt');
    await confirmWith('Cancel');
    check(world.onOrigin('refs/heads/code-conductor/wt') === ccBefore, 'Cancel pushed nothing');

    // 13. untrusted names stay text
    await open();
    check(await refRow(`refs/heads/${XSS_BRANCH}`).count() === 1, 'the branch named like markup is listed');
    await remoteRow('markup').click({ button: 'right' });
    await choose('Edit…');
    check((await dialog.getByRole('textbox', { name: 'Fetch URL', exact: true }).inputValue()).endsWith('<img src=x onerror=alert(1)>.git'), 'the markup url is shown as text');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    check(await page.locator('img').count() === 0, 'no img element exists');

    // ---- every scheme and viewport: the toolbar, the Pull menu and the dialogs ----
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(size);
        await open();
        await tool('Fetch').waitFor();
        const tb = await toolbar.boundingBox();
        check(tb.x >= 0 && tb.x + tb.width <= size.width, `${scheme} ${vp}: the remote buttons fit the width`);
        const bar = page.getByRole('region', { name: 'Commit graph', exact: true }).locator(':scope > div').first();
        const barBox = await bar.boundingBox();
        const tbFile = path.join(outDir, `toolbar-${scheme}-${vp}.png`);
        await page.screenshot({ path: tbFile, clip: { x: 0, y: barBox.y, width: size.width, height: barBox.height }, animations: 'disabled' });
        console.log(`screenshot: ${tbFile}`);
        await tool('Pull options').click();
        await menu.waitFor();
        await shot(`pull-menu-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        const fromRefs = async (name, ...items) => {
          if (vp === 'phone') {
            await page.getByRole('button', { name: 'Refs', exact: true }).click();
            await page.getByRole('dialog').getByRole('navigation', { name: 'Refs', exact: true }).waitFor();
          }
          await page.getByRole('navigation', { name: 'Refs', exact: true }).getByRole('button', { name, exact: true }).first().click({ button: 'right' });
          await choose(...items);
        };
        const closeAll = async () => {
          await page.keyboard.press('Escape');
          if (vp === 'phone') await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'detached' });
        };
        await fromRefs('origin', 'Edit…');
        await page.getByRole('textbox', { name: 'Fetch URL', exact: true }).waitFor();
        await shot(`edit-remote-${scheme}-${vp}`);
        await closeAll();
        await fromRefs('origin', 'Fetch origin (prune)…');
        await page.getByRole('button', { name: 'Fetch and prune', exact: true }).waitFor();
        await shot(`prune-confirm-${scheme}-${vp}`);
        await closeAll();
        await open('project=remotes&worktree=wt');
        await tool('Push').click();
        await page.getByRole('button', { name: 'Push anyway', exact: true }).waitFor();
        await shot(`cc-push-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
      }
    }

    const unused = Object.entries(expected).filter(([, n]) => n > 0).map(([op, n]) => `${op} ×${n}`);
    check(unused.length === 0, `every deliberate refusal happened${unused.length ? `: missing ${unused.join(', ')}` : ''}`);
    check(errors.length === 0, `no console error and no unexpected ≥400 response${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
} finally {
  await world.close();
}
