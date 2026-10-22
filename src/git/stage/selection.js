import { Refusal } from '../../refusals.js';
import { parseFilePatch } from '../parse/diff.js';

// Builds the patch that stages, unstages or discards a selection of one file's lines (docs/protocol.md → Stage
// selection). Pure: the op reads the diff and applies the result. The diff is a latin1 string (one character per byte),
// so the rebuilt patch is byte-exact; the request carries the UTF-8 text the UI was shown.

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const NO_NEWLINE = '\\ No newline at end of file';
const utf8 = new TextDecoder('utf-8', { fatal: false });
/** A latin1 string as the UI saw it: its bytes decoded as UTF-8, invalid bytes replaced. */
export const asShown = (s) => utf8.decode(Buffer.from(s, 'latin1'));

/** Header lines that make a file whole-file only: added, deleted, renamed, copied, conflicted, binary. */
const WHOLE_FILE = ['new file mode ', 'deleted file mode ', 'rename from ', 'copy from ', 'diff --cc ', 'diff --combined ', 'Binary files ', 'GIT binary patch'];
const GITLINK = '160000';

/** The lines before the first hunk; refuses PARTIAL_UNSUPPORTED for a file only whole-file actions can handle. */
function fileHeader(text) {
  const ls = text.split('\n');
  const end = ls.findIndex((l) => HUNK_RE.test(l));
  const header = end === -1 ? ls.filter((l) => l !== '') : ls.slice(0, end);
  const why = header.find((l) => WHOLE_FILE.some((m) => l.startsWith(m)) || (/^(?:old mode|new mode|index) /.test(l) && l.split(' ').includes(GITLINK)));
  if (why !== undefined || end === -1) {
    throw new Refusal('PARTIAL_UNSUPPORTED', 'only a modified text file can be staged by hunk or line: use the whole-file action');
  }
  return header;
}

/** The selected (hunk index → set of line indices) in the fresh diff, or STALE_DIFF when the request does not match it. */
function locate(hunks, request) {
  const stale = (why) => new Refusal('STALE_DIFF', `the file changed since its diff was shown (${why}): reload it and select again`);
  const selected = new Map();
  for (const rh of request) {
    const hi = hunks.findIndex((h) => asShown(h.header) === rh.header);
    if (hi === -1) throw stale(`hunk ${rh.header} is gone`);
    const lines = hunks[hi].lines;
    const set = new Set();
    for (const { index, text } of rh.lines) {
      const l = lines[index];
      if (!l) throw stale(`line ${index} of ${rh.header} is gone`);
      if (l.kind === 'context') throw stale(`line ${index} of ${rh.header} is not a change`);
      if (asShown(l.text) !== text) throw stale(`line ${index} of ${rh.header} differs`);
      set.add(index);
    }
    selected.set(hi, set);
  }
  return selected;
}

/**
 * The patch for `request` (`[{header, lines: [{index, text}]}]`) over `text`, one file's `git diff` output decoded as latin1.
 * `direction`:
 * - `forward` (stage: apply to the diff's old side): a selected −/+ is kept, an unselected − becomes context, an unselected + is dropped.
 * - `reverse` (unstage, discard: apply with -R to the diff's new side): a selected −/+ is kept, an unselected + becomes context, an unselected − is dropped.
 * The side the patch applies to keeps git's start and count; the other side's count is recomputed and its start shifted
 * by the hunks emitted before. Header lines are git's own `diff --git`, `---`, `+++`; `index` and mode lines are dropped,
 * so a mode change is never applied as a side effect. Returns the patch as a latin1 string.
 * Refuses PARTIAL_UNSUPPORTED, STALE_DIFF, and SELECTION_UNSUPPORTED when a "\ No newline" line would not end its side.
 */
export function buildSelectionPatch(text, request, direction) {
  const header = fileHeader(text).filter((l) => l.startsWith('diff --git ') || l.startsWith('--- ') || l.startsWith('+++ '));
  const { hunks } = parseFilePatch(text);
  if (!hunks.length) throw new Refusal('PARTIAL_UNSUPPORTED', 'the file has no text hunks: use the whole-file action');
  const selected = locate(hunks, request);
  const forward = direction === 'forward';
  const out = [...header];
  let delta = 0;
  hunks.forEach((h, hi) => {
    const sel = selected.get(hi);
    if (!sel) return;
    const body = blockLines(h.lines, sel, forward);
    const oldCount = body.filter((b) => b.mark !== '+').length;
    const newCount = body.filter((b) => b.mark !== '-').length;
    assertNoNewlineLast(body, h.header);
    // The fixed side keeps git's numbers; the other starts after the same lines, shifted by earlier hunks' growth.
    const [fixedStart, fixedCount, otherCount] = forward ? [h.oldStart, h.oldLines, newCount] : [h.newStart, h.newLines, oldCount];
    const before = (fixedCount ? fixedStart - 1 : fixedStart) + delta;
    const otherStart = otherCount ? before + 1 : before;
    delta += otherCount - fixedCount;
    const range = forward ? `-${fixedStart},${fixedCount} +${otherStart},${otherCount}` : `-${otherStart},${otherCount} +${fixedStart},${fixedCount}`;
    out.push(`@@ ${range} @@`);
    for (const b of body) {
      out.push(b.mark + b.text);
      if (b.noNewline) out.push(NO_NEWLINE);
    }
  });
  return `${out.join('\n')}\n`;
}

/**
 * One hunk's emitted lines `{mark, text, noNewline}`. Within a change block (a run of −/+ lines) the i-th removed line is
 * paired with the i-th added line, as the split view shows them, and each pair is emitted removed-then-added: so staging
 * `c → C` out of `-c -d +C +D` gives `C d`, not the `d C` that keeping git's line order would.
 */
function blockLines(lines, sel, forward) {
  const body = [];
  const emit = (i, mark) => body.push({ mark, text: lines[i].text, noNewline: lines[i].noNewline });
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'context') { emit(i++, ' '); continue; }
    const dels = [];
    const adds = [];
    for (; i < lines.length && lines[i].kind !== 'context'; i++) (lines[i].kind === 'del' ? dels : adds).push(i);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const d = dels[k];
      const a = adds[k];
      if (d !== undefined && (sel.has(d) || forward)) emit(d, sel.has(d) ? '-' : ' ');
      if (a !== undefined && (sel.has(a) || !forward)) emit(a, sel.has(a) ? '+' : ' ');
    }
  }
  return body;
}

/** A line git marked "\ No newline at end of file" must stay the last line of every side it is on (context = both). */
function assertNoNewlineLast(body, header) {
  const lastOf = (side) => body.findLastIndex((b) => b.mark === ' ' || b.mark === side);
  body.forEach((b, i) => {
    if (!b.noNewline) return;
    const sides = b.mark === ' ' ? ['-', '+'] : [b.mark];
    if (sides.some((s) => lastOf(s) !== i)) {
      throw new Refusal('SELECTION_UNSUPPORTED', `include the end-of-file newline change in ${header}: select the last removed and added lines together`);
    }
  });
}
