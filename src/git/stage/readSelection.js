import { DIFF_LIMITS } from '../diff/limits.js';
import { contextArg, DIFF_CONFIG, DIFF_FLAGS, parseContext } from '../diff/source.js';
import { bad, paramsObject } from '../params.js';
import { assertPath } from '../validate.js';
import { buildSelectionPatch } from './selection.js';

// A line selection request (docs/protocol.md → Hunk and line ops) and the patch it stands for. Shared by the line
// staging ops and the line stash: one validation, one read, one builder.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEADER_MAX = 4096;

/** `{path, context, hunks: [{header, lines: [{index, text}]}]}`: ≥ 1 hunk, ≥ 1 line each, unique headers and indices. */
export function selectionParams(raw, op) {
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
 * The context a selection patch is built and applied with. Never 0: `git apply --unidiff-zero` matches a context-free
 * hunk at the wrong occurrence (on a file without a final newline it exits 0 having changed other lines), even for
 * git's own -U0 patch. With context, git checks it and a hunk without leading/trailing context must sit at the file's start/end.
 */
export const APPLY_MIN_CONTEXT = 3;

/**
 * The patch bytes for selection `p` (selectionParams) over the file's diff `revs` (the argv between the flags and `--`:
 * [] = index → worktree), built for `direction` ('forward' applies to the old side, 'reverse' with `-R` to the new).
 * STALE_DIFF / SELECTION_UNSUPPORTED from buildSelectionPatch.
 */
export async function readSelectionPatch(git, p, { revs = [], direction }) {
  // Whitespace is never ignored here: the hunks must be the file's real changes.
  const read = (context) => git([...DIFF_CONFIG, 'diff', ...DIFF_FLAGS, contextArg(context), ...revs, '--', p.path], { maxOutputBytes: DIFF_LIMITS.fileMaxOutputBytes })
    .then((r) => r.stdout.toString('latin1'));
  // The request is checked against the diff at its own context; the patch is built from one with enough context.
  const shown = await read(p.context);
  const applyContext = p.context === 'full' ? 'full' : Math.max(p.context, APPLY_MIN_CONTEXT);
  return Buffer.from(buildSelectionPatch(shown, p.hunks, direction, applyContext === p.context ? shown : await read(applyContext)), 'latin1');
}
