// The commit graph's own deterministic world: temp repos behind the test fake cc (real git), the backend booted
// against it. Separate from seed.mjs so each visual check has the topology it asserts on.
//
// lanes: main A ← B ← C ← M1 (merge of feature/a: B ← E ← F) ← D (HEAD, an HTML-looking subject), pushed to a bare
//        origin; feature/b: C ← G, unmerged, checked out in cc worktree `wt` (dirty); cc worktree `side` on
//        code-conductor/side at C (clean); annotated v1.0 on B, lightweight v1.1 on M1; one stash on D; main dirty.
//        C carries a Co-authored-by trailer.
// ages:  linear a0 ← … ← a6 (main), committed at now−800d, −400d, −100d, −2d (newer than its child), −40d, −10d, −5min
//        relative to the seed's clock; top-down the age markers are a5 `last week`, a4 `last month`, a2 `3 months ago`,
//        a1 `1 year ago`, a0 `2 years ago` (a3 none, a6 is the first row), at any time of day.
// big:   the perf fixture (tests/_graphFixture.js defaults).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { buildGraphFixture } from '../../tests/_graphFixture.js';
import { bareRemote, hermeticEnv, makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const XSS_SUBJECT = '<img src=x onerror=alert(1)>';

export async function seedGraph() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'lanes' });
    const as = (name, files, msg) => {
      for (const [rel, content] of Object.entries(files)) repo.write(rel, content);
      repo.git('add', '-A');
      const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
      execFileSync('git', ['-C', repo.dir, 'commit', '-q', '--cleanup=verbatim', '-m', msg], {
        env: { ...hermeticEnv(repo.home), GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email },
      });
      return repo.git('rev-parse', 'HEAD');
    };
    const o = {};
    o.A = as('Ada Lovelace', { 'README.md': '# lanes\n', 'src/a.js': 'a\n' }, 'Initial commit');
    o.B = as('Ada Lovelace', { 'src/a.js': 'a\nb\n' }, 'Add parser');
    repo.branch('feature/a');
    o.E = as('Linus Torvalds', { 'src/b.js': 'b\n' }, 'feature: start b');
    o.F = as('Linus Torvalds', { 'src/b.js': 'b\nb2\n' }, 'feature: finish b');
    repo.checkout('main');
    o.C = as('Grace Hopper', { 'docs/guide.md': 'guide\n' }, 'Write the guide\n\nCo-authored-by: Alan Turing <alan@example.com>\n');
    repo.branch('feature/b');
    o.G = as('Margaret Hamilton', { 'src/g.js': 'g\n' }, 'feature b: add g');
    repo.checkout('main');
    repo.git('merge', '-q', '--no-ff', '-m', "Merge branch 'feature/a'", 'feature/a');
    o.M1 = repo.git('rev-parse', 'HEAD');
    o.D = as('Ada Lovelace', { 'src/a.js': 'a\nb\nd\n' }, XSS_SUBJECT);
    repo.git('tag', '-a', 'v1.0', '-m', 'v1.0', o.B);
    repo.git('tag', 'v1.1', o.M1);
    bareRemote(repo);
    repo.git('push', '-q', 'origin', 'main');
    repo.write('README.md', '# lanes\nstashed\n');
    repo.git('stash', 'push', '-q', '-m', 'half-done readme');
    o.stash = repo.git('rev-parse', 'stash@{0}');
    repo.write('src/a.js', 'a\nb\nd\nwip\n');
    repo.write('notes.txt', 'untracked\n');
    const wtDir = path.join(repo.root, 'wt');
    repo.git('worktree', 'add', '-q', wtDir, 'feature/b');
    fs.writeFileSync(path.join(wtDir, 'src', 'g.js'), 'g\nwip\n');
    const sideDir = path.join(repo.root, 'side');
    repo.git('worktree', 'add', '-q', '-b', 'code-conductor/side', sideDir, o.C);

    const agesRepo = makeRepo(t, { name: 'ages' });
    const seededAt = Math.floor(Date.now() / 1000);
    const ages = {};
    [['a0', 800 * 86400], ['a1', 400 * 86400], ['a2', 100 * 86400], ['a3', 2 * 86400], ['a4', 40 * 86400], ['a5', 10 * 86400], ['a6', 300]].forEach(([name, age]) => {
      const date = `@${seededAt - age} +0000`;
      execFileSync('git', ['-C', agesRepo.dir, 'commit', '-q', '--allow-empty', '-m', name], {
        env: { ...hermeticEnv(agesRepo.home), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
      ages[name] = agesRepo.git('rev-parse', 'HEAD');
    });

    const big = makeRepo(t, { name: 'big' });
    buildGraphFixture(big.dir, big.home);

    const cc = await fakeCc({
      home: repo.home,
      projects: {
        lanes: { dir: repo.dir, workspace: 'Graph', isGitRepo: true, worktrees: { wt: wtDir, side: sideDir } },
        ages: { dir: agesRepo.dir, workspace: 'Graph', isGitRepo: true },
        big: { dir: big.dir, workspace: 'Graph', isGitRepo: true },
      },
    });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return { url: srv.url, oids: o, ages, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
