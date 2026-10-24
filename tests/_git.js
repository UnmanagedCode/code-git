import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';

const DATE = '2024-01-01T00:00:00Z';

/** A hermetic git environment: no system or user config, a temp HOME, pinned identity and dates. */
export function hermeticEnv(home) {
  const global = path.join(home, '.gitconfig');
  if (!fs.existsSync(global)) {
    fs.writeFileSync(global, '[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n');
  }
  return {
    PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: global,
    GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE, LC_ALL: 'C',
  };
}

/** A fresh temp directory removed after the test. */
export function tempDir(t, prefix = 'cg-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Helpers around an existing checkout directory. */
export function bindRepo(dir, home) {
  const env = hermeticEnv(home);
  // `repo.pinWorkTree` (set by a hostile core.worktree) pins the helper's own commands to the checkout, as BASE_ARGS does.
  const git = (...args) => execFileSync('git', ['-C', dir, ...(repo.pinWorkTree ? ['--work-tree=.'] : []), ...args], { encoding: 'utf8', env }).trim();
  const repo = {
    dir,
    git,
    write(rel, content) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    },
    /** Writes `files` ({rel: content}), stages everything and commits; returns the sha. */
    commit(files = {}, msg = 'c') {
      for (const [rel, content] of Object.entries(files)) repo.write(rel, content);
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', msg);
      return git('rev-parse', 'HEAD');
    },
    branch: (name, from = 'HEAD') => git('checkout', '-q', '-b', name, from),
    checkout: (name) => git('checkout', '-q', name),
    worktreeAdd(wtDir, branch, from = 'HEAD') {
      git('worktree', 'add', '-q', '-b', branch, wtDir, from);
      return bindRepo(wtDir, home);
    },
    /** Installs an executable hook script. */
    hook(name, script) {
      const p = path.join(dir, '.git', 'hooks', name);
      fs.writeFileSync(p, script, { mode: 0o755 });
    },
  };
  return repo;
}

/** A fresh repo on `main` in its own temp dir (siblings such as worktrees and remotes live there too), removed after the test. */
export function makeRepo(t, { name = 'repo' } = {}) {
  const root = tempDir(t, 'cg-repo-');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const repo = bindRepo(dir, home);
  repo.git('init', '-q', '-b', 'main');
  repo.root = root;
  repo.home = home;
  return repo;
}

/** A bare repo beside `repo`, added as its `origin`. */
export function bareRemote(repo) {
  const dir = path.join(repo.root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir], { env: hermeticEnv(repo.home) });
  repo.git('remote', 'add', 'origin', dir);
  return bindRepo(dir, repo.home);
}

/** A FIFO at `p`. git >= 2.42 opens a FIFO named on its command line, so a probe of it blocks until its bound. */
export const mkfifo = (p) => execFileSync('mkfifo', [p]);

/** Shortens the stat-only probe's bound (DIFF_LIMITS.probeTimeoutMs) for this test; restored after it. */
export function shortProbe(t, ms = 300) {
  const prev = DIFF_LIMITS.probeTimeoutMs;
  DIFF_LIMITS.probeTimeoutMs = ms;
  t.after(() => { DIFF_LIMITS.probeTimeoutMs = prev; });
}

/** `p`'s rejection and how long it took to come (ms); throws if `p` resolves. */
export async function rejection(p) {
  const t0 = performance.now();
  try {
    await p;
  } catch (e) {
    return { e, ms: performance.now() - t0 };
  }
  throw new Error('expected a rejection');
}
