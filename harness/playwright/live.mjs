// READ-ONLY check against a live code-conductor: boots this checkout's backend with CONDUCTOR_URL pointed at it and
// drives the UI's read path only (the picker and repo.summary, which runs `git status` with GIT_OPTIONAL_LOCKS=0).
// It never calls a write route, never registers or enables the plugin, and touches projects only through repo.summary.
// Run: CONDUCTOR_URL=http://127.0.0.1:<cc port> node harness/playwright/live.mjs [project[/worktree] …]
// Default checkouts: code-git, code-git/c1-foundation, test, test/review-demo. Screenshots go to out/live/.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';

const cc = process.env.CONDUCTOR_URL;
if (!cc) throw new Error('CONDUCTOR_URL is not set: point it at the live cc (see harness/playwright/README.md)');
const health = await (await fetch(`${cc}/api/health`)).json();
if (health.app !== 'code-conductor') throw new Error(`${cc} is not a code-conductor: ${JSON.stringify(health)}`);

const { bootServer, withPage } = await import(BROWSER);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out', 'live');
mkdirSync(outDir, { recursive: true });
const CHECKOUTS = (process.argv.length > 2 ? process.argv.slice(2) : ['code-git', 'code-git/c1-foundation', 'test', 'test/review-demo'])
  .map((s) => { const [project, worktree = null] = s.split('/'); return { project, worktree }; });
const label = (c) => (c.worktree ? `${c.project}/${c.worktree}` : c.project);
const check = (cond, what) => { if (!cond) throw new Error(`live: ${what}`); console.log(`ok: ${what}`); };

const projects = await (await fetch(`${cc}/api/projects`)).json();
const srv = await bootServer({ cwd: path.resolve(here, '..', '..'), entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc } });
try {
  await withPage(async (page) => {
    let n = 0;
    const shot = async (name) => {
      const file = path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`screenshot: ${file}`);
    };
    // A fresh browser profile: no persisted tabs.
    await page.goto(srv.url);
    await page.getByText('No repository open.').waitFor();
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Open a repository' });
    await dialog.getByRole('button', { name: /^Show worktrees of / }).first().waitFor({ timeout: 60_000 });
    const listed = (await dialog.getByRole('button', { name: /^Show worktrees of / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
      .map((s) => s.replace(/^Show worktrees of /, ''));
    check(JSON.stringify([...listed].sort()) === JSON.stringify(projects.map((p) => p.name).sort()), `the picker lists exactly cc's ${projects.length} projects`);
    for (const p of projects.filter((x) => x.isGitRepo === false)) {
      check(await dialog.getByRole('button', { name: p.name, exact: true }).isDisabled(), `non-git project ${p.name} is disabled`);
    }
    await shot('picker');
    await page.keyboard.press('Escape');

    for (const c of CHECKOUTS) {
      await page.getByRole('button', { name: 'Open repository', exact: true }).click();
      if (c.worktree) {
        await dialog.getByRole('button', { name: `Show worktrees of ${c.project}` }).click();
        await dialog.getByRole('list', { name: `Checkouts of ${c.project}` }).getByRole('button', { name: new RegExp(`^${c.worktree}`) }).click();
      } else {
        await dialog.getByRole('button', { name: c.project, exact: true }).click();
      }
      const header = page.locator('header[aria-label="Repository summary"]');
      await page.getByRole('heading', { name: label(c), exact: true }).waitFor();
      await header.getByText(/\d+ conflicted/).or(header.getByRole('alert')).first().waitFor({ timeout: 60_000 });
      check(await header.getByRole('alert').count() === 0, `${label(c)}: the summary loaded without an error`);
      check(await header.getByText(/\d+ conflicted/).isVisible(), `${label(c)}: the header shows the change counts`);
      // HEAD: a worktree's branch must be the one cc records; a main checkout shows a branch, or the detached / unborn badge.
      const head = (await header.getByRole('group', { name: 'HEAD' }).innerText()).replace(/\s+/g, ' ').trim();
      const expected = c.worktree
        ? (await (await fetch(`${cc}/api/projects/${encodeURIComponent(c.project)}/worktrees`)).json()).find((w) => w.worktreeName === c.worktree)?.branch
        : null;
      if (expected) check(head === expected, `${label(c)}: HEAD shows cc's branch ${expected} (got "${head}")`);
      else check(/^detached ?[0-9a-f]{7,}$/.test(head) || /^\S+ ?no commits yet$/.test(head) || /^\S+$/.test(head), `${label(c)}: HEAD shows a branch, detached or unborn (got "${head}")`);
      await shot(label(c).replace('/', '_'));
    }

    const activity = page.getByRole('region', { name: 'Activity' });
    for (const c of CHECKOUTS) {
      const row = activity.getByRole('listitem').filter({ has: page.getByText(label(c), { exact: true }) })
        .filter({ hasText: 'status --porcelain=v2' }).filter({ hasText: 'exit 0' });
      check(await row.count() >= 1, `${label(c)}: the activity panel shows its git status with exit 0`);
    }
    await page.keyboard.press('Control+1');
    await page.getByRole('heading', { name: label(CHECKOUTS[0]), exact: true }).waitFor();
    check(true, 'Ctrl+1 activates the first tab');
    await page.keyboard.press('Control+2');
    await page.getByRole('heading', { name: label(CHECKOUTS[1]), exact: true }).waitFor();
    check(true, 'Ctrl+2 activates the second tab');
    await shot('final');
  });
} finally {
  await srv.close();
}
