// One deterministic world for the visual harness: temp repos behind a fake cc (which runs real git), and the backend
// booted against it. Reuses the backend test helpers, so there is one implementation of the fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { diffRepo } from '../../tests/_diffRepo.js';
import { bareRemote, makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function seed() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    // app: main ahead 2 / behind 1 of a bare origin, with staged, unstaged and untracked changes; a `feat` worktree.
    const app = makeRepo(t, { name: 'app' });
    bareRemote(app);
    app.commit({ 'README.md': '# app\n', 'src/a.js': 'a\n' }, 'initial');
    app.git('push', '-q', '-u', 'origin', 'main');
    app.branch('tmp');
    app.commit({ 'theirs.txt': 'upstream change\n' }, 'upstream');
    app.git('push', '-q', 'origin', 'tmp:main');
    app.checkout('main');
    app.git('branch', '-q', '-D', 'tmp');
    app.commit({ 'src/b.js': 'b\n' }, 'local 1');
    app.commit({ 'src/c.js': 'c\n' }, 'local 2');
    app.write('src/a.js', 'staged\n');
    app.git('add', 'src/a.js');
    app.write('src/b.js', 'unstaged\n');
    app.write('notes.txt', 'untracked\n');
    const feat = app.worktreeAdd(path.join(app.root, 'feat'), 'feature/login');
    feat.commit({ 'login.js': 'login\n' }, 'login');

    // diffs: every diff source and file state, under a hostile .git/config (tests/_diffRepo.js).
    const diffs = diffRepo(t);

    const plain = path.join(app.root, 'plain');
    fs.mkdirSync(plain);
    const cc = await fakeCc({
      home: app.home,
      projects: {
        app: { dir: app.dir, workspace: 'Web', isGitRepo: true, worktrees: { feat: feat.dir }, locked: ['feat'] },
        box: { dir: app.dir, workspace: 'Web', system: 'docker', remoteId: 'cc-box', isGitRepo: true },
        plain: { dir: plain, workspace: 'Web', isGitRepo: false },
        gone: { dir: '/nowhere', workspace: 'Ops', systemUnreachable: "system 'ssh' (build-01) could not be reached: connection refused" },
        notes: { dir: plain, workspace: null, isGitRepo: true },
        diffs: { dir: diffs.repo.dir, workspace: 'Web', isGitRepo: true },
      },
    });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return {
      url: srv.url,
      diffs,
      /** While on, every exec is held by the fake cc (until cancelled or released). */
      hold(on) { cc.state.execHook = on ? () => 'hold' : null; },
      nextHeld: () => cc.nextHeld(),
      close: cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
