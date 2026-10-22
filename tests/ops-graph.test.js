import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { PAGE_MAX, SEARCH_MAX, STATS_MAX, TIPS_MAX } from '../src/git/ops/graph.js';
import {
  parseCommitMeta, parseCommits, parseNameStatus, parseRecords, parseRefs, parseShortstats, parseStashes, parseWorktrees, remoteOf,
} from '../src/git/parse/graph.js';
import { startApp } from './_app.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { buildGraphFixture } from './_graphFixture.js';
import { bareRemote, hermeticEnv, makeRepo } from './_git.js';

const APP = { project: 'app' };

async function world(t) {
  const repo = makeRepo(t);
  const cc = await fakeCc({ projects: { app: { dir: repo.dir } }, home: repo.home });
  // Form A only, never a shell: checked after every test.
  t.after(async () => {
    const v = cc.state.violations;
    await cc.close();
    assert.deepEqual(v, []);
  });
  return { repo, cc };
}

/** Runs op `name` with raw params on the app checkout; resolves {result, entries} (the op run's activity entries). */
async function run(name, raw, target = APP) {
  const op = getOp(OPS, name);
  const ctx = ctxFor(target, op.kind, { op: name });
  const result = await op.run(gitFor(ctx), op.params(raw));
  return { result, entries: ctx.activity.list() };
}
const reject = (name, raw, code) => assert.throws(() => getOp(OPS, name).params(raw), (e) => e.code === code, `${name} ${JSON.stringify(raw)?.slice(0, 80)}`);
/** An entry's argv after `git` and BASE_ARGS. */
const op = (e) => e.argv.slice(1 + BASE_ARGS.length);

/** main: A ← B ← M(B, F) ← D; side: B ← E ← F (merged into M); other: B ← G (unmerged). Returns the oids. */
function history(repo) {
  const A = repo.commit({ 'a.txt': 'a\n' }, 'A');
  const B = repo.commit({ 'b.txt': 'b\n' }, 'B');
  repo.branch('side');
  const E = repo.commit({ 'e.txt': 'e\n' }, 'E');
  const F = repo.commit({ 'f.txt': 'f\n' }, 'F');
  repo.checkout('main');
  repo.branch('other');
  const G = repo.commit({ 'g.txt': 'g\n' }, 'G');
  repo.checkout('main');
  repo.git('merge', '-q', '--no-ff', '-m', 'M', 'side');
  const M = repo.git('rev-parse', 'HEAD');
  const D = repo.commit({ 'd.txt': 'd\n' }, 'D');
  return { A, B, E, F, G, M, D };
}
const tipsOf = (repo, ...refs) => refs.map((r) => repo.git('rev-parse', r));

// ---------- graph.refs ----------

test('refs: local, remote (a remote named a/b), lightweight and annotated tags peeled, a tree tag has no oid, remote HEAD skipped, isHead', async (t) => {
  const { repo } = await world(t);
  const { A, B } = { A: repo.commit({ 'a.txt': 'a\n' }, 'A'), B: repo.commit({ 'b.txt': 'b\n' }, 'B') };
  repo.git('branch', 'side', A);
  bareRemote(repo);
  repo.git('push', '-q', 'origin', 'main');
  repo.git('remote', 'set-head', 'origin', 'main');
  repo.git('remote', 'add', 'a/b', path.join(repo.root, 'nowhere.git'));
  repo.git('update-ref', 'refs/remotes/a/b/feat', A);
  repo.git('tag', 'light', A);
  repo.git('tag', '-a', 'ann', '-m', 'annotated', B);
  repo.git('tag', 'tree', repo.git('rev-parse', 'HEAD^{tree}'));
  repo.git('tag', '-a', 'nested', '-m', 'tag of a tag', 'ann');
  const { result } = await run('graph.refs');
  const by = Object.fromEntries(result.refs.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(by).sort(), [
    'refs/heads/main', 'refs/heads/side', 'refs/remotes/a/b/feat', 'refs/remotes/origin/main',
    'refs/tags/ann', 'refs/tags/light', 'refs/tags/nested', 'refs/tags/tree',
  ]);
  assert.deepEqual(by['refs/heads/main'], { name: 'refs/heads/main', kind: 'local', short: 'main', remote: null, oid: B, isHead: true });
  assert.equal(by['refs/heads/side'].isHead, false);
  assert.deepEqual(by['refs/remotes/a/b/feat'], { name: 'refs/remotes/a/b/feat', kind: 'remote', short: 'a/b/feat', remote: 'a/b', oid: A, isHead: false });
  assert.equal(by['refs/remotes/origin/main'].remote, 'origin');
  assert.equal(by['refs/tags/light'].oid, A);
  assert.equal(by['refs/tags/ann'].oid, B);
  assert.equal(by['refs/tags/ann'].kind, 'tag');
  assert.equal(by['refs/tags/tree'].oid, null);
  // A tag of a tag: newer git peels %(*objectname) to the commit, older git one level (a tag, so no oid).
  assert.ok([B, null].includes(by['refs/tags/nested'].oid));
  assert.deepEqual(result.head, { oid: B, branch: 'refs/heads/main', detached: false, unborn: false });
});

