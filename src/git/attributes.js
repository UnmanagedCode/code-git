import { Refusal } from '../refusals.js';
import { DIFF_LIMITS } from './diff/limits.js';

// git's own opens of its attribute files: which commands consult them, and the bounded probe runGit runs before one
// that does. git opens the system file, core.attributesFile (or its XDG default), the root .gitattributes and
// .git/info/attributes without O_NONBLOCK; .git/info/attributes and core.attributesFile follow links, the in-tree
// .gitattributes is opened O_NOFOLLOW. A FIFO there, or a device or a link to one where links are followed, blocks the
// command until its kind's timeout. Measurements and their conditions: wiki gotchas/flow-lfs.

/** `log` options measured not to consult attributes; the value-taking ones by their `--opt=` prefix. */
const LOG_OPTIONS = new Set([
  '--stdin', '--topo-order', '--reverse', '-z', '-g', '-1', '-i', '-F', '--no-walk', '--no-show-signature', '--no-ext-diff',
  '--no-textconv', '--follow', '-M', '--name-status',
]);
const LOG_VALUE_OPTIONS = ['--no-walk=', '--format=', '--date=', '--skip=', '--max-count=', '--grep=', '--author='];

/**
 * Whether every option of a `log` (or `stash list`, which takes log's) is a measured one. Revs are skipped, and so is
 * everything after `--end-of-options` or `--` (revs, paths). Any other option — a statistic, a patch, a pickaxe, one
 * nobody measured — consults.
 */
function logFree(rest) {
  for (const a of rest) {
    if (a === '--end-of-options' || a === '--') return true;
    if (a.startsWith('-') && !LOG_OPTIONS.has(a) && !LOG_VALUE_OPTIONS.some((p) => a.startsWith(p))) return false;
  }
  return true;
}

/**
 * The one allow-list of subcommands measured not to consult attributes: `true`, or a predicate over the arguments
 * after the subcommand for one whose forms are mixed. An entry needs a measurement behind it; an unlisted subcommand
 * consults. Not listed on purpose: `push` (git-lfs's pre-push hook opens .gitattributes), `read-tree` (`-m -u` writes
 * the worktree), and `diff`, `diff-index`, `diff-tree`, `hash-object`, `submodule`, `lfs` (mixed forms, none hot).
 */
export const ATTRIBUTE_FREE = new Map([
  ...['rev-parse', 'symbolic-ref', 'for-each-ref', 'update-ref', 'branch', 'tag', 'remote', 'config', 'ls-tree',
    'merge-base', 'rev-list', 'commit-tree', 'mktree', 'write-tree', 'stripspace', 'var', 'version', 'fetch', 'ls-remote'].map((s) => [s, true]),
  // `--eol` reads each file's content to report its line endings; git accepts any unique prefix of it (`--eo`).
  ['ls-files', (rest) => !rest.slice(0, rest.includes('--') ? rest.indexOf('--') : rest.length).some((a) => a.startsWith('--eo'))],
  // `--textconv` and `--filters` run the path's attribute conversion. git accepts a unique prefix of either (`--t`; `--f`
  // and `--fi` on a git without `--filter`): any prefix down to `--t` / `--f` consults.
  ['cat-file', (rest) => !rest.some((a) => a.length >= 3 && ('--textconv'.startsWith(a) || '--filters'.startsWith(a)))],
  // `worktree add` checks files out.
  ['worktree', ([verb]) => verb === 'list'],
  ['stash', ([verb, ...rest]) => verb === 'store' || verb === 'drop' || (verb === 'list' && logFree(rest))],
  ['log', logFree],
]);

/** Whether a command, `args` from its subcommand on, may open git's attribute files. */
export function consultsAttributes([sub, ...rest]) {
  const free = ATTRIBUTE_FREE.get(sub);
  return !(free === true || (typeof free === 'function' && free(rest)));
}

/** The probe: check-attr opens the same attribute files as every consulting command (git's one attribute stack). */
export const PROBE_ARGS = ['check-attr', '-z', 'filter', '--', '.gitattributes'];
/** One attribute line of output; far above it. */
const PROBE_OUTPUT_BYTES = 64 * 1024;

/**
 * Runs PROBE_ARGS through `run` ((args, opts) → a runGit-like result), bounded by DIFF_LIMITS.probeTimeoutMs (read at
 * call time). Past it: ATTRIBUTES_TIMEOUT {timeoutMs}; a timeout cannot tell a FIFO from a slow System. A probe that
 * exits non-zero (not a repository, …) is no refusal: the op's own command fails with its own mapping. Any other
 * refusal (CANCELLED, SYSTEM_UNREACHABLE, …) propagates.
 */
export async function assertAttributesReadable(run) {
  const timeoutMs = DIFF_LIMITS.probeTimeoutMs;
  try {
    await run(PROBE_ARGS, { timeoutMs, maxOutputBytes: PROBE_OUTPUT_BYTES });
  } catch (e) {
    if (e.code === 'GIT_TIMEOUT') {
      throw new Refusal('ATTRIBUTES_TIMEOUT', `git's attribute files (.gitattributes, .git/info/attributes, core.attributesFile, the system file) could not be read within ${timeoutMs / 1000} s (a special file such as a FIFO, or an unresponsive System)`, { timeoutMs });
    }
    if (e.code !== 'GIT_FAILED') throw e;
  }
}
