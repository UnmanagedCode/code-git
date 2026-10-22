// The branches card's deterministic world (separate from graphSeed.mjs): temp repos behind the test fake cc (real git),
// the backend booted against it.
//
// refs: main base ← two (app.txt "two") ← tip; a bare origin with main, feature/a and feature/b pushed;
//       feature/a one commit ahead of origin/feature/a; feature/b one behind origin/feature/b; scratch1, scratch2 at
//       main (merged: deletable without force); conflict: base ← c (app.txt "conflict") — cherry-picking it onto main
//       conflicts; a free cc branch code-conductor/old; cc worktree `wt` on code-conductor/wt at main; annotated v1.0
//       (message holding <img src=x>) and lightweight v1.1; a branch named feat/<img/src=x>. main has one unstaged
//       change to notes.md (no branch touches it, so checkouts carry it).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { bareRemote, makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const XSS_BRANCH = 'feat/<img/src=x>';
export const XSS_TAG_MESSAGE = 'release <img src=x onerror=alert(1)>';

export async function seedBranches() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'refs' });
    const o = {};
    o.base = repo.commit({ 'app.txt': 'one\n', 'notes.md': 'notes\n' }, 'base');
    o.two = repo.commit({ 'app.txt': 'two\n' }, 'two');
    o.tip = repo.commit({ 'readme.md': 'readme\n' }, 'tip');
    bareRemote(repo);
    repo.git('push', '-q', '-u', 'origin', 'main');
    // feature/a: pushed, then one more commit locally (ahead 1).
    repo.branch('feature/a');
    repo.commit({ 'a.txt': 'a\n' }, 'feature a');
    repo.git('push', '-q', '-u', 'origin', 'feature/a');
    o.a2 = repo.commit({ 'a.txt': 'a\na2\n' }, 'feature a, unpushed');
    // feature/b: one commit pushed that the local branch lacks (behind 1).
    repo.checkout('main');
    repo.branch('feature/b');
    o.b1 = repo.commit({ 'b.txt': 'b\n' }, 'feature b');
    o.b2 = repo.commit({ 'b.txt': 'b\nb2\n' }, 'feature b, pushed only');
    repo.git('push', '-q', '-u', 'origin', 'feature/b');
    repo.git('reset', '-q', '--hard', o.b1);
    repo.checkout('main');
    repo.git('checkout', '-q', '-b', 'conflict', o.base);
    o.conflict = repo.commit({ 'app.txt': 'conflict\n' }, 'conflicting change');
    repo.checkout('main');
    for (const b of ['scratch1', 'scratch2', 'code-conductor/old', XSS_BRANCH]) repo.git('branch', b);
    repo.git('tag', '-a', 'v1.0', '-m', XSS_TAG_MESSAGE, o.two);
    repo.git('tag', 'v1.1', o.tip);
    const wtDir = path.join(repo.root, 'wt');
    repo.git('worktree', 'add', '-q', '-b', 'code-conductor/wt', wtDir, 'main');
    repo.write('notes.md', 'notes\nedited\n');

    const cc = await fakeCc({
      home: repo.home,
      projects: { refs: { dir: repo.dir, workspace: 'Branches', isGitRepo: true, worktrees: { wt: wtDir } } },
    });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return { url: srv.url, cc, repo, oids: o, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
