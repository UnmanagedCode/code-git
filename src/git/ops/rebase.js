import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { splitMessage } from '../commit/message.js';
import { optBool, paramsObject } from '../params.js';
import { assertCcHeadAck, ownHead } from '../refs/heads.js';
import { undoRecord } from '../refs/undo.js';
import { makeCarrier, signsCommits } from '../rebase/carrier.js';
import { buildTodo, messageText, renderTodo } from '../rebase/todo.js';
import { rebase } from '../remote/integrate.js';
import { assertClean, assertNoOperation } from '../sequence/guard.js';
import { REBASE_LIMITS, SEQUENCE_LIMITS } from '../sequence/limits.js';
import { assertGitAtLeast } from '../stash/version.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Rebasing this checkout's branch (docs/merge.md → Rebase, Interactive rebase): rebase.start replays `upstream..HEAD`
// onto a commit; rebase.plan lists commits for the editor; rebase.interactive runs the editor's rows. A rebase rewrites
// the branch: a code-conductor/* HEAD needs the acknowledgement (not a pick-mode run: it only adds).

const decoder = new TextDecoder('utf-8', { fatal: false });
/** `--empty` (what the interactive rebase pins) arrived in git 2.26. */
const REBASE_FLOOR = [2, 26];
/** The interactive rebase's sequence editor: it copies its stdin (the todo, on the exec's stdin) into git's todo file. */
const SEQUENCE_EDITOR = 'cat >';
const MODES = ['rebase', 'pick'];
const bad = (msg) => new Refusal('BAD_PARAMS', msg);
const tooMany = (count) => new Refusal('TOO_MANY_COMMITS', `${count} commits: one rebase takes at most ${REBASE_LIMITS.maxCommits}`, { count, max: REBASE_LIMITS.maxCommits });
const LOG_FORMAT = '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%B';

/** `log -z` records of LOG_FORMAT → the editor's commits. */
function parseCommits(out) {
  const f = out.split('\0');
  const commits = [];
  for (let i = 0; i + 5 < f.length; i += 6) {
    const [oid, parents, name, email, time, body] = f.slice(i, i + 6);
    commits.push({ oid, parents: parents ? parents.split(' ') : [], ...splitMessage(body), author: { name, email, time: Number(time) } });
  }
  return commits;
}

/** HAS_MERGES when any of `commits` has more than one parent. */
function assertNoMerges(commits) {
  const merges = commits.filter((c) => c.parents.length > 1);
  if (merges.length) throw new Refusal('HAS_MERGES', `${merges[0].oid.slice(0, 7)} is a merge commit: an interactive rebase takes none`);
}

/**
 * The editor's commits, oldest first: `oids` in the order given, or `base..head`. REV_UNKNOWN for a non-commit,
 * TOO_MANY_COMMITS past REBASE_LIMITS.maxCommits, HAS_MERGES for a merge commit among them.
 */
async function planOf(git, { base, head, oids }) {
  let r;
  if (oids) {
    const list = oids.map((o) => `${o}\n`).join('');
    const types = decoder.decode((await git(['cat-file', '--batch-check=%(objecttype)'], { stdin: list })).stdout).split('\n');
    const unknown = oids.find((_, i) => types[i] !== 'commit');
    if (unknown) throw new Refusal('REV_UNKNOWN', `${unknown} is not a commit in this repository`);
    r = await git(['log', '--no-walk=unsorted', '-z', '--no-show-signature', LOG_FORMAT, '--stdin'], { stdin: list });
  } else {
    for (const oid of [base, head]) if (await commitOid(git, oid) !== oid) throw new Refusal('REV_UNKNOWN', `${oid} is not a commit`);
    const count = Number(decoder.decode((await git(['rev-list', '--count', '--end-of-options', `${base}..${head}`])).stdout).trim());
    if (count > REBASE_LIMITS.maxCommits) throw tooMany(count);
    r = await git(['log', '-z', '--reverse', '--no-show-signature', LOG_FORMAT, '--end-of-options', `${base}..${head}`]);
  }
  const commits = parseCommits(decoder.decode(r.stdout));
  assertNoMerges(commits);
  return { commits };
}

/**
 * The gates every rebase start runs, in order, before git: a worktree, the git floor, nothing in progress, a born HEAD
 * still at `expect`, the cc acknowledgement (unless `ack` is false: a pick-mode run only adds), a clean tree, no merge
 * commit in `upstream..HEAD`. Resolves HEAD.
 */
async function rebaseGates(git, { expect, upstream, ccOwned, ack = true }) {
  await assertWorktree(git);
  await assertGitAtLeast(git, REBASE_FLOOR, 'rebase');
  await assertNoOperation(git);
  const own = await ownHead(git);
  if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit');
  if (own.oid !== expect) throw new Refusal('REF_MOVED', `HEAD is no longer at ${expect}`);
  if (ack) assertCcHeadAck(own, ccOwned);
  await assertClean(git);
  if (await commitOid(git, upstream) !== upstream) throw new Refusal('REV_UNKNOWN', `${upstream} is not a commit`);
  const merges = Number(decoder.decode((await git(['rev-list', '--merges', '--count', '--end-of-options', `${upstream}..${own.oid}`])).stdout).trim());
  if (merges > 0) throw new Refusal('HAS_MERGES', `${merges} merge ${merges === 1 ? 'commit' : 'commits'} in the range: a rebase would flatten them; rebase it with git`);
  return own;
}