test('refs: stashes newest first with their selector and parents; worktrees with locked and detached entries', async (t) => {
  const { repo } = await world(t);
  const A = repo.commit({ 'a.txt': 'a\n' }, 'A');
  repo.write('a.txt', 'one\n');
  repo.git('stash', 'push', '-q', '-m', 'first');
  repo.write('a.txt', 'two\n');
  repo.git('stash', 'push', '-q', '-m', 'second');
  const locked = repo.worktreeAdd(path.join(repo.root, 'wt-locked'), 'feat');
  repo.git('worktree', 'lock', locked.dir);
  const detached = path.join(repo.root, 'wt-detached');
  repo.git('worktree', 'add', '-q', '--detach', detached, A);
  const { result } = await run('graph.refs');
  assert.deepEqual(result.stashes.map((s) => [s.selector, s.subject, s.parents[0]]), [['stash@{0}', 'On main: second', A], ['stash@{1}', 'On main: first', A]]);
  assert.equal(result.stashes[0].oid, repo.git('rev-parse', 'stash@{0}'));
  assert.equal(typeof result.stashes[0].time, 'number');
  assert.equal(result.worktreesError, null);
  assert.deepEqual(result.worktrees, [
    { path: repo.dir, head: A, branch: 'refs/heads/main', detached: false, bare: false, locked: false },
    { path: detached, head: A, branch: null, detached: true, bare: false, locked: false },
    { path: locked.dir, head: A, branch: 'refs/heads/feat', detached: false, bare: false, locked: true },
  ]);
});

test('refs: an unborn repo has no refs and an unborn head; a detached HEAD has an oid and no branch', async (t) => {
  const { repo } = await world(t);
  const unborn = await run('graph.refs');
  assert.deepEqual(unborn.result.head, { oid: null, branch: 'refs/heads/main', detached: false, unborn: true });
  assert.deepEqual(unborn.result.refs, []);
  assert.deepEqual(unborn.result.stashes, []);
  const A = repo.commit({ 'a.txt': 'a\n' }, 'A');
  repo.commit({ 'a.txt': 'b\n' }, 'B');
  repo.git('checkout', '-q', '--detach', A);
  const { result } = await run('graph.refs');
  assert.deepEqual(result.head, { oid: A, branch: null, detached: true, unborn: false });
  assert.equal(result.refs.find((r) => r.short === 'main').isHead, false);
});

test('refs: a failing `worktree list -z` (git < 2.36) degrades to worktrees null with its stderr; the rest still loads', async (t) => {
  const { repo, cc } = await world(t);
  repo.commit({ 'a.txt': 'a\n' }, 'A');
  const stderr = "error: unknown switch `z'\n";
  cc.state.execHook = (body) => (body.argv.includes('worktree')
    ? { status: 200, body: { exitCode: 129, stdout: '', stderr: Buffer.from(stderr).toString('base64'), encoding: 'base64', durationMs: 1 } }
    : undefined);
  const { result, entries } = await run('graph.refs');
  assert.equal(result.worktrees, null);
  assert.equal(result.worktreesError, stderr);
  assert.equal(result.refs.length, 1);
  assert.equal(entries.find((e) => e.argv.includes('worktree')).status, 'failed');
});

test('refs: a failure other than worktree list fails the op', async (t) => {
  const { repo, cc } = await world(t);
  repo.commit({ 'a.txt': 'a\n' }, 'A');
  cc.state.execHook = (body) => (body.argv.includes('for-each-ref') ? { status: 502, body: { error: 'down', code: 'SYSTEM_UNREACHABLE' } } : undefined);
  await assert.rejects(run('graph.refs'), (e) => e.code === 'SYSTEM_UNREACHABLE');
});

