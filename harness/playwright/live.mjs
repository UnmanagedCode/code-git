// READ-ONLY check against a live code-conductor: boots this checkout's backend with CONDUCTOR_URL pointed at it and
// drives the UI's read path only (the picker, repo.summary — `git status` with GIT_OPTIONAL_LOCKS=0 — and the reads an
// open tab makes: the graph, branch.tracking, remote.list). On a checkout whose project lives on a non-local System it
// also asks the remote where HEAD's upstream branch is (remote.peek: `git ls-remote`, a read). It never calls a write
// op (the script fails if any is posted), never registers or enables the plugin.
// Run: CONDUCTOR_URL=http://127.0.0.1:<cc port> node harness/playwright/live.mjs [project[/worktree] …]
// Default checkouts: code-git, code-git/c1-foundation, test, test/review-demo. Screenshots go to out/live/.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { OPS } from '../../src/git/ops/index.js';
import { NETWORK_LIMITS } from '../../src/git/remote/limits.js';

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
/** Runs a read op through this backend → {status, body}. Refuses anything the registry does not call a read. */
async function readOp(name, target, params) {
  if (OPS.get(name)?.kind !== 'read') throw new Error(`live: ${name} is not a read op`);
  const res = await fetch(`${srv.url}/api/ops/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: target.worktree ? target : { project: target.project }, ...(params ? { params } : {}) }),
  });
  return { status: res.status, body: await res.json() };
}
try {
  await withPage(async (page) => {
    const nonReads = [];
    page.on('request', (r) => {
      const op = /\/api\/ops\/([\w.]+)$/.exec(new URL(r.url()).pathname)?.[1];
      if (op && OPS.get(op)?.kind !== 'read') nonReads.push(op);
    });
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
      // HEAD shows a branch, or the detached / unborn badge. cc's recorded branch for a worktree is only where it started:
      // HEAD may since be detached or on another branch, so a match is reported, not required.
      const head = (await header.getByRole('group', { name: 'HEAD' }).innerText()).replace(/\s+/g, ' ').trim();
      const kind = /^detached ?[0-9a-f]{7,}$/.test(head) ? 'detached' : /^\S+ ?no commits yet$/.test(head) ? 'unborn' : /^\S+$/.test(head) ? 'branch' : null;
      check(kind !== null, `${label(c)}: HEAD shows a branch, or the detached or unborn badge (got "${head}")`);
      if (c.worktree && kind === 'branch') {
        const recorded = (await (await fetch(`${cc}/api/projects/${encodeURIComponent(c.project)}/worktrees`)).json()).find((w) => w.worktreeName === c.worktree)?.branch;
        console.log(`note: ${label(c)}: HEAD ${head} ${head === recorded ? 'is' : 'is not'} the branch cc recorded (${recorded ?? 'none'})`);
      }
      const remoteBar = page.getByRole('group', { name: 'Remote', exact: true });
      for (const b of ['Pull', 'Push']) await remoteBar.getByRole('button', { name: b, exact: true }).waitFor();
      check(await remoteBar.getByRole('button', { name: /^Fetch/ }).count() === 1, `${label(c)}: the toolbar shows Fetch, Pull and Push`);
      await shot(label(c).replace('/', '_'));
    }

    const ran = (await (await fetch(`${srv.url}/api/activity`)).json()).entries;
    for (const project of [...new Set(CHECKOUTS.map((c) => c.project))]) {
      const listed = ran.filter((e) => e.op === 'remote.list' && e.target.project === project);
      for (const e of listed) console.log(`note: ${project}: remote.list ran ${e.argv.slice(-3).join(' ')} → ${e.status}, exit ${e.exitCode}`);
      // `config --get-regexp` exits 1 when no remote key exists (accepted); `git remote` itself must exit 0.
      check(listed.length > 0 && listed.every((e) => e.status === 'ok') && listed.some((e) => e.argv.at(-1) === 'remote' && e.exitCode === 0),
        `${project}: remote.list answered (git remote exit 0, every command ok)`);
    }

    // A non-local System: where HEAD's upstream branch is on its remote, with the System's own credentials, never a prompt.
    for (const c of CHECKOUTS) {
      const system = projects.find((p) => p.name === c.project)?.system ?? 'local';
      if (system === 'local') continue;
      const summary = await readOp('repo.summary', c);
      const branch = summary.body.result?.head.branch;
      const tracking = (await readOp('branch.tracking', c)).body.result;
      const upstream = branch ? tracking?.branches[`refs/heads/${branch}`]?.upstream : null;
      if (!upstream?.startsWith('refs/remotes/')) { console.log(`note: ${label(c)} (${system}): HEAD has no upstream on a remote, no peek`); continue; }
      const rest = upstream.slice('refs/remotes/'.length);
      const remote = [...tracking.remotes].sort((a, b) => b.length - a.length).find((r) => rest.startsWith(`${r}/`));
      const t0 = Date.now();
      const peek = await readOp('remote.peek', c, { remote, branch: rest.slice(remote.length + 1) });
      const ms = Date.now() - t0;
      const ok = peek.status === 200 || (['REMOTE_AUTH_FAILED', 'REMOTE_UNREACHABLE'].includes(peek.body.code) && typeof peek.body.error === 'string' && peek.body.error.length > 0);
      console.log(`note: ${label(c)} (${system}): remote.peek ${remote}/${rest.slice(remote.length + 1)} → ${peek.status} ${peek.status === 200 ? JSON.stringify(peek.body.result) : `${peek.body.code}: ${peek.body.error} (${peek.body.reason ?? ''})`} in ${ms} ms`);
      check(ok && ms < NETWORK_LIMITS.timeoutMs, `${label(c)}: remote.peek answers (ok, or a readable auth/unreachable refusal) within NETWORK_LIMITS.timeoutMs, never waiting on a prompt`);
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
    check(nonReads.length === 0, `the page posted only read ops${nonReads.length ? `: ${nonReads.join(', ')}` : ''}`);
    const after = (await (await fetch(`${srv.url}/api/activity`)).json()).entries;
    check(after.every((e) => e.kind === 'read'), 'every git command that ran was a read');
  });
} finally {
  await srv.close();
}
