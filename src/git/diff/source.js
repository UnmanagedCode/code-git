import { Refusal } from '../../refusals.js';
import { assertRev } from '../validate.js';
import { DIFF_LIMITS } from './limits.js';

// The diff source descriptor (docs/protocol.md → Diff sources): validation, resolution to a pinned pair of sides,
// and the argv fragments every diff command shares.

export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Before the subcommand: a repo's `diff.suppressBlankEmpty=true` would emit blank context lines as empty lines. */
export const DIFF_CONFIG = ['-c', 'diff.suppressBlankEmpty=false'];

/** On every diff command: neutralise the config that changes the text the parsers read (wiki: gotchas/diff-parsing). */
export const DIFF_FLAGS = [
  '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '-M', '--src-prefix=a/', '--dst-prefix=b/',
  '--inter-hunk-context=0', '--submodule=short',
];

/** format-patch: neutralise every `format.*` key that adds headers, trailers, numbering or a cover letter. */
export const FORMAT_PATCH_FLAGS = [
  '--no-signature', '--no-add-header', '--no-to', '--no-cc', '--no-cover-letter', '--no-numbered', '--no-thread',
  '--no-base', '--no-from', '--no-attach', '--no-notes', '--no-signoff', '--no-force-in-body-from',
];

export const WHITESPACE_FLAGS = { none: [], eol: ['--ignore-space-at-eol'], change: ['-b'], all: ['-w'] };

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const lines = (r) => text(r).split('\n').filter(Boolean);
const bad = (msg) => new Refusal('BAD_PARAMS', msg);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Refuses any key of `o` outside `allowed`. */
export function onlyKeys(o, allowed, what) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`${what}: unknown key ${JSON.stringify(k)}`);
}

/** A user-typed revision naming one commit: `assertRev`, plus no leading `^` and no `..` (code-git builds ranges itself). */
export function assertCommitish(s) {
  assertRev(s);
  if (s.startsWith('^') || s.includes('..')) throw new Refusal('BAD_REF', 'invalid revision: ranges and negations are not accepted');
  return s;
}

const KEYS = {
  commit: ['rev', 'parent'], unstaged: [], staged: [], compare: ['from', 'to', 'mode'], worktree: ['rev'],
  commits: ['oids', 'wip'], pair: ['old', 'new'],
};
const PAIRS = new Set(['tree>tree', 'tree>index', 'tree>worktree', 'index>worktree']);

function parseSide(raw, what) {
  if (!isObj(raw)) throw bad(`${what} must be an object`);
  if (raw.type === 'tree') {
    onlyKeys(raw, ['type', 'oid'], what);
    if (typeof raw.oid !== 'string' || !OID_RE.test(raw.oid)) throw bad(`${what}.oid must be a full object id`);
    return { type: 'tree', oid: raw.oid };
  }
  if (raw.type === 'index' || raw.type === 'worktree') {
    onlyKeys(raw, ['type'], what);
    return { type: raw.type };
  }
  throw bad(`${what}.type must be tree, index or worktree`);
}