/** A finished rebase's answer: upToDate when HEAD did not move, else done with the branch's move as its undo. */
async function rebaseResult(git, own, r) {
  if (r.outcome !== 'done') return { outcome: r.outcome, files: r.files, oid: (await ownHead(git)).oid, undo: undoRecord() };
  const now = await ownHead(git);
  if (now.oid === own.oid) return { outcome: 'upToDate', files: [], oid: now.oid, undo: undoRecord() };
  return {
    outcome: 'done', files: [], oid: now.oid,
    undo: undoRecord({
      refs: own.branch ? [{ ref: own.branch, old: own.oid, new: now.oid }] : [],
      head: { old: { branch: own.branch, oid: own.oid }, new: { branch: now.branch, oid: now.oid } },
    }),
  };
}

export const ops = [
  {
    name: 'rebase.start',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['onto', 'upstream', 'expect', 'ccOwned'], 'rebase.start');
      return { onto: assertOid(p.onto), upstream: assertOid(p.upstream), expect: assertOid(p.expect), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { onto, upstream, expect, ccOwned }) {
      const own = await rebaseGates(git, { expect, upstream, ccOwned });
      if (await commitOid(git, onto) !== onto) throw new Refusal('REV_UNKNOWN', `${onto} is not a commit`);
      const r = await rebase(git, [`--onto=${onto}`, '--end-of-options', upstream], { timeoutMs: SEQUENCE_LIMITS.timeoutMs });
      return rebaseResult(git, own, r);
    },
  },
  {
    name: 'rebase.plan',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['base', 'head', 'oids'], 'rebase.plan');
      if (p.oids !== undefined) {
        if (p.base !== undefined || p.head !== undefined) throw bad('give either {base, head} or {oids}');
        if (!Array.isArray(p.oids) || !p.oids.length) throw bad('oids must list at least one commit');
        if (p.oids.length > REBASE_LIMITS.maxCommits) throw tooMany(p.oids.length);
        const oids = p.oids.map(assertOid);
        if (new Set(oids).size !== oids.length) throw bad('oids has duplicates');
        return { oids };
      }
      return { base: assertOid(p.base), head: assertOid(p.head) };
    },
    run: (git, p) => planOf(git, p),
  },
  {
    name: 'rebase.interactive',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['mode', 'base', 'onto', 'expect', 'rows', 'ccOwned'], 'rebase.interactive');
      if (!MODES.includes(p.mode)) throw bad(`mode must be one of ${MODES.join(', ')}`);
      const base = assertOid(p.base);
      const onto = assertOid(p.onto);
      const expect = assertOid(p.expect);
      if (p.mode === 'pick' && (base !== expect || onto !== expect)) throw bad('pick mode replays onto HEAD: base, onto and expect must all be HEAD');
      if (!Array.isArray(p.rows)) throw bad('rows must be a list');
      if (p.rows.length > REBASE_LIMITS.maxCommits) throw tooMany(p.rows.length);
      const rows = p.rows.map((r, i) => {
        if (r === null || typeof r !== 'object' || Array.isArray(r)) throw bad(`row ${i + 1} must be {oid, action, message?}`);
        for (const k of Object.keys(r)) if (!['oid', 'action', 'message'].includes(k)) throw bad(`row ${i + 1}: unknown key ${JSON.stringify(k)}`);
        return { oid: assertOid(r.oid), action: r.action, message: r.message === undefined ? null : messageText(r.message, `row ${i + 1}`) };
      });
      if (new Set(rows.map((r) => r.oid)).size !== rows.length) throw bad('rows name a commit twice');
      const todo = buildTodo(rows);
      return { mode: p.mode, base, onto, expect, rows, todo, ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { mode, base, onto, expect, rows, todo, ccOwned }) {
      const own = await rebaseGates(git, { expect, upstream: base, ccOwned, ack: mode === 'rebase' });
      if (await commitOid(git, onto) !== onto) throw new Refusal('REV_UNKNOWN', `${onto} is not a commit`);
      if (mode === 'rebase') {
        // The rows are exactly the commits the rebase replays: each of base..HEAD once, nothing else.
        const range = decoder.decode((await git(['rev-list', '--end-of-options', `${base}..${expect}`])).stdout).split('\n').filter(Boolean);
        const asked = new Set(rows.map((r) => r.oid));
        if (range.length !== rows.length || range.some((o) => !asked.has(o))) throw bad(`rows must list each of the ${range.length} commits in base..HEAD exactly once`);
      } else {
        // Any commits, each a non-merge commit of this repository.
        await planOf(git, { oids: rows.map((r) => r.oid) });
      }
      const sign = todo.carriers.length ? await signsCommits(git) : false;
      const made = [];
      for (const c of todo.carriers) made.push(await makeCarrier(git, c.oid, c.message, { sign }));
      const r = await rebase(git, ['-i', '--empty=drop', `--onto=${onto}`, '--end-of-options', base], {
        env: { GIT_SEQUENCE_EDITOR: SEQUENCE_EDITOR }, stdin: renderTodo(todo.lines, made), timeoutMs: SEQUENCE_LIMITS.timeoutMs,
      });
      return rebaseResult(git, own, r);
    },
  },
];
