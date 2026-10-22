// Pure parsers for `git diff` output. Paths come from NUL-separated fields, never from a regex over a line;
// hunk bodies are consumed by their header counts, never by line prefix.

const RAW_META_RE = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/;
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
const ZERO_OID_RE = /^0+$/;
const GITLINK = '160000';

/**
 * `git diff --raw --numstat -z --no-abbrev` → DiffFile[] (without `oversized`, which the op adds). All raw records come
 * first, then the numstat records in the same order: the n-th numstat record belongs to the n-th raw record.
 * An unmerged path is listed twice (a `U` record, then an `M` one); only the `U` entry is kept.
 */
export function parseRawNumstat(out) {
  const f = out.split('\0');
  if (f.at(-1) === '') f.pop();
  let i = 0;
  const raw = [];
  while (i < f.length && RAW_META_RE.test(f[i])) {
    const [, m1, m2, o1, o2, status, score] = RAW_META_RE.exec(f[i]);
    const paired = status === 'R' || status === 'C';
    const p1 = f[i + 1];
    const p2 = paired ? f[i + 2] : undefined;
    if (p1 === undefined || (paired && p2 === undefined)) throw new Error('parseRawNumstat: truncated raw record');
    i += paired ? 3 : 2;
    raw.push({
      path: paired ? p2 : p1, oldPath: paired ? p1 : null, status,
      similarity: paired && score !== '' ? Number(score) : null,
      oldMode: m1 === '000000' ? null : m1, newMode: m2 === '000000' ? null : m2,
      oldOid: ZERO_OID_RE.test(o1) ? null : o1, newOid: ZERO_OID_RE.test(o2) ? null : o2,
      submodule: m1 === GITLINK || m2 === GITLINK,
    });
  }
  const stats = [];
  while (i < f.length) {
    const m = NUMSTAT_RE.exec(f[i]);
    if (!m) throw new Error('parseRawNumstat: malformed numstat record');
    // A rename's numstat record has an empty path field followed by the old and new paths.
    i += m[3] === '' ? 3 : 1;
    const binary = m[1] === '-' && m[2] === '-';
    stats.push({ binary, added: binary ? null : Number(m[1]), deleted: binary ? null : Number(m[2]) });
  }
  if (stats.length !== raw.length) throw new Error(`parseRawNumstat: ${raw.length} raw records but ${stats.length} numstat records`);
  const unmerged = new Set(raw.filter((r) => r.status === 'U').map((r) => r.path));
  return raw
    .map((r, n) => ({ ...r, ...stats[n] }))
    .filter((r) => r.status === 'U' || !unmerged.has(r.path))
    .map(({ path, oldPath, status, similarity, added, deleted, binary, submodule, oldMode, newMode, oldOid, newOid }) => (
      { path, oldPath, status, similarity, added, deleted, binary, submodule, oldMode, newMode, oldOid, newOid }
    ));
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const SUBPROJECT_RE = /^Subproject commit ([0-9a-f]+)(-dirty)?$/;

/**
 * One file's patch (the first file section of `text`) → {binary, unmerged, oldMode, newMode, submodule, hunks}.
 * A content line reading `diff --git`, `@@` or `--- ` inside a hunk stays content. A bare empty line inside a hunk is
 * a blank context line. A gitlink (mode 160000) yields `submodule` and no hunks. Empty `text` (no change) → no hunks.
 */
export function parseFilePatch(text) {
  const ls = text.split('\n');
  const out = { binary: false, unmerged: false, oldMode: null, newMode: null, submodule: null, hunks: [] };
  let i = 0;
  let started = false;
  // Header: up to the first hunk, or the next file section.
  for (; i < ls.length && !HUNK_RE.test(ls[i]); i++) {
    const l = ls[i];
    if (l.startsWith('diff ')) {
      if (started) return finish(out);
      started = true;
      if (l.startsWith('diff --cc ') || l.startsWith('diff --combined ')) out.unmerged = true;
    } else if (l.startsWith('old mode ') || l.startsWith('deleted file mode ')) out.oldMode = l.slice(l.lastIndexOf(' ') + 1);
    else if (l.startsWith('new mode ') || l.startsWith('new file mode ')) out.newMode = l.slice(l.lastIndexOf(' ') + 1);
    else if (l.startsWith('index ')) {
      const mode = l.split(' ')[2];
      if (mode) { out.oldMode ??= mode; out.newMode ??= mode; }
    } else if (l.startsWith('Binary files ') || l === 'GIT binary patch') out.binary = true;
  }
  if (out.unmerged) return finish(out);
  while (i < ls.length) {
    const l = ls[i];
    if (l.startsWith('diff ')) break;
    const m = HUNK_RE.exec(l);
    if (!m) { i++; continue; }
    const hunk = {
      header: l, oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]), lines: [],
    };
    let oldLeft = hunk.oldLines;
    let newLeft = hunk.newLines;
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    i++;
    while (oldLeft > 0 || newLeft > 0 || ls[i]?.startsWith('\\')) {
      if (i >= ls.length) throw new Error('parseFilePatch: hunk ends before its line counts');
      const line = ls[i++];
      const c = line[0];
      if (c === '\\') {
        const prev = hunk.lines.at(-1);
        if (prev) prev.noNewline = true;
        continue;
      }
      const body = line.slice(1);
      if ((c === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
        hunk.lines.push({ kind: 'context', text: body, oldNo: oldNo++, newNo: newNo++, noNewline: false });
        oldLeft--; newLeft--;
      } else if (c === '-' && oldLeft > 0) {
        hunk.lines.push({ kind: 'del', text: body, oldNo: oldNo++, newNo: null, noNewline: false });
        oldLeft--;
      } else if (c === '+' && newLeft > 0) {
        hunk.lines.push({ kind: 'add', text: body, oldNo: null, newNo: newNo++, noNewline: false });
        newLeft--;
      } else {
        throw new Error('parseFilePatch: a hunk line does not match its header counts');
      }
    }
    out.hunks.push(hunk);
  }
  return finish(out);
}

