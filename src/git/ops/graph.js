import { maskUrls } from '../../mask.js';
import { Refusal } from '../../refusals.js';
import {
  parseCommitMeta, parseCommits, parseNameStatus, parseOids, parseRefs, parseRemotes, parseShortstats, parseStashes, parseWorktrees,
} from '../parse/graph.js';
import { assertOid, assertPath } from '../validate.js';

// The commit graph's reads (docs/protocol.md → graph.*). Pages address an explicit tip set sent on stdin, so a page
// never depends on where refs point when it runs (docs/graph.md → Snapshot).

export const PAGE_MAX = 1000;
export const TIPS_MAX = 10_000;
export const SEARCH_MAX = 1000;
export const STATS_MAX = 200;
export const QUERY_MAX = 200;

/**
 * On every log-family command: a configured log.showSignature would run gpg per commit and pollute the output;
 * diff.external and textconv drivers are programs.
 */
export const LOG_SAFE = ['--no-show-signature', '--no-ext-diff', '--no-textconv'];
const COMMIT_FORMAT = '--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s';
// %G? runs the repo's configured signing program (gpg.program / gpg.ssh.program) for this one commit.
const META_FORMAT = '--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%G?%x00%GS%x00%GK%x00'
  + '%(trailers:key=Co-authored-by,valueonly,separator=%x1e)%x00%s%x00%b';

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const SHA_PREFIX_RE = /^[0-9a-f]{4,64}$/i;
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

function object(raw, keys, op) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal('BAD_PARAMS', `${op} params must be an object`);
  for (const k of Object.keys(raw)) if (!keys.includes(k)) throw new Refusal('BAD_PARAMS', `${op}: unknown param ${JSON.stringify(k)}`);
  return raw;
}
function int(v, name, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Refusal('BAD_PARAMS', `${name} must be an integer in ${min}..${max}`);
  return v;
}
function oids(v, name, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Refusal('BAD_PARAMS', `${name} must be an array of ${min}..${max} oids`);
  v.forEach(assertOid);
  return [...new Set(v)].sort();
}
const stdinOf = (list) => list.map((o) => `${o}\n`).join('');
const noParams = (raw, op) => {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) {
    throw new Refusal('BAD_PARAMS', `${op} takes no params`);
  }
  return {};
};

/** `log` limited to `tips`, at most `max` oids back plus whether there were more. */
async function logOids(git, tips, args, max) {
  const r = await git(['log', '--stdin', '--topo-order', ...LOG_SAFE, '--format=%H', `--max-count=${max + 1}`, ...args], { stdin: stdinOf(tips) });
  const list = parseOids(text(r));
  return { list: list.slice(0, max), truncated: list.length > max };
}

