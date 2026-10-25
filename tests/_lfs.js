import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { bareRemote, bindRepo, hermeticEnv, makeRepo, tempDir } from './_git.js';
import { stripNet } from './_refsWorld.js';

// The world the LFS op tests share. LFS filter config goes into the test's temp HOME gitconfig (GIT_CONFIG_GLOBAL from
// hermeticEnv), never the developer's global config; remotes are bare repos reached over git-lfs's standalone file
// transfer (a path remote needs no LFS server).

export const LFS_SKIP = 'git-lfs ≥ 3.2.0 not installed on PATH';

/** Whether the git-lfs on this machine's PATH is 3.2.0 or later (the floor the ops need). */
export function lfsAvailable() {
  try {
    const m = /^git-lfs\/(\d+)\.(\d+)\./.exec(execFileSync('git', ['lfs', 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    return Boolean(m) && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 2));
  } catch {
    return false;
  }
}

const FILTERS = '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n\tprocess = git-lfs filter-process\n\trequired = true\n';

/** Adds the LFS filter config (what `git lfs install` would write) to the temp HOME's gitconfig. */
export function lfsFilters(home) {
  hermeticEnv(home);
  fs.appendFileSync(path.join(home, '.gitconfig'), FILTERS);
}

/** The hooks git-lfs installs. */
export const LFS_HOOKS = ['pre-push', 'post-checkout', 'post-commit', 'post-merge'];

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Runs an op as routes/ops.js does, in project `repo` of the fake cc; `over` overrides its ctx (shared `locks`). */
function opRunner(cc) {
  return async (name, params, over = {}) => {
    const def = getOp(OPS, name);
    const target = { project: 'repo', worktree: null };
    const ctx = ctxFor(target, def.kind, { op: name, cancellable: def.cancellable, ...over });
    return def.run(gitFor(ctx), def.params(params), { target });
  };
}

/** Every exec's argv after `git`, BASE_ARGS and (a network command's) NET_CONFIG. */
const argvsOf = (cc) => () => cc.state.execCalls.map((b) => stripNet(b.argv.slice(1 + BASE_ARGS.length)));
/** The availability probe, as the ops run it: a repo's `alias.lfs` emptied. */
export const LFS_PROBE = ['-c', 'alias.lfs=', 'lfs', 'version'];
/** A git-lfs command but `version`, as the ops run it. */
export const LFS_CMD = ['--no-literal-pathspecs', 'lfs'];
/** Whether `argv` runs git-lfs subcommand `sub`. */
export const runsLfs = (argv, sub) => (argv[0] === 'lfs' && argv[1] === sub) || (argv[0] === LFS_CMD[0] && argv[1] === 'lfs' && argv[2] === sub);

/**
 * A seed repo tracking `*.bin`: a first commit with `old.bin` (later deleted), then `a.bin`; pushed with its LFS objects
 * to a bare `origin`, then cloned smudge-skipped (`GIT_LFS_SKIP_SMUDGE=1`: the clone's `a.bin` is a pointer) as the
 * project `repo` the fake cc serves. `{repo (the clone), origin, op, argvs, gitDir, snapshotGitDir, objectPath, stripLfsState}`.
 */
export async function lfsWorld(t) {
  const seed = makeRepo(t, { name: 'seed' });
  lfsFilters(seed.home);
  seed.git('lfs', 'track', '*.bin');
  seed.commit({ 'old.bin': 'old\n' }, 'old');
  fs.rmSync(path.join(seed.dir, 'old.bin'));
  seed.commit({ 'a.bin': 'one\n', 'plain.txt': 'plain\n' }, 'a');
  const origin = bareRemote(seed);
  seed.git('push', '-q', 'origin', 'main');
  seed.git('lfs', 'push', '--all', 'origin');
  const dir = path.join(seed.root, 'repo');
  execFileSync('git', ['clone', '-q', origin.dir, dir], { env: { ...hermeticEnv(seed.home), GIT_LFS_SKIP_SMUDGE: '1' } });
  const repo = bindRepo(dir, seed.home);
  repo.root = seed.root;
  repo.home = seed.home;
  const cc = await fakeCc({ projects: { repo: { dir } }, home: seed.home });
  t.after(() => cc.close());
  const gitDir = path.join(dir, '.git');
  return {
    repo, origin, cc, op: opRunner(cc), argvs: argvsOf(cc), gitDir,
    /** Every path under .git with its kind and (files) content hash: byte-identical means equal. */
    snapshotGitDir: () => snapshotDir(gitDir),
    /** Where git-lfs stores the object for `content`. */
    objectPath: (content) => { const oid = sha256(content); return path.join(gitDir, 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4), oid); },
    /** Removes the LFS hooks and .git/lfs: the state git-lfs installs them from. */
    stripLfsState() {
      for (const h of LFS_HOOKS) fs.rmSync(path.join(gitDir, 'hooks', h), { force: true });
      fs.rmSync(path.join(gitDir, 'lfs'), { recursive: true, force: true });
    },
  };
}

export function snapshotDir(dir) {
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).sort()) {
    const p = path.join(dir, rel);
    const st = fs.lstatSync(p);
    out[rel] = st.isFile() ? `file ${st.mode} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}` : st.isSymbolicLink() ? `link ${fs.readlinkSync(p)}` : `dir ${st.mode}`;
  }
  return out;
}

/**
 * A world whose System has no git-lfs, or a stub of it: the fake cc's System PATH is a directory holding only a link to
 * git (and, given `stub`, an executable `git-lfs` script). Needs no git-lfs on this machine.
 */
export async function strippedWorld(t, { stub } = {}) {
  const repo = makeRepo(t);
  repo.commit({ 'f.txt': 'f\n' }, 'base');
  const bin = tempDir(t, 'cg-bin-');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(realGit, path.join(bin, 'git'));
  if (stub) fs.writeFileSync(path.join(bin, 'git-lfs'), stub, { mode: 0o755 });
  const cc = await fakeCc({ projects: { repo: { dir: repo.dir } }, home: repo.home });
  cc.state.inheritedEnv = { PATH: bin };
  t.after(() => cc.close());
  return { repo, cc, op: opRunner(cc), argvs: argvsOf(cc) };
}
