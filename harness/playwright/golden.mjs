// The golden path, asserted: open the picker → open a repo → open a worktree → Ctrl+1/Ctrl+2 switch tabs → the activity
// panel shows the git status command → a held op is cancelled from the panel. Screenshots go to out/golden-*.png.
// Run: node harness/playwright/golden.mjs   (needs `npm install` first, for frontend/dist)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { seed } from './seed.mjs';

const { withPage } = await import(BROWSER);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const check = (cond, what) => { if (!cond) throw new Error(`golden: ${what}`); console.log(`ok: ${what}`); };

const world = await seed();
try {
  await withPage(async (page) => {
    const shot = async (name) => {
      const file = path.join(outDir, `golden-${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    const selectedTab = () => page.locator('[role=tab][aria-selected=true]').textContent();
    await page.goto(world.url);
    await page.getByText('No repository open.').waitFor();

    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await page.getByRole('button', { name: 'app', exact: true }).click();
    await page.getByRole('heading', { name: 'app', exact: true }).waitFor();
    await page.getByLabel('2 ahead').waitFor();
    check(await page.getByLabel('1 behind').isVisible(), 'app header shows ahead 2 / behind 1');
    for (const t of ['1 staged', '1 unstaged', '1 untracked', '0 conflicted']) check(await page.getByText(t, { exact: true }).isVisible(), `app header shows ${t}`);
    check(new URL(page.url()).search === '?project=app', 'the URL names the active tab');
    await shot('app');

    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await page.getByRole('button', { name: 'Show worktrees of app' }).click();
    await page.getByRole('button', { name: /^feat/ }).click();
    await page.getByRole('heading', { name: 'app/feat' }).waitFor();
    check(await page.getByText('feature/login', { exact: true }).isVisible(), 'worktree tab shows its branch');
    check(new URL(page.url()).search === '?project=app&worktree=feat', 'the URL follows the worktree tab');

    await page.keyboard.press('Control+1');
    await page.getByRole('heading', { name: 'app', exact: true }).waitFor();
    check(await selectedTab() === 'app', 'Ctrl+1 activates the first tab');
    await page.keyboard.press('Control+2');
    await page.getByRole('heading', { name: 'app/feat' }).waitFor();
    check(await selectedTab() === 'app/feat', 'Ctrl+2 activates the second tab');

    const activity = page.getByRole('region', { name: 'Activity' });
    const argv = activity.locator('code').filter({ hasText: 'status --porcelain=v2 --branch -z' });
    check(await argv.count() >= 2, 'the activity panel shows the git status command of both tabs');
    await shot('tabs');

    world.hold(true);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await world.nextHeld();
    const running = activity.getByRole('listitem', { name: 'repo.summary running' });
    await running.getByRole('button', { name: 'Cancel' }).waitFor();
    await shot('running');
    await running.getByRole('button', { name: 'Cancel' }).click();
    await activity.getByRole('listitem', { name: 'repo.summary cancelled' }).waitFor();
    world.hold(false);
    check(await activity.getByRole('button', { name: 'Cancel' }).count() === 0, 'no Cancel remains once the op is cancelled');
    await shot('cancelled');
  });
} finally {
  await world.close();
}
