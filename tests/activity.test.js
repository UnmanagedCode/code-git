import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capStderr, createActivityLog } from '../src/activity/log.js';
import { BASE_ARGS, runGit } from '../src/git/runner.js';
import { ctxFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

const APP = { project: 'app', worktree: null };

async function world(t) {
  const repo = makeRepo(t);
  repo.commit({ 'a.txt': 'a\n' });
  const cc = await fakeCc({ projects: { app: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());
  return { repo, cc };
}

/** Runs `args` and returns [the promise's outcome, every event the log emitted]. */
async function runLogged(ctx, args, opts) {
  const events = [];
  ctx.activity.events.on('activity', (e) => events.push(e));
  const outcome = await runGit(ctx, args, opts).then((r) => ({ r }), (e) => ({ e }));
  return { ...outcome, events, entry: ctx.activity.list().at(-1) };
}

test('a successful command: running then ok, with argv, target, exit code and duration recorded exactly', async (t) => {
  await world(t);
  const ctx = ctxFor({ project: 'app', worktree: null }, 'read', { op: 'repo.summary', opRunId: 'run-9' });
  const { events, entry } = await runLogged(ctx, ['rev-parse', 'HEAD']);
  assert.deepEqual(events.map((e) => e.status), ['running', 'ok']);
  assert.equal(events[0].exitCode, null);
  assert.deepEqual(entry.argv, ['git', ...BASE_ARGS, 'rev-parse', 'HEAD']);
  assert.deepEqual(entry.target, { project: 'app', worktree: null });
  assert.equal(entry.op, 'repo.summary');
  assert.equal(entry.opRunId, 'run-9');
  assert.equal(entry.exitCode, 0);
  assert.equal(entry.code, null);
  assert.equal(typeof entry.durationMs, 'number');
  assert.equal(entry.stdinBytes, 0);
  assert.ok(!Number.isNaN(Date.parse(entry.startedAt)));
});

test("an entry records its op's kind, so a client can tell a finished write from a read", async (t) => {
  await world(t);
  const read = await runLogged(ctxFor(APP, 'read'), ['rev-parse', 'HEAD']);
  const write = await runLogged(ctxFor(APP, 'write'), ['rev-parse', 'HEAD']);
  assert.deepEqual(read.events.map((e) => e.kind), ['read', 'read']);
  assert.deepEqual(write.events.map((e) => e.kind), ['write', 'write']);
  assert.equal(read.entry.kind, 'read');
  assert.equal(write.entry.kind, 'write');
});

test('a non-zero exit closes the entry failed/GIT_FAILED with stderr', async (t) => {
  await world(t);
  const { e, entry } = await runLogged(ctxFor(APP), ['rev-parse', '--verify', 'nope']);
  assert.equal(e.code, 'GIT_FAILED');
  assert.equal(entry.status, 'failed');
  assert.equal(entry.code, 'GIT_FAILED');
  assert.equal(entry.exitCode, 128);
  assert.match(entry.stderr, /fatal/);
});

test('cc refusals close the entry as timeout or refused', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => ({ status: 504, body: { error: 'x', code: 'EXEC_TIMEOUT', stdout: '', stderr: Buffer.from('slow').toString('base64') } });
  const timedOut = await runLogged(ctxFor(APP), ['rev-parse', 'HEAD']);
  assert.equal(timedOut.entry.status, 'timeout');
  assert.equal(timedOut.entry.code, 'GIT_TIMEOUT');
  assert.equal(timedOut.entry.stderr, 'slow');
  cc.state.execHook = () => ({ status: 502, body: { error: 'x', code: 'SYSTEM_UNREACHABLE' } });
  const refused = await runLogged(ctxFor(APP), ['rev-parse', 'HEAD']);
  assert.equal(refused.entry.status, 'refused');
  assert.equal(refused.entry.code, 'SYSTEM_UNREACHABLE');
});

test('cancel aborts a running cancellable entry: cc sees the disconnect and the entry ends cancelled', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => 'hold';
  const ctx = ctxFor(APP, 'read');
  const p = runLogged(ctx, ['rev-parse', 'HEAD']);
  const held = await cc.nextHeld();
  const running = ctx.activity.list().at(-1);
  assert.equal(running.status, 'running');
  assert.equal(running.cancellable, true);
  ctx.activity.cancel(running.id);
  const { e, entry } = await p;
  assert.equal(e.code, 'CANCELLED');
  assert.equal(entry.status, 'cancelled');
  await held.closed;
  assert.equal(held.disconnected, true);
});

test('cancel refuses an unknown id, a non-cancellable entry (even while running) and a finished one', async (t) => {
  const { cc } = await world(t);
  const ctx = ctxFor(APP, 'write', { cancellable: false });
  assert.throws(() => ctx.activity.cancel(42), (e) => e.code === 'ACTIVITY_UNKNOWN');
  cc.state.execHook = () => 'hold';
  const p = runGit(ctx, ['rev-parse', 'HEAD']);
  const held = await cc.nextHeld();
  const entry = ctx.activity.list().at(-1);
  assert.equal(entry.cancellable, false);
  assert.throws(() => ctx.activity.cancel(entry.id), (e) => e.code === 'NOT_CANCELLABLE');
  held.release();
  await p;
  assert.throws(() => ctx.activity.cancel(entry.id), (e) => e.code === 'NOT_CANCELLABLE');
  assert.equal(held.disconnected, false);

  cc.state.execHook = null;
  const readCtx = ctxFor(APP, 'read');
  await runGit(readCtx, ['rev-parse', 'HEAD']);
  assert.throws(() => readCtx.activity.cancel(readCtx.activity.list()[0].id), (e) => e.code === 'NOT_RUNNING');
});

test("the op's signal aborting cancels the entry too", async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => 'hold';
  const controller = new AbortController();
  const ctx = ctxFor(APP, 'read', { signal: controller.signal });
  const p = runLogged(ctx, ['rev-parse', 'HEAD']);
  await cc.nextHeld();
  controller.abort();
  const { entry } = await p;
  assert.equal(entry.status, 'cancelled');
});

