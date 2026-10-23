// The remotes card's deterministic world (separate from branchSeed.mjs): temp repos behind the test fake cc (real git),
// the backend booted against it.
//
// remotes: main base ← mine (mine.txt); its bare origin has main base ← theirs (theirs.txt), so main has diverged
//          (a pull must merge or rebase; a push is rejected); feature/track pushed, then one more local commit (ahead
//          1); feature/new never pushed; `gone` pushed, fetched, then deleted on origin (a prune removes
//          origin/gone); cc worktree `wt` on code-conductor/wt, pushed with its upstream; a branch named
//          feat/<img/src=x>; remote `locked` at a local http server answering 401; remote `markup` whose url holds
//          markup (a missing path); a second bare repo `upstream.git` beside it, not a remote yet (the script adds it).
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { bareRemote, hermeticEnv, makeRepo } from '../../tests/_git.js';
import { pushFromElsewhere } from '../../tests/_remotes.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const XSS_BRANCH = 'feat/<img/src=x>';
export const XSS_URL_TAIL = '<img src=x onerror=alert(1)>.git';

export async function seedRemotes() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'remotes' });
    const o = {};
    o.base = repo.commit({ 'app.txt': 'one\n', 'notes.md': 'notes\n' }, 'base');
    const origin = bareRemote(repo);
    repo.git('push', '-q', '-u', 'origin', 'main');
    const w = { repo, origin };
    // feature/track: pushed, then one more commit locally (ahead 1).
    repo.branch('feature/track');
    o.track1 = repo.commit({ 't.txt': 't\n' }, 'track');
    repo.git('push', '-q', '-u', 'origin', 'feature/track');
    o.track2 = repo.commit({ 't.txt': 't\nt2\n' }, 'track, unpushed');
    repo.checkout('main');
    repo.git('branch', 'feature/new');
    repo.git('branch', XSS_BRANCH);
    // gone: on origin and fetched, then deleted there.
    repo.git('push', '-q', 'origin', 'main:gone');
    repo.git('fetch', '-q', 'origin');
    origin.git('branch', '-D', 'gone');
    // The cc worktree, pushed with its upstream.
    const wtDir = path.join(repo.root, 'wt');
    repo.git('worktree', 'add', '-q', '-b', 'code-conductor/wt', wtDir, 'main');
    repo.git('-C', wtDir, 'push', '-q', '-u', 'origin', 'code-conductor/wt');
    // main diverges from origin/main (not fetched yet: the UI's first fetch brings theirs).
    o.theirs = pushFromElsewhere(w, 'main', { 'theirs.txt': 'theirs\n' }, 'theirs');
    o.mine = repo.commit({ 'mine.txt': 'mine\n' }, 'mine');
    // A second bare repo, added as `upstream` through the UI.
    const upstreamDir = path.join(repo.root, 'upstream.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstreamDir], { env: hermeticEnv(repo.home) });
    // `locked`: a server that asks for credentials no helper provides.
    const server = http.createServer((req, res) => { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); res.end(); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
    repo.git('remote', 'add', 'locked', `http://127.0.0.1:${server.address().port}/r.git`);
    repo.git('remote', 'add', 'markup', path.join(repo.root, XSS_URL_TAIL));

    const cc = await fakeCc({
      home: repo.home,
      projects: { remotes: { dir: repo.dir, workspace: 'Remotes', isGitRepo: true, worktrees: { wt: wtDir } } },
    });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return {
      url: srv.url, cc, repo, origin, oids: o, upstreamDir, wtDir, close: cleanup,
      /** Another clone commits `files` on `branch` and pushes it to origin. → the commit. */
      pushElsewhere: (branch, files, msg) => pushFromElsewhere(w, branch, files, msg),
      onOrigin: (ref) => { try { return origin.git('rev-parse', '--verify', '-q', ref); } catch { return null; } },
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