export const ops = [
  {
    name: 'graph.refs',
    kind: 'read',
    params: (raw) => noParams(raw, 'graph.refs'),
    async run(git) {
      const worktrees = git(['worktree', 'list', '--porcelain', '-z']).then(
        (r) => ({ worktrees: parseWorktrees(text(r)), worktreesError: null }),
        // git < 2.36 has no `worktree list -z`: worktree labels degrade, the rest of the graph does not.
        (e) => {
          if (e.code !== 'GIT_FAILED') throw e;
          return { worktrees: null, worktreesError: maskUrls(e.extra.stderr || e.message) };
        },
      );
      const [refsOut, remotesOut, headOid, headRef, stashOut, wt] = await Promise.all([
        git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(HEAD)%00%(symref)',
          'refs/heads', 'refs/remotes', 'refs/tags']),
        git(['remote']),
        git(['rev-parse', '--verify', '-q', 'HEAD'], { okExit: [0, 1] }),
        git(['symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] }),
        git(['stash', 'list', ...LOG_SAFE, '--format=%H%x00%P%x00%gd%x00%at%x00%s']),
        worktrees,
      ]);
      const oid = headOid.exitCode === 0 ? text(headOid).trim() || null : null;
      const branch = headRef.exitCode === 0 ? text(headRef).trim() || null : null;
      return {
        head: { oid, branch, detached: oid !== null && branch === null, unborn: oid === null && branch !== null },
        refs: parseRefs(text(refsOut), parseRemotes(text(remotesOut))),
        stashes: parseStashes(text(stashOut)),
        ...wt,
      };
    },
  },
  {
    name: 'graph.page',
    kind: 'read',
    params(raw) {
      const p = object(raw, ['tips', 'skip', 'limit'], 'graph.page');
      return { tips: oids(p.tips, 'tips', 0, TIPS_MAX), skip: int(p.skip, 'skip', 0, Number.MAX_SAFE_INTEGER), limit: int(p.limit, 'limit', 1, PAGE_MAX) };
    },
    async run(git, { tips, skip, limit }) {
      if (!tips.length) return { items: [], nextCursor: null };
      const r = await git(['log', '--stdin', '--topo-order', ...LOG_SAFE, COMMIT_FORMAT, `--skip=${skip}`, `--max-count=${limit + 1}`], { stdin: stdinOf(tips) });
      const items = parseCommits(text(r));
      return { items: items.slice(0, limit), nextCursor: items.length > limit ? skip + limit : null };
    },
  },
  {
    name: 'graph.stats',
    kind: 'read',
    params(raw) {
      const p = object(raw, ['oids'], 'graph.stats');
      return { oids: oids(p.oids, 'oids', 1, STATS_MAX) };
    },
    async run(git, { oids: list }) {
      const r = await git(['log', '--no-walk=unsorted', '--stdin', ...LOG_SAFE, '--root', '--format=%x00%H%x00%P', '--shortstat'], { stdin: stdinOf(list) });
      return { stats: parseShortstats(text(r)) };
    },
  },
  {
    name: 'graph.search',
    kind: 'read',
    params(raw) {
      const p = object(raw, ['mode', 'query', 'tips'], 'graph.search');
      if (p.mode !== 'commits' && p.mode !== 'path') throw new Refusal('BAD_PARAMS', "mode must be 'commits' or 'path'");
      if (typeof p.query !== 'string' || p.query === '' || p.query.length > QUERY_MAX) throw new Refusal('BAD_PARAMS', `query must be 1..${QUERY_MAX} characters`);
      // A newline would be a second grep pattern; no control character has a use in a search.
      if (hasControl(p.query)) throw new Refusal('BAD_PARAMS', 'query contains a control character');
      if (p.mode === 'path') assertPath(p.query);
      return { mode: p.mode, query: p.query, tips: oids(p.tips, 'tips', 0, TIPS_MAX) };
    },
    async run(git, { mode, query, tips }) {
      if (!tips.length) return { matches: [], truncated: false };
      const parts = [];
      if (mode === 'path') {
        parts.push(logOids(git, tips, ['--', query], SEARCH_MAX));
      } else {
        // The query is always inside one `--grep=`/`--author=` element: a pattern, never an option. -F: no regex.
        // --author runs on its own because git ANDs it with --grep.
        parts.push(logOids(git, tips, ['-i', '-F', `--grep=${query}`], SEARCH_MAX));
        parts.push(logOids(git, tips, ['-i', '-F', `--author=${query}`], SEARCH_MAX));
        if (SHA_PREFIX_RE.test(query)) parts.push(shaMatches(git, query.toLowerCase()));
      }
      const results = await Promise.all(parts);
      const all = [...new Set(results.flatMap((r) => r.list))];
      return { matches: all.slice(0, SEARCH_MAX), truncated: all.length > SEARCH_MAX || results.some((r) => r.truncated) };
    },
  },
  {
    name: 'graph.commit',
    kind: 'read',
    params(raw) {
      const p = object(raw, ['oid'], 'graph.commit');
      return { oid: assertOid(p.oid) };
    },
    async run(git, { oid }) {
      // `oid` is full hex (assertOid), so it cannot be read as an option: no `--end-of-options`, which needs git 2.24.
      const meta = parseCommitMeta(text(await git(['log', '-1', '--no-walk', ...LOG_SAFE, META_FORMAT, oid])));
      // A separate command, so a file list over the output cap still leaves the metadata.
      let files = null;
      let filesError = null;
      try {
        const r = await git(['diff-tree', '-r', '-z', '--no-commit-id', '--name-status', '-M', '--root', '--no-ext-diff', '--no-textconv',
          ...meta.parents.slice(0, 1), oid]);
        files = parseNameStatus(text(r));
      } catch (e) {
        if (!(e instanceof Refusal) || e.code === 'CANCELLED') throw e;
        filesError = { code: e.code, message: e.message, ...(e.extra.limitBytes ? { limitBytes: e.extra.limitBytes } : {}) };
      }
      return { ...meta, files, filesError };
    },
  },
];

/** Commits whose oid starts with `prefix` (any object type is a candidate; only commits are kept). */
async function shaMatches(git, prefix) {
  const cand = parseOids(text(await git(['rev-parse', `--disambiguate=${prefix}`], { okExit: [0, 128] })));
  if (!cand.length) return { list: [], truncated: false };
  const r = await git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], { stdin: stdinOf(cand) });
  const list = text(r).split('\n').map((l) => l.split(' ')).filter(([, type]) => type === 'commit').map(([o]) => o);
  return { list: list.slice(0, SEARCH_MAX), truncated: list.length > SEARCH_MAX };
}