/** Validates a DiffSource from the wire; returns a typed copy or throws BAD_PARAMS / BAD_REF. */
export function parseSource(raw) {
  if (!isObj(raw)) throw bad('source must be an object');
  const keys = KEYS[raw.kind];
  if (!keys || !Object.hasOwn(KEYS, raw.kind)) throw bad('source.kind is not a known kind');
  onlyKeys(raw, ['kind', ...keys], 'source');
  switch (raw.kind) {
    case 'commit': {
      if (raw.parent !== undefined && (!Number.isInteger(raw.parent) || raw.parent < 1)) throw bad('source.parent must be an integer ≥ 1');
      return { kind: 'commit', rev: assertCommitish(raw.rev), parent: raw.parent ?? 1 };
    }
    case 'unstaged':
    case 'staged':
      return { kind: raw.kind };
    case 'compare':
      if (raw.mode !== '..' && raw.mode !== '...') throw bad("source.mode must be '..' or '...'");
      return { kind: 'compare', from: assertCommitish(raw.from), to: assertCommitish(raw.to), mode: raw.mode };
    case 'worktree':
      return { kind: 'worktree', rev: assertCommitish(raw.rev) };
    case 'commits': {
      const { oids } = raw;
      if (!Array.isArray(oids) || !oids.length || oids.length > DIFF_LIMITS.maxCommits) throw bad(`source.oids must list 1…${DIFF_LIMITS.maxCommits} commits`);
      if (oids.some((o) => typeof o !== 'string' || !OID_RE.test(o))) throw bad('source.oids must be full object ids');
      if (new Set(oids).size !== oids.length) throw bad('source.oids has duplicates');
      if (raw.wip !== undefined && typeof raw.wip !== 'boolean') throw bad('source.wip must be a boolean');
      return { kind: 'commits', oids: [...oids], wip: raw.wip ?? false };
    }
    case 'pair': {
      const pair = { old: parseSide(raw.old, 'source.old'), new: parseSide(raw.new, 'source.new') };
      if (!PAIRS.has(`${pair.old.type}>${pair.new.type}`)) throw bad(`source: a ${pair.old.type} → ${pair.new.type} pair is not supported`);
      return { kind: 'pair', ...pair };
    }
  }
}

/** The argv between `diff <flags>` and `--`: options first, then `--end-of-options` and the revisions. */
export function pairArgs(pair) {
  const revs = (...oids) => ['--end-of-options', ...oids];
  const k = `${pair.old.type}>${pair.new.type}`;
  if (k === 'tree>tree') return { opts: [], revs: revs(pair.old.oid, pair.new.oid) };
  if (k === 'tree>index') return { opts: ['--cached'], revs: revs(pair.old.oid) };
  if (k === 'tree>worktree') return { opts: [], revs: revs(pair.old.oid) };
  if (k === 'index>worktree') return { opts: [], revs: [] };
  throw new Error(`pairArgs: unsupported pair ${k}`);
}

const tree = (oid) => ({ type: 'tree', oid });

/** The empty tree's id in this repo's hash (sha1 or sha256); `hash-object` without `-w` writes nothing. */
export async function emptyTree(git) {
  return lines(await git(['hash-object', '-t', 'tree', '--stdin'], { stdin: '' }))[0];
}

/** `rev`'s commit oid, or null when it does not resolve to a commit. */
async function commitOid(git, rev) {
  const r = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { okExit: [0, 1] });
  const m = r.exitCode === 0 && /^([0-9a-f]{40}|[0-9a-f]{64})\n$/.exec(text(r));
  return m ? m[1] : null;
}

/** A user-typed revision's commit oid, or REV_UNKNOWN. */
async function mustCommit(git, rev) {
  let oid;
  try {
    oid = await commitOid(git, rev);
  } catch (e) {
    // rev-parse --verify exits 128 for some revisions it cannot resolve (`HEAD@{999}` past the reflog): still the
    // user's revision, not a git failure. "not a git repository" stays a failure.
    if (e.code === 'GIT_FAILED' && e.extra.exitCode === 128 && !e.extra.stderr.includes('not a git repository')) {
      throw new Refusal('REV_UNKNOWN', `${rev} does not name a commit`, { detail: e.extra.stderr });
    }
    throw e;
  }
  if (!oid) throw new Refusal('REV_UNKNOWN', `${rev} does not name a commit`);
  return oid;
}

async function parentsOf(git, oid) {
  const [line] = lines(await git(['rev-list', '--parents', '--no-walk', '--end-of-options', oid]));
  return line.split(' ').slice(1);
}

