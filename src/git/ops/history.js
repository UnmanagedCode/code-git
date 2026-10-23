import { Refusal } from '../../refusals.js';
import { commitOid, emptyTree } from '../diff/source.js';
import { HISTORY_LIMITS } from '../history/limits.js';
import { paramsObject } from '../params.js';
import { parseBlame, parseFileHistory, parseReflog } from '../parse/history.js';
import { fullRef } from '../refs/check.js';
import { assertOid, assertPath } from '../validate.js';
import { LOG_SAFE } from './graph.js';

// File history, blame, the reflog and a commit's paths (docs/history.md). All reads. A history or blame starts from a
// concrete commit the client froze (never HEAD), so its pages stay stable while refs move.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const FILE_FORMAT = '--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s';
const REFLOG_FORMAT = '--format=%H%x00%gd%x00%gs%x00%gn%x00%ge%x00%s';
const HEADS = 'refs/heads/';

function int(v, name, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Refusal('BAD_PARAMS', `${name} must be an integer in ${min}..${max}`);
  return v;
}

/** `oid` names a commit, else REV_UNKNOWN. */
async function assertCommit(git, oid) {
  if (await commitOid(git, oid) !== oid) throw new Refusal('REV_UNKNOWN', `${oid} is not a commit`);
}

/** `HEAD` or a full local branch name, else BAD_REF. */
function reflogRef(v) {
  if (v === 'HEAD') return v;
  return fullRef(v, [HEADS]);
}

export const ops = [
  {
    name: 'history.file',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['rev', 'path', 'skip', 'limit'], 'history.file');
      return {
        rev: assertOid(p.rev), path: assertPath(p.path),
        skip: int(p.skip ?? 0, 'skip', 0, HISTORY_LIMITS.followMaxCommits - 1), limit: int(p.limit ?? HISTORY_LIMITS.pageMax, 'limit', 1, HISTORY_LIMITS.pageMax),
      };
    },
    /**
     * The one exception to paging by git arguments: `--follow` with `--skip` skips commits of the unfiltered walk and
     * loses the rename, so each page re-walks from `rev` with `--max-count` (bounded by HISTORY_LIMITS.followMaxCommits)
     * and drops the first `skip` records.
     */
    async run(git, { rev, path, skip, limit }) {
      await assertCommit(git, rev);
      const want = skip + limit + 1;
      const walked = Math.min(want, HISTORY_LIMITS.followMaxCommits);
      const r = await git(['log', '--follow', '-M', '--name-status', '-z', ...LOG_SAFE, FILE_FORMAT, `--max-count=${walked}`, '--end-of-options', rev, '--', path],
        { maxOutputBytes: HISTORY_LIMITS.fileMaxOutputBytes });
      const all = parseFileHistory(text(r), path);
      const items = all.slice(skip, skip + limit);
      const more = all.length > skip + limit;
      // The walk stopped at the cap with every record used: whether older commits exist is not known.
      const truncated = !more && walked < want && all.length === walked;
      return { items, nextCursor: more ? skip + limit : null, truncated };
    },
  },
  {
    name: 'history.blame',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['rev', 'path', 'start', 'count'], 'history.blame');
      return {
        rev: assertOid(p.rev), path: assertPath(p.path),
        start: int(p.start ?? 1, 'start', 1, Number.MAX_SAFE_INTEGER), count: int(p.count ?? HISTORY_LIMITS.blameLinesMax, 'count', 1, HISTORY_LIMITS.blameLinesMax),
      };
    },
    async run(git, { rev, path, start, count }) {
      const type = await git(['cat-file', '-t', `${rev}:${path}`], { okExit: [0, 128] });
      if (type.exitCode !== 0 || text(type).trim() !== 'blob') throw new Refusal('PATH_NOT_IN_COMMIT', `${path} is not a file in ${rev.slice(0, 7)}`);
      const numstat = text(await git(['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', '--end-of-options', await emptyTree(git), rev, '--', path]));
      const added = numstat.split('\t')[0];
      if (added === '-') throw new Refusal('BINARY_FILE', `${path} is a binary file: it has no lines to blame`);
      const total = Number(added) || 0;
      if (start > total) return { total, lines: [], commits: {} };
      const n = Math.min(count, total - start + 1);
      // No --end-of-options: blame reads it as a revision; `rev` is a full oid. --no-ignore-revs-file drops the repo's
      // blame.ignoreRevsFile (`-c blame.ignoreRevsFile=` cannot: a missing file is opened first and blame dies).
      const r = await git(['blame', '--porcelain', '--no-textconv', '--no-ignore-revs-file', '-L', `${start},+${n}`, rev, '--', path],
        { maxOutputBytes: HISTORY_LIMITS.blameMaxOutputBytes });
      return { total, ...parseBlame(text(r)) };
    },
  },
  {
    name: 'history.reflog',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['ref', 'skip', 'limit'], 'history.reflog');
      return {
        ref: reflogRef(p.ref), skip: int(p.skip ?? 0, 'skip', 0, Number.MAX_SAFE_INTEGER),
        limit: int(p.limit ?? HISTORY_LIMITS.pageMax, 'limit', 1, HISTORY_LIMITS.pageMax),
      };
    },
    async run(git, { ref, skip, limit }) {
      const r = await git(['log', '-g', '-z', '--date=unix', ...LOG_SAFE, REFLOG_FORMAT, `--skip=${skip}`, `--max-count=${limit + 1}`, '--end-of-options', ref, '--'],
        { okExit: [0, 128], maxOutputBytes: HISTORY_LIMITS.reflogMaxOutputBytes });
      if (r.exitCode !== 0) {
        const stderr = decoder.decode(r.stderr);
        // No such ref (an unborn HEAD, a branch gone since): no reflog to show.
        if (/bad revision|unknown revision|ambiguous argument|does not have any commits/.test(stderr)) return { items: [], nextCursor: null };
        throw new Refusal('GIT_FAILED', `git log -g exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
      }
      const all = parseReflog(text(r), { ref: ref === 'HEAD' ? 'HEAD' : ref.slice(HEADS.length), skip });
      return { items: all.slice(0, limit), nextCursor: all.length > limit ? skip + limit : null };
    },
  },
  {
    name: 'history.paths',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['rev'], 'history.paths');
      return { rev: assertOid(p.rev) };
    },
    async run(git, { rev }) {
      await assertCommit(git, rev);
      const r = await git(['ls-tree', '-r', '-z', '--name-only', '--full-tree', '--end-of-options', rev], { maxOutputBytes: HISTORY_LIMITS.pathsMaxOutputBytes });
      return { paths: text(r).split('\0').filter(Boolean) };
    },
  },
];