test('hook output reaches the entry: a pre-commit hook writing to stderr during a write', async (t) => {
  const { repo } = await world(t);
  repo.hook('pre-commit', '#!/bin/sh\necho "hook says <b>hi</b>" >&2\n');
  const { r, entry } = await runLogged(ctxFor(APP, 'write', { cancellable: false }), ['commit', '--allow-empty', '-m', 'x']);
  assert.equal(r.exitCode, 0);
  assert.match(entry.stderr, /hook says <b>hi<\/b>/);
  assert.equal(entry.cancellable, false);
});

test('stderr is capped to its tail and flagged truncated', async (t) => {
  const { repo } = await world(t);
  repo.hook('pre-commit', '#!/bin/sh\nhead -c 70000 /dev/zero | tr "\\0" x >&2\necho END >&2\n');
  const { entry } = await runLogged(ctxFor(APP, 'write'), ['commit', '--allow-empty', '-m', 'x']);
  assert.equal(entry.stderrTruncated, true);
  assert.equal(entry.stderr.length, 64 * 1024);
  assert.ok(entry.stderr.endsWith('END\n'));
  assert.deepEqual(capStderr(Buffer.from('short')), { stderr: 'short', stderrTruncated: false });
  assert.deepEqual(capStderr(Buffer.from('abcdef'), 4), { stderr: 'cdef', stderrTruncated: true });
  assert.deepEqual(capStderr(Buffer.from('abcd'), 4), { stderr: 'abcd', stderrTruncated: false });
  assert.equal(capStderr(Buffer.from([0xff, 0x41])).stderr, '�A', 'invalid UTF-8 is replaced, never thrown on');
});

test("only the op's own env is recorded, and secret-looking values are redacted", async (t) => {
  await world(t);
  const env = { GH_TOKEN: 't', MY_PASSWORD: 'p', API_KEY: 'k', CLIENT_SECRET: 's', PLAIN: 'v' };
  const { entry } = await runLogged(ctxFor(APP), ['rev-parse', 'HEAD'], { env, stdin: 'four' });
  assert.deepEqual(entry.env, { GH_TOKEN: '[redacted]', MY_PASSWORD: '[redacted]', API_KEY: '[redacted]', CLIENT_SECRET: '[redacted]', PLAIN: 'v' });
  assert.equal(entry.stdinBytes, 4);
  assert.equal(JSON.stringify(entry).includes('four'), false, 'stdin content is never recorded');
});

test('the ring keeps the newest entries, newest last; snapshots do not alias the log', () => {
  const log = createActivityLog({ ring: 3 });
  for (let i = 0; i < 5; i++) {
    const { entry } = log.open({ opRunId: 'r', op: 'x.y', target: { project: 'p' }, argv: ['git', String(i)], cancellable: true });
    log.close(entry, { status: 'ok', exitCode: 0 });
  }
  const list = log.list();
  assert.deepEqual(list.map((e) => e.argv[1]), ['2', '3', '4']);
  list[0].argv.push('mutated');
  list[0].target.project = 'q';
  assert.deepEqual(log.list()[0].argv, ['git', '2']);
  assert.equal(log.list()[0].target.project, 'p');
  assert.notEqual(log.newRunId(), log.newRunId());
});

test('a closed entry is not closed again', () => {
  const log = createActivityLog();
  const { entry } = log.open({ opRunId: 'r', op: 'x.y', target: { project: 'p' }, argv: ['git'], cancellable: true });
  log.close(entry, { status: 'ok', exitCode: 0 });
  log.close(entry, { status: 'failed', exitCode: 1 });
  assert.equal(log.list()[0].status, 'ok');
  assert.equal(log.list()[0].exitCode, 0);
});