async function resolveCommits(git, { oids, wip }) {
  // Every oid must be a commit in this repo: one batch check instead of one exec per oid.
  const types = lines(await git(['cat-file', '--batch-check=%(objecttype)'], { stdin: oids.map((o) => `${o}\n`).join('') }));
  const unknown = oids.filter((_, i) => types[i] !== 'commit');
  if (unknown.length) throw new Refusal('REV_UNKNOWN', `${unknown[0]} is not a commit in this repository`);
  const n = oids.length;
  const tips = lines(await git(['merge-base', '--independent', '--end-of-options', ...oids]));
  let chain = null;
  if (tips.length === 1) {
    const walked = lines(await git(['rev-list', '--first-parent', '--parents', `--max-count=${n}`, '--end-of-options', tips[0]])).map((l) => l.split(' '));
    const selected = new Set(oids);
    if (walked.length === n && walked.every(([o]) => selected.has(o))) chain = walked;
  }
  if (chain) {
    const oldest = chain.at(-1);
    let newSide = tree(chain[0][0]);
    if (wip) {
      const head = await commitOid(git, 'HEAD');
      if (head !== chain[0][0]) throw new Refusal('DIFF_NOT_CONTIGUOUS', 'work in progress can be added only to a selection whose newest commit is HEAD');
      newSide = { type: 'worktree' };
    }
    return {
      pair: { old: tree(oldest[1] ?? await emptyTree(git)), new: newSide },
      series: { oids: chain.map(([o]) => o), direct: false, wip, merges: chain.some((l) => l.length > 2) },
    };
  }
  if (n !== 2 || wip) throw new Refusal('DIFF_NOT_CONTIGUOUS', 'the selection is not a contiguous run of commits: select one run, or exactly two commits');
  // Two commits: older → newer. One is the other's ancestor (one tip), or they diverged (ordered by date).
  const [newer, older] = tips.length === 1
    ? [tips[0], oids.find((o) => o !== tips[0])]
    : lines(await git(['rev-list', '--no-walk=sorted', '--end-of-options', ...oids]));
  return { pair: { old: tree(older), new: tree(newer) }, series: { oids: [newer, older], direct: true, wip: false, merges: false } };
}

/**
 * Resolves a parsed source to pinned sides: `{pair, commit: {oid, parents} | null, mergeBase, series}`.
 * Refuses REV_UNKNOWN, NO_MERGE_BASE, DIFF_NOT_CONTIGUOUS, and BAD_PARAMS for a parent past the commit's parents.
 */
export async function resolveSource(git, src) {
  const out = { commit: null, mergeBase: null, series: null };
  switch (src.kind) {
    case 'pair':
      return { pair: { old: src.old, new: src.new }, ...out };
    case 'unstaged':
      return { pair: { old: { type: 'index' }, new: { type: 'worktree' } }, ...out };
    case 'staged': {
      // An unborn HEAD stages against the empty tree.
      const head = await commitOid(git, 'HEAD');
      return { pair: { old: tree(head ?? await emptyTree(git)), new: { type: 'index' } }, ...out };
    }
    case 'commit': {
      const oid = await mustCommit(git, src.rev);
      const parents = await parentsOf(git, oid);
      if (src.parent > Math.max(1, parents.length)) throw bad(`the commit has ${parents.length} parent(s), not ${src.parent}`);
      const old = parents[src.parent - 1] ?? await emptyTree(git);
      return { pair: { old: tree(old), new: tree(oid) }, ...out, commit: { oid, parents } };
    }
    case 'worktree':
      return { pair: { old: tree(await mustCommit(git, src.rev)), new: { type: 'worktree' } }, ...out };
    case 'compare': {
      const from = await mustCommit(git, src.from);
      const to = await mustCommit(git, src.to);
      if (src.mode === '..') return { pair: { old: tree(from), new: tree(to) }, ...out };
      const r = await git(['merge-base', '--end-of-options', from, to], { okExit: [0, 1] });
      if (r.exitCode === 1) throw new Refusal('NO_MERGE_BASE', `${src.from} and ${src.to} have no common ancestor`);
      const base = lines(r)[0];
      return { pair: { old: tree(base), new: tree(to) }, ...out, mergeBase: base };
    }
    case 'commits':
      return { ...out, ...await resolveCommits(git, src) };
  }
  throw new Error(`resolveSource: unknown kind ${src.kind}`);
}
