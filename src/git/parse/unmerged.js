// `git ls-files -u -z` → the conflicted paths and their stages. Pure: NUL-separated records, each
// `<mode> SP <oid> SP <stage> TAB <path>`; the path is everything after the tab (it may hold spaces or newlines).

/** The conflict's shape by the stages present (1 base, 2 ours, 3 theirs). */
const KIND = {
  123: 'bothModified', 23: 'bothAdded', 12: 'deletedByThem', 13: 'deletedByUs', 2: 'addedByUs', 3: 'addedByThem', 1: 'bothDeleted',
};
const SIDE = { 1: 'base', 2: 'ours', 3: 'theirs' };
const RECORD_RE = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([123])\t([\s\S]+)$/;

/**
 * → [{path, kind, base, ours, theirs}] in git's order, each side `{mode, oid}` or null when that stage is absent.
 * A record that does not parse is skipped (git's own output always does).
 */
export function parseUnmerged(out) {
  const byPath = new Map();
  for (const rec of out.split('\0')) {
    const m = RECORD_RE.exec(rec);
    if (!m) continue;
    const [, mode, oid, stage, path] = m;
    if (!byPath.has(path)) byPath.set(path, { path, base: null, ours: null, theirs: null });
    byPath.get(path)[SIDE[stage]] = { mode, oid };
  }
  return [...byPath.values()].map((c) => {
    const key = `${c.base ? 1 : ''}${c.ours ? 2 : ''}${c.theirs ? 3 : ''}`;
    return { path: c.path, kind: KIND[key], base: c.base, ours: c.ours, theirs: c.theirs };
  });
}
