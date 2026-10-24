import { assertAttributesWritable, readLfsPatterns } from '../lfs/attributes.js';
import { assertLfs, lfsVersion } from '../lfs/detect.js';
import { checkPattern, LFS_LIMITS } from '../lfs/limits.js';
import { parseLsFilesJson } from '../lfs/parse.js';
import { paramsObject } from '../params.js';
import { netRun } from '../remote/net.js';
import { assertWorktree } from '../worktree.js';

// Git LFS (docs/lfs.md): a thin wrapper over the System's own git-lfs CLI. code-git never runs `git lfs install`: the
// filter config is the System's. Every git-lfs command but `version` may create .git/lfs and install git-lfs's hooks,
// so lfs.status runs only `version` and plain git; the file list is lfs.files, a write. No undo: the slots are cleared.

/**
 * Every git-lfs command but `version`: git-lfs runs git with pathspecs of its own, and under BASE_ENV's
 * GIT_LITERAL_PATHSPECS=1 its pull checks nothing out and still exits 0. `--no-literal-pathspecs` sets it to 0 for
 * git-lfs and the git it runs; no user-named argument here is a pathspec (a pattern goes into .gitattributes).
 */
const LFS = ['--no-literal-pathspecs', 'lfs'];

const none = (op) => (raw) => {
  paramsObject(raw ?? {}, [], op);
  return {};
};
const pattern = (op) => (raw) => ({ pattern: checkPattern(paramsObject(raw, ['pattern'], op).pattern) });

export const ops = [
  {
    name: 'lfs.status',
    kind: 'read',
    params: none('lfs.status'),
    async run(git) {
      const v = await lfsVersion(git);
      const unusable = { filters: null, attributes: null, patterns: null };
      if (!v.available || !v.supported) return { ...v, ...unusable };
      const [filter, attrs] = await Promise.all([
        git(['config', '--get', 'filter.lfs.process'], { okExit: [0, 1] }),
        readLfsPatterns(git),
      ]);
      return { ...v, filters: filter.exitCode === 0 && filter.stdout.toString('utf8').trim() !== '', ...attrs };
    },
  },
  {
    name: 'lfs.files',
    kind: 'write',
    // Lists only; a write because git-lfs may create .git/lfs and install its hooks while it does. No undo slot changes.
    journal: 'neutral',
    params: none('lfs.files'),
    async run(git) {
      await assertWorktree(git);
      await assertLfs(git);
      const r = await git([...LFS, 'ls-files', '--json'], { maxOutputBytes: LFS_LIMITS.listMaxOutputBytes });
      return { files: parseLsFilesJson(r.stdout) };
    },
  },
  {
    name: 'lfs.track',
    kind: 'write',
    params: pattern('lfs.track'),
    async run(git, { pattern: p }) {
      await assertWorktree(git);
      await assertLfs(git);
      await assertAttributesWritable(git);
      await git([...LFS, 'track', '--', p]);
      return { pattern: p };
    },
  },
  {
    name: 'lfs.untrack',
    kind: 'write',
    params: pattern('lfs.untrack'),
    async run(git, { pattern: p }) {
      await assertWorktree(git);
      await assertLfs(git);
      const before = (await readLfsPatterns(git)).patterns ?? [];
      // Last before the write: git-lfs opens .gitattributes by path itself, so the check narrows a swap's window, never closes it.
      await assertAttributesWritable(git);
      await git([...LFS, 'untrack', '--', p]);
      const after = (await readLfsPatterns(git)).patterns ?? [];
      // git-lfs escapes a pattern as it writes it (a space as [[:space:]]): whether a line left, not which text.
      return { pattern: p, removed: after.length < before.length };
    },
  },
  {
    name: 'lfs.pull',
    kind: 'write',
    params: none('lfs.pull'),
    async run(git) {
      await assertWorktree(git);
      await assertLfs(git);
      // git-lfs's failure wording is not classifyRemoteFailure's: a failed pull is GIT_FAILED with its stderr.
      await netRun(git, [...LFS, 'pull'], { timeoutMs: LFS_LIMITS.netTimeoutMs });
      return {};
    },
  },
  {
    name: 'lfs.prune',
    kind: 'write',
    params: none('lfs.prune'),
    async run(git) {
      await assertWorktree(git);
      await assertLfs(git);
      // git-lfs's own retention: objects not yet pushed, and those of recent refs and commits, are kept.
      await git([...LFS, 'prune']);
      return {};
    },
  },
];