test('refs takes no params', () => {
  for (const p of [undefined, null, {}]) assert.deepEqual(getOp(OPS, 'graph.refs').params(p), {});
  for (const p of [{ x: 1 }, [], 'x']) reject('graph.refs', p, 'BAD_PARAMS');
});

// ---------- graph.page ----------

test('page: every parent comes after its children (topo order) across merges', async (t) => {
  const { repo } = await world(t);
  const h = history(repo);
  const { result } = await run('graph.page', { tips: tipsOf(repo, 'main', 'other'), skip: 0, limit: 100 });
  const pos = new Map(result.items.map((c, i) => [c.oid, i]));
  assert.equal(result.items.length, 7);
  for (const c of result.items) for (const p of c.parents) assert.ok(pos.get(p) > pos.get(c.oid), `${c.subject} before its parent`);
  assert.ok([h.D, h.G].includes(result.items[0].oid), 'a tip comes first');
  const m = result.items.find((c) => c.oid === h.M);
  assert.deepEqual(m.parents, [h.B, h.F]);
  assert.deepEqual(m.author, { name: 'T', email: 't@example.com' });
  assert.equal(m.subject, 'M');
  assert.equal(m.time, Date.parse('2024-01-01T00:00:00Z') / 1000);
});

test('page: pages of 2 concatenate to the single large page; nextCursor is null exactly on the last page', async (t) => {
  const { repo } = await world(t);
  history(repo);
  const tips = tipsOf(repo, 'main', 'other');
  const whole = (await run('graph.page', { tips, skip: 0, limit: PAGE_MAX })).result;
  assert.equal(whole.nextCursor, null);
  const pages = [];
  let skip = 0;
  for (;;) {
    const { result } = await run('graph.page', { tips, skip, limit: 2 });
    pages.push(result);
    if (result.nextCursor === null) break;
    assert.equal(result.nextCursor, skip + 2);
    skip = result.nextCursor;
  }
  assert.deepEqual(pages.flatMap((p) => p.items), whole.items);
  assert.deepEqual(pages.map((p) => p.items.length), [2, 2, 2, 1]);
  const exact = (await run('graph.page', { tips, skip: 0, limit: 7 })).result;
  assert.equal(exact.nextCursor, null);
  assert.equal((await run('graph.page', { tips, skip: 0, limit: 6 })).result.nextCursor, 6);
});

test('page: tips go on stdin, never argv; the log never asks for a signature', async (t) => {
  const { repo } = await world(t);
  history(repo);
  const tips = tipsOf(repo, 'main', 'other');
  const { entries } = await run('graph.page', { tips: [...tips, tips[0]], skip: 3, limit: 2 });
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.equal(e.kind, 'read');
  assert.ok(e.argv.includes('--stdin'));
  assert.ok(e.argv.includes('--topo-order'));
  assert.ok(e.argv.includes('--skip=3') && e.argv.includes('--max-count=3'));
  for (const s of ['--no-show-signature', '--no-ext-diff', '--no-textconv']) assert.ok(e.argv.includes(s), s);
  for (const tip of tips) assert.ok(!e.argv.some((a) => a.includes(tip)), 'a tip on argv');
  assert.ok(!e.argv.some((a) => a.includes('%G')), 'a signature placeholder');
  assert.equal(e.stdinBytes, 2 * 41, 'tips deduplicated, one per line');
});

test('page: empty tips answer an empty page without running git', async (t) => {
  const { cc } = await world(t);
  const { result, entries } = await run('graph.page', { tips: [], skip: 0, limit: 10 });
  assert.deepEqual(result, { items: [], nextCursor: null });
  assert.equal(entries.length, 0);
  assert.equal(cc.state.execCalls.length, 0);
});

