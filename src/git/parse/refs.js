import { parseRecords } from './graph.js';

// Parsers for the branch and head ops. Pure: each takes decoded git output (LC_ALL=C keeps the wording stable).

const TRACK_RE = /^(?:ahead (\d+))?(?:, )?(?:behind (\d+))?$/;

/**
 * `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:track,nobracket) refs/heads` →
 * {[ref]: {upstream, ahead, behind, gone}}. `upstream` null = none configured; `gone` = configured but its ref is missing.
 */
export function parseTracking(out) {
  const branches = {};
  for (const [ref, upstream, track] of parseRecords(out, 3)) {
    const gone = track === 'gone';
    const m = gone ? null : TRACK_RE.exec(track);
    branches[ref] = { upstream: upstream || null, ahead: Number(m?.[1] ?? 0), behind: Number(m?.[2] ?? 0), gone };
  }
  return branches;
}

const OVERWRITE_RE = /would be overwritten by|untracked working tree files would be/;

/**
 * The files git names after "… would be overwritten by checkout:" / "by merge:" / "untracked working tree files would be
 * overwritten…": the indented lines that follow (a tab from checkout and merge; two spaces from `stash apply --index`,
 * whose list ends with "Index was not unstashed."), the indent removed. [] when git said no such thing.
 */
export function parseConflictFiles(stderr) {
  const files = [];
  let inList = false;
  for (const line of stderr.split('\n')) {
    if (OVERWRITE_RE.test(line)) { inList = true; continue; }
    const m = inList && /^(?:\t| {2})(.+)$/.exec(line);
    if (m) { files.push(m[1]); continue; }
    inList = false;
  }
  return [...new Set(files)];
}
