import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getOp, OPS } from '../src/git/ops/index.js';
import { ctxFor, gitFor } from './_ctx.js';
import { HOSTILE_CONFIG } from './_diffRepo.js';
import { fakeCc } from './_fakeCc.js';
import { hermeticEnv, makeRepo } from './_git.js';

// The world the staging / commit / ignore / patch op tests share: one repo behind the fake cc, and `op(name, params)`
// running an op as routes/ops.js does (params checked, then run with its definition's kind and cancellable).

/**
 * Repo config that would reshape what those ops read or write if it were not overridden: the diff fixture's keys, an
 * external diff that fails, `apply.*` keys that make `git apply` refuse or fuzz whitespace, and `core.worktree` pointing
 * at another directory (a function of the repo: `ELSEWHERE` beside it). Set it after the fixture's own commits.
 */
export const STAGE_HOSTILE_CONFIG = [
  ...HOSTILE_CONFIG, ['diff.external', 'false'], ['apply.whitespace', 'error'], ['apply.ignoreWhitespace', 'change'],
  ['core.worktree', (repo) => elsewhereOf(repo)],
];
/** The directory a hostile core.worktree names; it holds `ELSEWHERE_FILES`, which no op may read, change or delete. */
export const elsewhereOf = (repo) => path.join(repo.root, 'elsewhere');
export const ELSEWHERE_FILES = { 'a.txt': 'ELSEWHERE a\n', 'b.txt': 'ELSEWHERE b\n', 'only-there.txt': 'ELSEWHERE only\n', '.gitignore': '*.txt\n' };
/** Every file under the elsewhere directory with its content. */
export const elsewhereSnapshot = (repo) => Object.fromEntries(fs.readdirSync(elsewhereOf(repo), { recursive: true })
  .filter((f) => fs.statSync(path.join(elsewhereOf(repo), f)).isFile()).sort()
  .map((f) => [f, fs.readFileSync(path.join(elsewhereOf(repo), f), 'utf8')]));
export function hostile(repo) {
  fs.mkdirSync(elsewhereOf(repo), { recursive: true });
  for (const [f, c] of Object.entries(ELSEWHERE_FILES)) fs.writeFileSync(path.join(elsewhereOf(repo), f), c);
  for (const [k, v] of STAGE_HOSTILE_CONFIG) repo.git('config', k, typeof v === 'function' ? v(repo) : v);
  repo.pinWorkTree = true;
}

export async function opWorld(t, { name = 'repo' } = {}) {
  const repo = makeRepo(t, { name });
  const cc = await fakeCc({ projects: { [name]: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());
  const target = { project: name, worktree: null };
  /** `over` overrides the op's ctx (a shared `locks`). */
  const op = async (opName, params, over = {}) => {
    const def = getOp(OPS, opName);
    const ctx = ctxFor(target, def.kind, { op: opName, cancellable: def.cancellable, ...over });
    return def.run(gitFor(ctx), def.params(params), { target });
  };
  /** A command's raw stdout (blob bytes stay bytes). */
  const raw = (...args) => execFileSync('git', ['-C', repo.dir, ...(repo.pinWorkTree ? ['--work-tree=.'] : []), ...args], { env: hermeticEnv(repo.home) });
  /** `path` → two-letter status, from `git status --porcelain -z` (untracked files listed individually). */
  const status = () => {
    const f = raw('status', '--porcelain', '-z', '--untracked-files=all').toString('utf8').split('\0');
    const out = {};
    for (let i = 0; i < f.length; i++) {
      if (!f[i]) continue;
      out[f[i].slice(3)] = f[i].slice(0, 2);
      if (f[i][0] === 'R' || f[i][0] === 'C') i++;
    }
    return out;
  };
  /** The index's bytes of `path`, or null when it has no stage-0 entry. */
  const indexBlob = (path) => {
    try { return raw('cat-file', 'blob', `:${path}`); } catch { return null; }
  };
  const execArgv = () => cc.state.execCalls.map((b) => b.argv);
  return { repo, cc, op, target, raw, status, indexBlob, execArgv };
}

export const refused = (code) => (e) => { assert.equal(e.code, code, e.message); return true; };
export const noViolations = (cc) => assert.deepEqual(cc.state.violations, []);
