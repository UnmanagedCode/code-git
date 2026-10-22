import { Refusal } from '../../refusals.js';
import { bad, paramsObject } from '../params.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { assertWorktree } from '../worktree.js';

// Check and apply a user's patch (plain diff or mailbox). Atomic: no --reject, so all of it applies or none.
// Never --unsafe-paths, --directory, -p, --include/--exclude or --3way: git refuses `..`, absolute and `.git/` paths,
// and paths beyond a symlink in the worktree. Never --index either: it checks symlinks against the index only, so a
// path through an untracked symlink to a directory is written outside the repo (wiki: gotchas/staging-patches).

const decoder = new TextDecoder('utf-8', { fatal: false });
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TARGET = { worktree: [], index: ['--cached'] };
const FLAGS = ['--whitespace=nowarn', '--no-ignore-whitespace'];

function patchParams(raw, op) {
  const p = paramsObject(raw, ['patchB64', 'apply'], op);
  if (typeof p.patchB64 !== 'string' || !B64_RE.test(p.patchB64)) throw bad('patchB64 must be strict base64');
  const bytes = Buffer.from(p.patchB64, 'base64');
  if (!bytes.length || bytes.length > STAGE_LIMITS.applyPatchMaxBytes) throw bad(`a patch must be 1…${STAGE_LIMITS.applyPatchMaxBytes} bytes`);
  const apply = p.apply ?? 'worktree';
  if (!Object.hasOwn(TARGET, apply)) throw bad("apply must be 'worktree' or 'index'");
  return { bytes, apply };
}

/** Runs `git apply …`; exit 1 (does not apply) or 128 (no valid patch, an unsafe path) → PATCH_DOES_NOT_APPLY with stderr. */
async function apply(git, args, bytes) {
  const r = await git(['apply', ...args, '-'], { stdin: bytes, okExit: [0, 1, 128] });
  if (r.exitCode !== 0) {
    const stderr = decoder.decode(r.stderr);
    throw new Refusal('PATCH_DOES_NOT_APPLY', `the patch does not apply: ${stderr.trim().split('\n').at(-1) ?? ''}`, { exitCode: r.exitCode, stderr });
  }
  return r;
}

/** `--numstat -z` → [{path, oldPath, added, deleted}] (`null` counts for a binary file). */
function parseNumstat(out) {
  const f = out.split('\0');
  const files = [];
  for (let i = 0; i < f.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(f[i]);
    if (!m) continue;
    const count = (v) => (v === '-' ? null : Number(v));
    // A rename's record has an empty path, then the old and new paths.
    const renamed = m[3] === '';
    files.push({ path: renamed ? f[i + 2] : m[3], oldPath: renamed ? f[i + 1] : null, added: count(m[1]), deleted: count(m[2]) });
    if (renamed) i += 2;
  }
  return files;
}

export const ops = [
  {
    name: 'patch.check',
    kind: 'read',
    params: (raw) => patchParams(raw, 'patch.check'),
    async run(git, p) {
      const r = await apply(git, ['--check', '--numstat', '-z', ...TARGET[p.apply], ...FLAGS], p.bytes);
      return { files: parseNumstat(decoder.decode(r.stdout)) };
    },
  },
  {
    name: 'patch.apply',
    kind: 'write',
    params: (raw) => patchParams(raw, 'patch.apply'),
    async run(git, p) {
      await assertWorktree(git);
      await apply(git, [...TARGET[p.apply], ...FLAGS], p.bytes);
      return { apply: p.apply, bytes: p.bytes.length };
    },
  },
];