// Write op runs: what `GET api/activity`'s `runs` and `event: run` report (docs/protocol.md → Activity).
const RUN = { opRunId: 'run-1', op: 'x.write', kind: 'write', target: { project: 'p', worktree: null } };
/** A log and every `run` event it emits. */
function runLog(opts) {
  const log = createActivityLog(opts);
  const events = [];
  log.events.on('run', (r) => events.push(r));
  return { log, events };
}
/** A promise and its resolve/reject, for a git call that settles when the test says. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Invariant: a run is announced running, then ended exactly once on end() when no git call of it is pending.
test('openRun records a running run and emits it; end() with nothing pending ends it once, a second end() is a no-op', () => {
  const { log, events } = runLog();
  const run = log.openRun(RUN);
  assert.deepEqual(events.map((r) => r.status), ['running']);
  const [listed] = log.listRuns();
  assert.deepEqual([listed.opRunId, listed.op, listed.kind, listed.target, listed.status, listed.endedAt],
    ['run-1', 'x.write', 'write', { project: 'p', worktree: null }, 'running', null]);
  assert.ok(!Number.isNaN(Date.parse(listed.startedAt)));
  run.end();
  run.end();
  assert.deepEqual(events.map((r) => r.status), ['running', 'ended']);
  assert.equal(events[1].id, events[0].id);
  assert.equal(log.listRuns()[0].status, 'ended');
  assert.ok(!Number.isNaN(Date.parse(log.listRuns()[0].endedAt)));
});

// Invariant: ended ⇒ every tracked git call of the run has settled (resolved or rejected), whatever the order.
test('end() while git calls are pending leaves the run running until the last one settles, rejected ones included', async () => {
  const { log, events } = runLog();
  const run = log.openRun(RUN);
  const a = deferred();
  const b = deferred();
  const ta = run.track(a.promise);
  const tb = run.track(b.promise);
  run.end();
  a.reject(new Error('fast failure'));
  await assert.rejects(ta, /fast failure/, 'track() passes the outcome through');
  assert.equal(log.listRuns()[0].status, 'running');
  b.resolve('done');
  assert.equal(await tb, 'done');
  assert.deepEqual(events.map((r) => r.status), ['running', 'ended']);
});

// Invariant: settling every call before end() does not end the run — only end() does.
test('a run whose calls all settled is still running until end()', async () => {
  const { log, events } = runLog();
  const run = log.openRun(RUN);
  await run.track(Promise.resolve(1));
  assert.equal(log.listRuns()[0].status, 'running');
  run.end();
  assert.deepEqual(events.map((r) => r.status), ['running', 'ended']);
});

// Invariant: runs live in a ring capped like entries; snapshots never alias the log.
test('the run ring keeps the newest runs, newest last; run snapshots do not alias the log', () => {
  const { log } = runLog({ ring: 2 });
  for (const id of ['a', 'b', 'c']) log.openRun({ ...RUN, opRunId: id }).end();
  const runs = log.listRuns();
  assert.deepEqual(runs.map((r) => r.opRunId), ['b', 'c']);
  assert.ok(runs[0].id < runs[1].id);
  runs[0].target.project = 'q';
  runs[0].status = 'running';
  assert.deepEqual([log.listRuns()[0].target.project, log.listRuns()[0].status], ['p', 'ended']);
});

// Invariant: the run ring never evicts a running run: it drops the oldest ended runs, exceeding the cap only by the
// runs still running, and trims back once they end.
test('the run ring never drops a running run: the oldest ended ones go first, the cap exceeded only by running runs', () => {
  const { log } = runLog({ ring: 3 });
  const held = log.openRun({ ...RUN, opRunId: 'held' });
  for (const id of ['a', 'b', 'c', 'd', 'e']) log.openRun({ ...RUN, opRunId: id }).end();
  assert.deepEqual(log.listRuns().map((r) => [r.opRunId, r.status]), [['held', 'running'], ['d', 'ended'], ['e', 'ended']]);

  const busy = runLog({ ring: 2 });
  const runs = ['x', 'y', 'z'].map((id) => busy.log.openRun({ ...RUN, opRunId: id }));
  assert.deepEqual(busy.log.listRuns().map((r) => r.opRunId), ['x', 'y', 'z'], 'every running run is kept');
  runs[1].end();
  assert.deepEqual(busy.log.listRuns().map((r) => [r.opRunId, r.status]), [['x', 'running'], ['z', 'running']]);
  held.end();
  assert.deepEqual(log.listRuns().map((r) => [r.opRunId, r.status]), [['held', 'ended'], ['d', 'ended'], ['e', 'ended']]);
});