test('page: option-shaped, symbolic, short, uppercase or non-string tips, and bad skip/limit/keys, are refused', () => {
  const ok = 'a'.repeat(40);
  for (const tip of ['--all', '-n1', 'HEAD', 'main', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), `${ok}\n`, 7, null]) {
    reject('graph.page', { tips: [tip], skip: 0, limit: 1 }, 'BAD_REF');
  }
  assert.deepEqual(getOp(OPS, 'graph.page').params({ tips: ['b'.repeat(64), ok, ok], skip: 0, limit: 1 }).tips, [ok, 'b'.repeat(64)]);
  for (const p of [
    { tips: ok, skip: 0, limit: 1 }, { tips: [ok], skip: -1, limit: 1 }, { tips: [ok], skip: 1.5, limit: 1 }, { tips: [ok], skip: '0', limit: 1 },
    { tips: [ok], skip: 0, limit: 0 }, { tips: [ok], skip: 0, limit: PAGE_MAX + 1 }, { tips: [ok], skip: 0 }, { tips: [ok], skip: 0, limit: 1, all: true },
    { tips: Array(TIPS_MAX + 1).fill(ok), skip: 0, limit: 1 }, [], null, 'x',
  ]) reject('graph.page', p, 'BAD_PARAMS');
  assert.equal(getOp(OPS, 'graph.page').params({ tips: Array(TIPS_MAX).fill(ok), skip: 0, limit: PAGE_MAX }).tips.length, 1);
});

test('page: a refused param never reaches cc (through the route)', async (t) => {
  const { repo, cc } = await world(t);
  repo.commit({ 'a.txt': 'a\n' });
  const { call } = await startApp(t);
  for (const params of [{ tips: ['--all'], skip: 0, limit: 1 }, { tips: ['-n1'], skip: 0, limit: 1 }, { tips: 'x', skip: 0, limit: 1 }]) {
    const r = await call('POST', '/api/ops/graph.page', { target: APP, params });
    assert.equal(r.status, 400);
    assert.ok(['BAD_REF', 'BAD_PARAMS'].includes(r.body.code));
  }
  assert.equal(cc.state.execCalls.length, 0);
});

test('page: a unicode subject and one holding \\x1f round-trip', async (t) => {
  const { repo } = await world(t);
  const subjects = ['Ünïcödé — 日本語 🚀', 'unit\x1fsep and\ttab'];
  for (const s of subjects) repo.commit({}, s);
  const { result } = await run('graph.page', { tips: tipsOf(repo, 'main'), skip: 0, limit: 10 });
  assert.deepEqual(result.items.map((c) => c.subject).reverse(), subjects);
});

// ---------- graph.search ----------

