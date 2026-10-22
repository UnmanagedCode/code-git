import { Refusal } from '../../refusals.js';
import { DIFF_LIMITS } from '../diff/limits.js';
import { commitOid, contextArg, DIFF_CONFIG, DIFF_FLAGS, parseContext } from '../diff/source.js';
import { bad, chunkPaths, nulPaths, paramsObject, pathList } from '../params.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { buildSelectionPatch } from '../stage/selection.js';
import { assertPath } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Stage, unstage and discard whole files. Multi-path commands read their paths from stdin
// (`--pathspec-from-file=- --pathspec-file-nul`); `ls-files` and `clean` have no such option, so their paths go after
// `--` in chunks of STAGE_LIMITS.argvChunkBytes. GIT_LITERAL_PATHSPECS=1 (BASE_ENV) applies to both.

const decoder = new TextDecoder('utf-8', { fatal: false });
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];
const nulFields = (r) => decoder.decode(r.stdout).split('\0').filter(Boolean);

/** `{paths}` or `{all: true}`, exactly one. */
function pathsOrAll(raw, op) {
  const p = paramsObject(raw, ['paths', 'all'], op);
  if ((p.all === undefined) === (p.paths === undefined)) throw bad(`${op} takes exactly one of paths and all`);
  if (p.all !== undefined) {
    if (p.all !== true) throw bad('all must be true');
    return { all: true, paths: null };
  }
  return { all: false, paths: pathList(p.paths, 'paths', { max: STAGE_LIMITS.maxPaths }) };
}

/** Runs `args -- <chunk>` once per chunk of `paths`; resolves every run's NUL-separated output fields. */
async function perChunk(git, args, paths, opts) {
  const out = [];
  for (const chunk of chunkPaths(paths, STAGE_LIMITS.argvChunkBytes)) out.push(...nulFields(await git([...args, '--', ...chunk], opts)));
  return out;
}

/** Refuses CONFLICTED when any of `paths` is unmerged: restoring it would throw away the merge state. */
async function assertNotConflicted(git, paths) {
  const unmerged = await perChunk(git, ['ls-files', '-u', '-z'], paths);
  if (unmerged.length) {
    const path = unmerged[0].slice(unmerged[0].indexOf('\t') + 1);
    throw new Refusal('CONFLICTED', `${path} has a merge conflict: resolve it first`);
  }
}

/**
 * Every path must be one git itself lists as untracked and not ignored — so `clean` can never delete an ignored or tracked
 * file, or reach through a symlinked directory. A nested repository (`dir/`) is refused before asking.
 */