function finish(out) {
  if (out.oldMode !== GITLINK && out.newMode !== GITLINK) return out;
  // A gitlink: the "Subproject commit <oid>[-dirty]" lines are the two pointers, never a text hunk.
  const sub = { old: null, new: null, dirty: false };
  for (const l of out.hunks.flatMap((h) => h.lines)) {
    const m = SUBPROJECT_RE.exec(l.text);
    if (!m) continue;
    if (l.kind === 'del') sub.old = m[1];
    else {
      if (l.kind === 'add') sub.new = m[1];
      if (m[2]) sub.dirty = true;
    }
  }
  return { ...out, submodule: sub, hunks: [] };
}

const LFS_RE = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n(?:[a-z0-9.-]+ [^\n]*\n)*?oid sha256:([0-9a-f]{64})\n(?:[a-z0-9.-]+ [^\n]*\n)*?size (\d+)\n?$/;
const LFS_MAX_LINES = 16;

/** One side's lines of a hunk ('old' = context + deleted, 'new' = context + added). */
export const sideLines = (hunk, side) => hunk.lines.filter((l) => l.kind === 'context' || l.kind === (side === 'old' ? 'del' : 'add'));

/**
 * Git LFS pointers (spec v1) on either side: `{old, new}` of `{oid, size}` | null, or null when neither side is one.
 * A side counts only when the file's single hunk starts at its line 1 and holds the whole pointer.
 */
export function detectLfs(hunks) {
  if (hunks.length !== 1) return null;
  const [h] = hunks;
  const side = (s) => {
    const start = s === 'old' ? h.oldStart : h.newStart;
    const count = s === 'old' ? h.oldLines : h.newLines;
    if (start !== 1 || count === 0 || count > LFS_MAX_LINES) return null;
    const ls = sideLines(h, s);
    const m = LFS_RE.exec(ls.map((l) => `${l.text}\n`).join(''));
    return m ? { oid: m[1], size: Number(m[2]) } : null;
  };
  const lfs = { old: side('old'), new: side('new') };
  return lfs.old || lfs.new ? lfs : null;
}