/** Commits with chosen subjects (and authors) on main; returns subject → oid. */
function commitsNamed(repo, list) {
  const out = {};
  for (const [subject, author] of list) {
    const env = { ...hermeticEnv(repo.home), ...(author ? { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase().replace(/\s/g, '')}@x.org` } : {}) };
    execFileSync('git', ['-C', repo.dir, 'commit', '-q', '--allow-empty', '-m', subject], { env });
    out[subject] = repo.git('rev-parse', 'HEAD');
  }
  return out;
}
const search = async (repo, mode, query, tips = tipsOf(repo, 'main')) => (await run('graph.search', { mode, query, tips })).result;

test('search: fixed strings, case-insensitive message and author matches', async (t) => {
  const { repo } = await world(t);
  const c = commitsNamed(repo, [['fix a.b parser'], ['axb other'], ['paren ( here'], ['by zed', 'Zed Quux'], ['FIX upper']]);
  assert.deepEqual((await search(repo, 'commits', 'a.b')).matches, [c['fix a.b parser']]);
  assert.deepEqual((await search(repo, 'commits', 'A.B')).matches, [c['fix a.b parser']]);
  assert.deepEqual((await search(repo, 'commits', '(')).matches, [c['paren ( here']]);
  assert.deepEqual(new Set((await search(repo, 'commits', 'fix')).matches), new Set([c['fix a.b parser'], c['FIX upper']]));
  assert.deepEqual((await search(repo, 'commits', 'zed q')).matches, [c['by zed']]);
  assert.deepEqual((await search(repo, 'commits', 'nothing like it')), { matches: [], truncated: false });
});

test('search: option-shaped queries stay patterns: no file is written and results are correct', async (t) => {
  const { repo } = await world(t);
  const target = path.join(repo.root, 'pwned');
  const c = commitsNamed(repo, [[`try --output=${target} here`], ['the -n flag'], ['plain']]);
  const { result, entries } = await run('graph.search', { mode: 'commits', query: `--output=${target}`, tips: tipsOf(repo, 'main') });
  assert.deepEqual(result.matches, [c[`try --output=${target} here`]]);
  assert.ok(entries.some((e) => e.argv.includes(`--grep=--output=${target}`)));
  assert.ok(entries.some((e) => e.argv.includes(`--author=--output=${target}`)));
  assert.ok(!entries.some((e) => e.argv.includes(`--output=${target}`)));
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual((await search(repo, 'commits', '-n')).matches, [c['the -n flag']]);
});

test('search: a control character or a bad mode/length is refused; a path query must be a valid path', () => {
  const tips = ['a'.repeat(40)];
  for (const query of ['a\nb', 'a\x1fb', 'tab\there', 'del\x7f', '', 'x'.repeat(201), 3, null]) reject('graph.search', { mode: 'commits', query, tips }, 'BAD_PARAMS');
  reject('graph.search', { mode: 'regex', query: 'x', tips }, 'BAD_PARAMS');
  reject('graph.search', { mode: 'commits', query: 'x', tips, extra: 1 }, 'BAD_PARAMS');
  reject('graph.search', { mode: 'commits', query: 'x', tips: ['HEAD'] }, 'BAD_REF');
  for (const query of ['../etc', '/abs', 'a\\b']) reject('graph.search', { mode: 'path', query, tips }, 'BAD_PATH');
  assert.equal(getOp(OPS, 'graph.search').params({ mode: 'commits', query: 'x'.repeat(200), tips }).query.length, 200);
});

test('search: path mode is literal (a file named *.js is not a glob) and a path like -rf works', async (t) => {
  const { repo } = await world(t);
  const star = repo.commit({ '*.js': 'star\n' }, 'star');
  const a = repo.commit({ 'a.js': 'a\n' }, 'a');
  const rf = repo.commit({ '-rf': 'x\n' }, 'rf');
  assert.deepEqual((await search(repo, 'path', '*.js')).matches, [star]);
  assert.deepEqual((await search(repo, 'path', 'a.js')).matches, [a]);
  assert.deepEqual((await search(repo, 'path', '-rf')).matches, [rf]);
});

test('search: a sha prefix matches commits only; message matches are limited to commits reachable from the tips', async (t) => {
  const { repo } = await world(t);
  const A = repo.commit({ 'a.txt': 'unique blob content\n' }, 'A');
  repo.branch('side');
  const S = repo.commit({}, 'unique-side');
  repo.checkout('main');
  const blob = repo.git('rev-parse', 'HEAD:a.txt');
  assert.deepEqual((await search(repo, 'commits', A.slice(0, 7))).matches, [A]);
  assert.deepEqual((await search(repo, 'commits', A.slice(0, 7).toUpperCase())).matches, [A]);
  assert.ok(!(await search(repo, 'commits', blob.slice(0, 12))).matches.includes(blob));
  assert.deepEqual((await search(repo, 'commits', 'unique-side')).matches, []);
  assert.deepEqual((await search(repo, 'commits', 'unique-side', tipsOf(repo, 'side'))).matches, [S]);
});

test('search: over SEARCH_MAX matches answers SEARCH_MAX and truncated; empty tips run nothing; the log never asks for a signature', async (t) => {
  const { repo, cc } = await world(t);
  buildGraphFixture(repo.dir, repo.home, { commits: SEARCH_MAX + 20, branches: 0, merged: 0, tags: 0 });
  const r = await run('graph.search', { mode: 'commits', query: 'commit', tips: tipsOf(repo, 'main') });
  assert.equal(r.result.matches.length, SEARCH_MAX);
  assert.equal(r.result.truncated, true);
  const p = await run('graph.search', { mode: 'path', query: 'f1.txt', tips: tipsOf(repo, 'main') });
  assert.equal(p.result.truncated, false);
  for (const e of [...r.entries, ...p.entries]) {
    assert.ok(!e.argv.some((a) => a.includes('%G')), 'a signature placeholder');
    if (e.argv.includes('log')) for (const s of ['--stdin', '--no-show-signature', '--no-ext-diff', '--no-textconv']) assert.ok(e.argv.includes(s), s);
  }
  const before = cc.state.execCalls.length;
  assert.deepEqual((await run('graph.search', { mode: 'commits', query: 'x', tips: [] })).result, { matches: [], truncated: false });
  assert.equal(cc.state.execCalls.length, before);
});

// ---------- graph.stats ----------

test('stats: counts for a normal and a root commit, zeros for an empty commit, null for a merge', async (t) => {
  const { repo } = await world(t);
  const root = repo.commit({ 'a.txt': 'a\nb\n', 'b.txt': 'b\n' }, 'root');
  const mod = repo.commit({ 'a.txt': 'a\nc\nd\n' }, 'modify');
  const empty = repo.commit({}, 'empty');
  repo.branch('side', root);
  repo.commit({ 's.txt': 's\n' }, 'side');
  repo.checkout('main');
  repo.git('merge', '-q', '--no-ff', '-m', 'merge', 'side');
  const merge = repo.git('rev-parse', 'HEAD');
  const { result, entries } = await run('graph.stats', { oids: [root, mod, empty, merge] });
  assert.deepEqual(result.stats, {
    [root]: { files: 2, insertions: 3, deletions: 0 },
    [mod]: { files: 1, insertions: 2, deletions: 1 },
    [empty]: { files: 0, insertions: 0, deletions: 0 },
    [merge]: null,
  });
  assert.ok(!entries[0].argv.some((a) => a.includes('%G')));
});

test('stats: 1..STATS_MAX full oids', () => {
  const ok = 'c'.repeat(40);
  reject('graph.stats', { oids: [] }, 'BAD_PARAMS');
  reject('graph.stats', { oids: Array(STATS_MAX + 1).fill(ok) }, 'BAD_PARAMS');
  reject('graph.stats', { oids: ['HEAD'] }, 'BAD_REF');
  reject('graph.stats', { oids: [ok], x: 1 }, 'BAD_PARAMS');
  assert.equal(getOp(OPS, 'graph.stats').params({ oids: Array(STATS_MAX).fill(ok) }).oids.length, 1);
});

// ---------- graph.commit ----------

test('commit: subject, body with blank lines, co-authors, parents, author vs committer, unsigned is N, the file list', async (t) => {
  const { repo } = await world(t);
  const A = repo.commit({ 'keep.txt': '1\n', 'gone.txt': 'x\n', 'old name.txt': 'same content here\n' }, 'A');
  repo.git('rm', '-q', 'gone.txt');
  repo.git('mv', 'old name.txt', 'new name.txt');
  repo.write('keep.txt', '2\n');
  repo.write('added.txt', 'new\n');
  repo.git('add', '-A');
  const env = { ...hermeticEnv(repo.home), GIT_COMMITTER_NAME: 'Cee', GIT_COMMITTER_EMAIL: 'cee@x.org' };
  const msg = 'Subject line\n\nFirst paragraph.\n\n\nSecond <b>para</b>.\n\nCo-authored-by: Ann Example <ann@x.org>\nCo-authored-by: Bob <bob@x.org>\n';
  execFileSync('git', ['-C', repo.dir, 'commit', '-q', '--cleanup=verbatim', '-m', msg], { env });
  const B = repo.git('rev-parse', 'HEAD');
  const { result, entries } = await run('graph.commit', { oid: B });
  assert.equal(result.oid, B);
  assert.deepEqual(result.parents, [A]);
  assert.equal(result.subject, 'Subject line');
  assert.equal(result.body, 'First paragraph.\n\n\nSecond <b>para</b>.\n\nCo-authored-by: Ann Example <ann@x.org>\nCo-authored-by: Bob <bob@x.org>');
  assert.deepEqual(result.coAuthors, [{ name: 'Ann Example', email: 'ann@x.org' }, { name: 'Bob', email: 'bob@x.org' }]);
  assert.deepEqual(result.author, { name: 'T', email: 't@example.com', time: 1704067200 });
  assert.deepEqual(result.committer, { name: 'Cee', email: 'cee@x.org', time: 1704067200 });
  assert.deepEqual(result.signature, { status: 'N', signer: null, key: null });
  assert.deepEqual(result.files, [
    { status: 'A', path: 'added.txt', oldPath: null },
    { status: 'D', path: 'gone.txt', oldPath: null },
    { status: 'M', path: 'keep.txt', oldPath: null },
    { status: 'R', path: 'new name.txt', oldPath: 'old name.txt' },
  ]);
  assert.equal(result.filesError, null);
  assert.equal(entries.length, 2, 'metadata and the file list are separate commands');
  assert.ok(entries[0].argv.some((a) => a.includes('%G?')));
  assert.deepEqual(op(entries[1]).slice(-3), ['--end-of-options', A, B]);
});

test('commit: a merge is diffed against its first parent; a root commit lists its own files', async (t) => {
  const { repo } = await world(t);
  const root = repo.commit({ 'r1.txt': '1\n', 'r2.txt': '2\n' }, 'root');
  repo.branch('side');
  repo.commit({ 'side.txt': 's\n' }, 'side');
  repo.checkout('main');
  const main2 = repo.commit({ 'main.txt': 'm\n' }, 'main2');
  repo.git('merge', '-q', '--no-ff', '-m', 'merge', 'side');
  const merge = repo.git('rev-parse', 'HEAD');
  const m = (await run('graph.commit', { oid: merge })).result;
  assert.equal(m.parents[0], main2);
  assert.deepEqual(m.files, [{ status: 'A', path: 'side.txt', oldPath: null }]);
  const r = (await run('graph.commit', { oid: root })).result;
  assert.deepEqual(r.parents, []);
  assert.deepEqual(r.files.map((f) => [f.status, f.path]), [['A', 'r1.txt'], ['A', 'r2.txt']]);
});

test('commit: a file list over the output cap keeps the metadata and reports OUTPUT_TOO_LARGE instead of an empty list', async (t) => {
  const { repo, cc } = await world(t);
  repo.commit({ 'a.txt': 'a\n' }, 'A');
  const B = repo.commit({ 'b.txt': 'b\n' }, 'big change');
  cc.state.execHook = (body) => (body.argv.includes('diff-tree')
    ? { status: 422, body: { error: 'exec: output too large', code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: 33554432 } }
    : undefined);
  const { result, entries } = await run('graph.commit', { oid: B });
  assert.equal(result.subject, 'big change');
  assert.equal(result.files, null);
  assert.equal(result.filesError.code, 'OUTPUT_TOO_LARGE');
  assert.equal(result.filesError.limitBytes, 33554432);
  assert.deepEqual(entries.map((e) => e.status), ['ok', 'refused']);
});

test('commit: a cancelled file list cancels the op; an unknown commit fails it; only a full oid is accepted', async (t) => {
  const { repo, cc } = await world(t);
  const A = repo.commit({ 'a.txt': 'a\n' }, 'A');
  await assert.rejects(run('graph.commit', { oid: 'd'.repeat(40) }), (e) => e.code === 'GIT_FAILED');
  cc.state.execHook = (body) => (body.argv.includes('diff-tree') ? 'hold' : undefined);
  const op1 = getOp(OPS, 'graph.commit');
  const ctx = ctxFor(APP, 'read', { op: 'graph.commit' });
  const p = op1.run(gitFor(ctx), op1.params({ oid: A }));
  await cc.nextHeld();
  ctx.activity.cancel(ctx.activity.list().at(-1).id);
  await assert.rejects(p, (e) => e.code === 'CANCELLED');
  for (const oid of ['HEAD', '--all', A.slice(0, 7), A.toUpperCase(), undefined]) reject('graph.commit', { oid }, 'BAD_REF');
  reject('graph.commit', { oid: A, x: 1 }, 'BAD_PARAMS');
});

// ---------- parsers ----------

test('parseRecords: fields by NUL, the last by newline; a newline inside an earlier field does not split a record; a short record throws', () => {
  assert.deepEqual(parseRecords('a\0b\0c\nd\0e\0f\n', 3), [['a', 'b', 'c'], ['d', 'e', 'f']]);
  assert.deepEqual(parseRecords('a\nx\0b\0c\n', 3), [['a\nx', 'b', 'c']]);
  assert.deepEqual(parseRecords('', 3), []);
  assert.throws(() => parseRecords('a\0b\n', 3), (e) => e.code === 'INTERNAL');
  assert.throws(() => parseRecords('a\0b\0c\0d\n', 3), (e) => e.code === 'INTERNAL');
  assert.throws(() => parseCommits('abc\0\0name\n'), (e) => e.code === 'INTERNAL');
});

test('remoteOf: the longest remote name prefix wins; an unknown remote falls back to the first segment', () => {
  assert.equal(remoteOf('a/b/main', ['a', 'a/b']), 'a/b');
  assert.equal(remoteOf('a/main', ['a', 'a/b']), 'a');
  assert.equal(remoteOf('gone/x/y', ['origin']), 'gone');
  assert.equal(remoteOf('origin/main', ['origin', 'orig']), 'origin');
});

test('parseRefs skips refs outside heads/remotes/tags and remote symrefs; parseStashes splits parents', () => {
  const o = 'e'.repeat(40);
  const out = [
    `refs/heads/x\0${o}\0commit\0\0\0 \0`, `refs/remotes/origin/HEAD\0${o}\0commit\0\0\0 \0refs/remotes/origin/main`,
    `refs/notes/n\0${o}\0commit\0\0\0 \0`, `refs/tags/t\0${o}\0blob\0\0\0 \0`, '',
  ].join('\n');
  assert.deepEqual(parseRefs(out, []), [
    { name: 'refs/heads/x', kind: 'local', short: 'x', remote: null, oid: o, isHead: false },
    { name: 'refs/tags/t', kind: 'tag', short: 't', remote: null, oid: null, isHead: false },
  ]);
  assert.deepEqual(parseStashes(`${o}\0${o} ${o} ${o}\0stash@{0}\x00100\0WIP on x\n`), [{ oid: o, parents: [o, o, o], selector: 'stash@{0}', time: 100, subject: 'WIP on x' }]);
});

test('parseWorktrees: bare, prunable and a zero HEAD; an attribute before any worktree throws', () => {
  const out = 'worktree /r/bare\0bare\0\0worktree /r/a\0HEAD 0000000000000000000000000000000000000000\0branch refs/heads/u\0prunable gitdir gone\0\0';
  assert.deepEqual(parseWorktrees(out), [
    { path: '/r/bare', head: null, branch: null, detached: false, bare: true, locked: false },
    { path: '/r/a', head: null, branch: 'refs/heads/u', detached: false, bare: false, locked: false },
  ]);
  assert.deepEqual(parseWorktrees('worktree /p with space\0locked reason here\0'), [{ path: '/p with space', head: null, branch: null, detached: false, bare: false, locked: true }]);
  assert.throws(() => parseWorktrees('HEAD abc\0\0'), (e) => e.code === 'INTERNAL');
});

test('parseShortstats: insert-only, delete-only and a merge; output not starting with a record throws', () => {
  const a = '1'.repeat(40);
  const b = '2'.repeat(40);
  const m = '3'.repeat(40);
  const out = `\0${a}\0${b}\n\n 1 file changed, 4 insertions(+)\n\0${b}\0${m}\n\n 3 files changed, 2 deletions(-)\n\0${m}\0${a} ${b}\n`;
  assert.deepEqual(parseShortstats(out), {
    [a]: { files: 1, insertions: 4, deletions: 0 }, [b]: { files: 3, insertions: 0, deletions: 2 }, [m]: null,
  });
  assert.throws(() => parseShortstats(`junk\0${a}\0\n`), (e) => e.code === 'INTERNAL');
});

test('parseCommitMeta: a literal unsupported-trailers placeholder yields no co-authors; a short record throws', () => {
  const o = 'f'.repeat(40);
  const rec = (trailers, sig = 'G') => [o, '', 'A', 'a@x', '1', 'C', 'c@x', '2', sig, 'Signer <s@x>', 'KEY1', trailers, 'subj', 'body\0with nul\n\n'].join('\0');
  const m = parseCommitMeta(rec('(trailers:key=Co-authored-by,valueonly,separator=\x1e)'));
  assert.deepEqual(m.coAuthors, []);
  assert.deepEqual(m.signature, { status: 'G', signer: 'Signer <s@x>', key: 'KEY1' });
  assert.equal(m.body, 'body\0with nul');
  assert.deepEqual(parseCommitMeta(rec('Ann <a@x>\x1e  Bob B <b@x> ', '')).coAuthors, [{ name: 'Ann', email: 'a@x' }, { name: 'Bob B', email: 'b@x' }]);
  assert.equal(parseCommitMeta(rec('', '')).signature.status, 'N');
  assert.throws(() => parseCommitMeta('a\0b\0c'), (e) => e.code === 'INTERNAL');
});

test('parseNameStatus: copies carry an old path; a truncated record throws', () => {
  assert.deepEqual(parseNameStatus('C075\0a\0b\0T\0t\0'), [{ status: 'C', path: 'b', oldPath: 'a' }, { status: 'T', path: 't', oldPath: null }]);
  assert.deepEqual(parseNameStatus(''), []);
  assert.throws(() => parseNameStatus('R100\0a'), (e) => e.code === 'INTERNAL');
  assert.throws(() => parseNameStatus('M'), (e) => e.code === 'INTERNAL');
});

test('every graph op is a cancellable read', () => {
  for (const name of ['graph.refs', 'graph.page', 'graph.stats', 'graph.search', 'graph.commit']) {
    const o = OPS.get(name);
    assert.equal(o.kind, 'read', name);
    assert.equal(o.cancellable, true, name);
  }
});