async function assertUntracked(git, paths) {
  const dir = paths.find((p) => p.endsWith('/'));
  if (dir) throw new Refusal('BAD_PATH', `${dir} is a directory (a nested repository?): it is never discarded`);
  const listed = new Set(await perChunk(git, ['ls-files', '--others', '--exclude-standard', '-z'], paths));
  const wanted = new Set(paths);
  const stray = paths.find((p) => !listed.has(p)) ?? [...listed].find((p) => !wanted.has(p));
  if (stray !== undefined) throw new Refusal('BAD_PATH', `${stray} is not an untracked file`);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEADER_MAX = 4096;

/** `{path, context, hunks: [{header, lines: [{index, text}]}]}`: ≥ 1 hunk, ≥ 1 line each, unique headers and indices. */
function selectionParams(raw, op) {
  const p = paramsObject(raw, ['path', 'context', 'hunks'], op);
  if (!Array.isArray(p.hunks) || !p.hunks.length) throw bad('hunks must list at least one hunk');
  const headers = new Set();
  const hunks = p.hunks.map((h) => {
    if (!isObj(h)) throw bad('each hunk must be {header, lines}');
    paramsObject(h, ['header', 'lines'], 'hunk');
    if (typeof h.header !== 'string' || !h.header.startsWith('@@ ') || h.header.length > HEADER_MAX) throw bad(`a hunk header must be an @@ line of at most ${HEADER_MAX} characters`);
    if (headers.has(h.header)) throw bad('a hunk is listed twice');
    headers.add(h.header);
    if (!Array.isArray(h.lines) || !h.lines.length) throw bad('each hunk must list at least one line');
    const seen = new Set();
    const lines = h.lines.map((l) => {
      if (!isObj(l)) throw bad('each line must be {index, text}');
      paramsObject(l, ['index', 'text'], 'line');
      if (!Number.isInteger(l.index) || l.index < 0) throw bad('a line index must be an integer ≥ 0');
      if (typeof l.text !== 'string') throw bad('a line text must be a string');
      if (seen.has(l.index)) throw bad('a line is listed twice');
      seen.add(l.index);
      return { index: l.index, text: l.text };
    });
    return { header: h.header, lines };
  });
  return { path: assertPath(p.path), context: parseContext(p.context), hunks };
}

/**
 * How each line action reads the file's diff and applies the rebuilt patch. stage: index → worktree, forward, onto the
 * index; unstage: HEAD → index, reverse, onto the index; discard: index → worktree, reverse, onto the worktree.
 */
const LINE_ACTIONS = {
  stage: { cached: false, direction: 'forward', apply: ['--cached'] },
  unstage: { cached: true, direction: 'reverse', apply: ['--cached', '-R'] },
  discard: { cached: false, direction: 'reverse', apply: ['-R'] },
};

/**
 * The context a selection patch is built and applied with. Never 0: `git apply --unidiff-zero` matches a context-free
 * hunk at the wrong occurrence (on a file without a final newline it exits 0 having changed other lines), even for
 * git's own -U0 patch. With context, git checks it and a hunk without leading/trailing context must sit at the file's start/end.
 */
export const APPLY_MIN_CONTEXT = 3;

async function applySelection(git, p, action) {
  await assertWorktree(git);
  const a = LINE_ACTIONS[action];
  let revs = [];
  if (a.cached) {
    const head = await commitOid(git, 'HEAD');
    if (!head) throw new Refusal('PARTIAL_UNSUPPORTED', 'a file with no commit yet can only be unstaged whole');
    revs = ['--cached', '--end-of-options', head];
  }
  // Whitespace is never ignored here: the hunks must be the file's real changes.
  const read = (context) => git([...DIFF_CONFIG, 'diff', ...DIFF_FLAGS, contextArg(context), ...revs, '--', p.path], { maxOutputBytes: DIFF_LIMITS.fileMaxOutputBytes })
    .then((r) => r.stdout.toString('latin1'));
  // The request is checked against the diff at its own context; the patch is built from one with enough context.
  const shown = await read(p.context);
  const applyContext = p.context === 'full' ? 'full' : Math.max(p.context, APPLY_MIN_CONTEXT);
  const patch = buildSelectionPatch(shown, p.hunks, a.direction, applyContext === p.context ? shown : await read(applyContext));
  const bytes = Buffer.from(patch, 'latin1');
  // The flags override apply.whitespace / apply.ignoreWhitespace; git checks the context, so a race fails instead of fuzzing.
  await git(['apply', ...a.apply, '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { stdin: bytes });
  return { path: p.path, ...(action === 'discard' ? { patchB64: bytes.toString('base64') } : {}) };
}

export const ops = [
  {
    name: 'stage.files',
    kind: 'write',
    params: (raw) => pathsOrAll(raw, 'stage.files'),
    async run(git, p) {
      await assertWorktree(git);
      if (p.all) await git(['add', '-A']);
      else await git(['add', '-A', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      return { paths: p.paths };
    },
  },
  {
    name: 'stage.unstageFiles',
    kind: 'write',
    params: (raw) => pathsOrAll(raw, 'stage.unstageFiles'),
    async run(git, p) {
      // An unborn HEAD has nothing to reset to: unstaging removes the entries from the index.
      const born = (await commitOid(git, 'HEAD')) !== null;
      if (born) {
        if (p.all) await git(['reset', '-q']);
        else await git(['reset', '-q', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      } else if (p.all) {
        await git(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', '.']);
      } else {
        await git(['rm', '--cached', '-r', '-q', '--ignore-unmatch', ...FROM_STDIN], { stdin: nulPaths(p.paths) });
      }
      return { paths: p.paths };
    },
  },
  {
    name: 'stage.discardFiles',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['tracked', 'untracked'], 'stage.discardFiles');
      const tracked = pathList(p.tracked ?? [], 'tracked', { min: 0, max: STAGE_LIMITS.maxPaths });
      const untracked = pathList(p.untracked ?? [], 'untracked', { min: 0, max: STAGE_LIMITS.maxPaths });
      if (!tracked.length && !untracked.length) throw bad('stage.discardFiles needs at least one path');
      if (tracked.length + untracked.length > STAGE_LIMITS.maxPaths) throw bad(`at most ${STAGE_LIMITS.maxPaths} paths`);
      return { tracked, untracked };
    },
    async run(git, p) {
      await assertWorktree(git);
      // Both gates run before anything is changed, so a refused request discards nothing.
      if (p.tracked.length) await assertNotConflicted(git, p.tracked);
      if (p.untracked.length) await assertUntracked(git, p.untracked);
      if (p.tracked.length) await git(['restore', '--worktree', ...FROM_STDIN], { stdin: nulPaths(p.tracked) });
      // No -d (directories) and no -x (ignored files).
      for (const chunk of chunkPaths(p.untracked, STAGE_LIMITS.argvChunkBytes)) await git(['clean', '-f', '-q', '--', ...chunk]);
      return { tracked: p.tracked, untracked: p.untracked };
    },
  },
  {
    name: 'stage.stageLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.stageLines'),
    run: (git, p) => applySelection(git, p, 'stage'),
  },
  {
    name: 'stage.unstageLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.unstageLines'),
    run: (git, p) => applySelection(git, p, 'unstage'),
  },
  {
    name: 'stage.discardLines',
    kind: 'write',
    params: (raw) => selectionParams(raw, 'stage.discardLines'),
    run: (git, p) => applySelection(git, p, 'discard'),
  },
];
