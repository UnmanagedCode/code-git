import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { createActivityLog } from '../src/activity/log.js';
import { buildRegistry } from '../src/git/ops/index.js';
import { ops as repoOps } from '../src/git/ops/repo.js';
import { assertRev } from '../src/git/validate.js';
import { sse, startApp } from './_app.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

/** Opened by a test while `test.gapWrite` waits between its two commands. */
let gate = Promise.resolve();

// Test-only ops beside C1's own: writes (one opting into cancel; multi-command ones for op runs) and a read taking a revision.
const commitOp = (over) => ({
  kind: 'write', params: () => ({}),
  async run(git) { await git(['commit', '--allow-empty', '-q', '-m', 'w']); return { done: true }; },
  ...over,
});
const TEST_OPS = buildRegistry([repoOps, [
  commitOp({ name: 'test.write' }),
  commitOp({ name: 'test.cancellableWrite', cancellable: true }),
  {
    name: 'test.twoWrites', kind: 'write', params: () => ({}),
    async run(git) { await git(['rev-parse', 'HEAD']); await git(['status']); return { done: true }; },
  },
  {
    // Between its commands no entry is running: the gap a watcher must not refresh in.
    name: 'test.gapWrite', kind: 'write', params: () => ({}),
    async run(git) { await git(['rev-parse', 'HEAD']); await gate; await git(['status']); return { done: true }; },
  },
  {
    name: 'test.writeFails', kind: 'write', params: () => ({}),
    async run(git) { await git(['rev-parse', 'HEAD']); await git(['rev-parse', '--verify', '--end-of-options', 'nope']); return { done: true }; },
  },
  {
    // The first command fails while the second waits for the project lock (as readHeads/ownHead do in branch ops).
    name: 'test.writeParallel', kind: 'write', params: () => ({}),
    async run(git) { await Promise.all([git(['rev-parse', '--verify', '--end-of-options', 'nope']), git(['status'])]); return { done: true }; },
  },
  {
    // Two commands: the first finishes, the second is the one a test holds.
    name: 'test.twoStep', kind: 'read', params: () => ({}),
    async run(git) { await git(['rev-parse', 'HEAD']); await git(['status']); return { done: true }; },
  },
  { name: 'test.target', kind: 'read', params: () => ({}), run: async (_git, _params, { target, journal }) => ({ target, journal: typeof journal?.state }) },
  {
    name: 'test.rev', kind: 'read',
    params: (raw) => ({ rev: assertRev(raw?.rev) }),
    async run(git, { rev }) { return (await git(['log', '-1', '--format=%H', '--end-of-options', rev])).stdout.toString().trim(); },
  },
]]);

async function world(t) {
  const repo = makeRepo(t);
  repo.commit({ 'a.txt': 'a\n' });
  const wt = repo.worktreeAdd(path.join(repo.root, 'wt'), 'feat');
  const plain = path.join(repo.root, 'plain');
  fs.mkdirSync(plain);
  const cc = await fakeCc({
    home: repo.home,
    projects: {
      app: { dir: repo.dir, workspace: 'Dev', isGitRepo: true, worktrees: { feat: wt.dir, held: wt.dir }, locked: ['held'] },
      plain: { dir: plain, isGitRepo: false },
      gone: { dir: '/x', systemUnreachable: 'provider down' },
      owned: { dir: '/y', gitRefusal: 'dubious ownership: git config --global --add safe.directory /y' },
      broken: { dir: '/z', degraded: 'unreadable project record' },
      box: { dir: repo.dir, system: 'docker', remoteId: 'cc-box', isGitRepo: true, unbornHead: true },
    },
  });
  t.after(() => cc.close());
  const activity = createActivityLog();
  const app = await startApp(t, { ops: TEST_OPS, activity });
  return { repo, cc, activity, ...app };
}

const APP = { project: 'app' };

/** `p`, or a failed assertion naming `what` once `ms` pass: a regression fails fast instead of hanging the test. */
function within(p, what, ms = 2000) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new assert.AssertionError({ message: `${what} did not happen within ${ms} ms` })), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

test('GET api/repos lists every cc project, unopenable ones included, with their reason fields', async (t) => {
  const { call } = await world(t);
  const { status, body } = await call('GET', '/api/repos');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.repos.map((r) => [r.project, r]));
  assert.deepEqual(Object.keys(by).sort(), ['app', 'box', 'broken', 'gone', 'owned', 'plain']);
  assert.equal(by.app.isGitRepo, true);
  assert.equal(by.app.workspace, 'Dev');
  assert.equal(by.plain.isGitRepo, false);
  assert.equal('isGitRepo' in by.gone, false, 'absent = cc could not look');
  assert.equal(by.gone.systemUnreachable, 'provider down');
  assert.match(by.owned.gitRefusal, /safe\.directory/);
  assert.equal(by.broken.degraded, 'unreadable project record');
  assert.deepEqual([by.box.system, by.box.remoteId, by.box.unbornHead], ['docker', 'cc-box', true]);
  assert.deepEqual([by.app.system, by.app.remoteId, by.app.unbornHead, by.app.systemUnreachable, by.app.gitRefusal, by.app.degraded],
    ['local', null, false, null, null, null]);
});

test('GET api/repos/:project/worktrees maps cc rows, locked included (absent in cc = false); an unknown project is 404; a bad name is 400', async (t) => {
  const { call, cc } = await world(t);
  const { status, body } = await call('GET', '/api/repos/app/worktrees');
  assert.equal(status, 200);
  assert.deepEqual(body, { worktrees: [
    { worktreeName: 'feat', branch: 'code-conductor/feat', baseBranch: 'main', locked: false },
    { worktreeName: 'held', branch: 'code-conductor/held', baseBranch: 'main', locked: true },
  ] });
  assert.equal((await call('GET', '/api/repos/nope/worktrees')).body.code, 'PROJECT_UNKNOWN');
  assert.equal((await call('GET', '/api/repos/nope/worktrees')).status, 404);
  const bad = await call('GET', '/api/repos/a%00b/worktrees');
  assert.deepEqual([bad.status, bad.body.code], [400, 'BAD_TARGET']);
  assert.equal(cc.state.execCalls.length, 0);
});

test('a .. project name is refused before cc is asked (it would normalise to another cc route)', async (t) => {
  const { url } = await world(t);
  // A WHATWG URL (fetch, or http.get given a URL) would normalise %2E%2E away client-side: send the path as written.
  const get = (p) => new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    http.get({ hostname, port, path: p }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  for (const p of ['/api/repos/%2E%2E/worktrees', '/api/repos/%2e%2e/worktrees', '/api/repos/%2E/worktrees']) {
    const r = await get(p);
    assert.deepEqual([r.status, r.body.code], [400, 'BAD_TARGET'], p);
  }
});

test('POST api/ops/repo.summary returns the summary for the main checkout and for a worktree', async (t) => {
  const { call } = await world(t);
  const main = await call('POST', '/api/ops/repo.summary', { target: APP });
  assert.equal(main.status, 200);
  assert.equal(main.body.ok, true);
  assert.equal(main.body.result.head.branch, 'main');
  const feat = await call('POST', '/api/ops/repo.summary', { target: { project: 'app', worktree: 'feat' } });
  assert.equal(feat.body.result.head.branch, 'feat');
});

test('ops refusals: 415 on non-JSON, 404 unknown op, 400 bad target or extra keys, 409 NOT_A_REPO — none reach exec except the last', async (t) => {
  const { call, cc } = await world(t);
  const text = await call('POST', '/api/ops/repo.summary', JSON.stringify({ target: APP }), { headers: { 'content-type': 'text/plain' } });
  assert.deepEqual([text.status, text.body.code], [415, 'UNSUPPORTED_MEDIA_TYPE']);
  const form = await call('POST', '/api/ops/repo.summary', 'target=x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  const unknown = await call('POST', '/api/ops/nope.op', { target: APP });
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'UNKNOWN_OP']);
  for (const target of [undefined, { project: 'app', system: 'local' }, { project: 'app', cwd: '/' }, { project: '' }]) {
    const r = await call('POST', '/api/ops/repo.summary', { target });
    assert.deepEqual([r.status, r.body.code], [400, 'BAD_TARGET'], JSON.stringify(target));
  }
  const extra = await call('POST', '/api/ops/repo.summary', { target: APP, argv: ['rm', '-rf', '/'] });
  assert.deepEqual([extra.status, extra.body.code], [400, 'BAD_PARAMS']);
  const params = await call('POST', '/api/ops/repo.summary', { target: APP, params: { x: 1 } });
  assert.deepEqual([params.status, params.body.code], [400, 'BAD_PARAMS']);
  const malformed = await call('POST', '/api/ops/repo.summary', '{bad');
  assert.deepEqual([malformed.status, malformed.body.code], [400, 'BAD_REQUEST']);
  assert.equal(cc.state.execCalls.length, 0);
  const notRepo = await call('POST', '/api/ops/repo.summary', { target: { project: 'plain' } });
  assert.deepEqual([notRepo.status, notRepo.body.code], [409, 'NOT_A_REPO']);
  assert.match(notRepo.body.detail, /not a git repository/);
});

test('an option-looking revision is refused before anything reaches exec', async (t) => {
  const { call, cc } = await world(t);
  const r = await call('POST', '/api/ops/test.rev', { target: APP, params: { rev: '--output=/tmp/x' } });
  assert.deepEqual([r.status, r.body.code], [400, 'BAD_REF']);
  assert.equal(cc.state.execCalls.length, 0);
  const ok = await call('POST', '/api/ops/test.rev', { target: APP, params: { rev: 'HEAD' } });
  assert.match(ok.body.result, /^[0-9a-f]{40}$/);
  assert.ok(cc.state.execCalls[0].argv.includes('--end-of-options'));
});

// Invariant: the ops route passes run() the validated target and the undo journal.
test("an op's run receives {target, journal} as its third argument: the validated target (worktree null for the main checkout) and the undo journal", async (t) => {
  const { call } = await world(t);
  const wt = await call('POST', '/api/ops/test.target', { target: { project: 'app', worktree: 'feat' } });
  assert.deepEqual(wt.body, { ok: true, result: { target: { project: 'app', worktree: 'feat' }, journal: 'function' } });
  const main = await call('POST', '/api/ops/test.target', { target: APP });
  assert.deepEqual(main.body.result, { target: { project: 'app', worktree: null }, journal: 'function' });
});

test('activity: GET lists entries newest last and SSE pushes running then closed entries', async (t) => {
  const { call, url } = await world(t);
  const stream = await sse(`${url}/api/activity/events`, t);
  assert.match(stream.res.headers.get('content-type'), /^text\/event-stream/);
  await call('POST', '/api/ops/repo.summary', { target: APP });
  const first = await stream.next();
  assert.equal(first.event, 'activity');
  assert.equal(first.data.status, 'running');
  assert.equal(first.data.op, 'repo.summary');
  const second = await stream.next();
  assert.deepEqual([second.data.id, second.data.status], [first.data.id, 'ok']);
  await call('POST', '/api/ops/repo.summary', { target: { project: 'app', worktree: 'feat' } });
  const { body } = await call('GET', '/api/activity');
  // Each summary is the bare check (`rev-parse --git-dir`, src/git/worktree.js) then `git status`: four entries, newest last.
  assert.equal(body.entries.length, 4);
  assert.ok(body.entries.every((e, i) => i === 0 || body.entries[i - 1].id < e.id));
  const statuses = body.entries.filter((e) => e.argv.includes('--porcelain=v2'));
  assert.equal(statuses.length, 2);
  assert.deepEqual(statuses[1].target, { project: 'app', worktree: 'feat' });
});

async function startHeld(t, w, name) {
  w.cc.state.execHook = () => 'hold';
  const controller = new AbortController();
  const response = w.call('POST', `/api/ops/${name}`, { target: APP }, { signal: controller.signal }).catch((e) => ({ aborted: e.name }));
  const held = await w.cc.nextHeld();
  w.cc.state.execHook = null;
  const { body } = await w.call('GET', '/api/activity');
  return { held, response, controller, entry: body.entries.at(-1) };
}

test('cancel a running read: the op answers CANCELLED, cc sees the disconnect, the entry ends cancelled', async (t) => {
  const w = await world(t);
  const { held, response, entry } = await startHeld(t, w, 'repo.summary');
  assert.equal(entry.cancellable, true);
  const c = await w.call('POST', `/api/activity/${entry.id}/cancel`, {});
  assert.deepEqual([c.status, c.body], [200, { ok: true }]);
  const r = await within(response, 'the op answering after cancel');
  assert.deepEqual([r.status, r.body.code], [409, 'CANCELLED']);
  await within(held.closed, 'cc seeing the disconnect');
  assert.equal(held.disconnected, true);
  const after = (await w.call('GET', '/api/activity')).body.entries.at(-1);
  assert.equal(after.status, 'cancelled');
  const again = await w.call('POST', `/api/activity/${entry.id}/cancel`, {});
  assert.deepEqual([again.status, again.body.code], [409, 'NOT_RUNNING']);
});

test('cancel refuses an unknown id (404) and needs a JSON request (415)', async (t) => {
  const w = await world(t);
  const unknown = await w.call('POST', '/api/activity/999/cancel', {});
  assert.deepEqual([unknown.status, unknown.body.code], [404, 'ACTIVITY_UNKNOWN']);
  const bare = await w.call('POST', '/api/activity/1/cancel');
  assert.equal(bare.status, 415);
});

test('a write is not cancellable: cancel is 409 NOT_CANCELLABLE, cc sees no disconnect, and the write completes ok', async (t) => {
  const w = await world(t);
  const before = w.repo.git('rev-parse', 'HEAD');
  const { held, response, entry } = await startHeld(t, w, 'test.write');
  assert.equal(entry.cancellable, false);
  const c = await w.call('POST', `/api/activity/${entry.id}/cancel`, {});
  assert.deepEqual([c.status, c.body.code], [409, 'NOT_CANCELLABLE']);
  held.release();
  const r = await within(response, 'the write answering after release');
  assert.deepEqual([r.status, r.body], [200, { ok: true, result: { done: true } }]);
  assert.equal(held.disconnected, false);
  assert.notEqual(w.repo.git('rev-parse', 'HEAD'), before);
  assert.equal((await w.call('GET', '/api/activity')).body.entries.at(-1).status, 'ok');
});

test('a browser that goes away does not abort a write: it runs to completion and is logged ok', async (t) => {
  const w = await world(t);
  const before = w.repo.git('rev-parse', 'HEAD');
  const { held, response, controller, entry } = await startHeld(t, w, 'test.write');
  controller.abort();
  assert.deepEqual(await response, { aborted: 'AbortError' });
  held.release();
  // The write's command finishes after its HTTP client left: wait for its entry to close.
  const stream = await sse(`${w.url}/api/activity/events`, t);
  const live = (await w.call('GET', '/api/activity')).body.entries.at(-1);
  const closed = live.status === 'running' ? (await stream.next((e) => e.event === 'activity' && e.data.id === entry.id && e.data.status !== 'running')).data : live;
  assert.equal(closed.status, 'ok');
  assert.equal(held.disconnected, false);
  assert.notEqual(w.repo.git('rev-parse', 'HEAD'), before);
});

test('a browser that goes away aborts a cancellable op; its entry ends cancelled', async (t) => {
  const w = await world(t);
  const { held, controller, entry } = await startHeld(t, w, 'repo.summary');
  const stream = await sse(`${w.url}/api/activity/events`, t);
  controller.abort();
  await within(held.closed, 'cc seeing the disconnect');
  assert.equal(held.disconnected, true);
  const live = (await w.call('GET', '/api/activity')).body.entries.find((e) => e.id === entry.id);
  const closed = live.status === 'running'
    ? (await within(stream.next((e) => e.event === 'activity' && e.data.id === entry.id && e.data.status !== 'running'), 'the entry closing')).data : live;
  assert.equal(closed.status, 'cancelled');
});

test('a multi-command op is cancelled only through its running entry; a finished entry of it answers NOT_RUNNING', async (t) => {
  const w = await world(t);
  w.cc.state.execHook = (body) => (body.argv.includes('status') ? 'hold' : undefined);
  const response = w.call('POST', '/api/ops/test.twoStep', { target: APP });
  const held = await w.cc.nextHeld();
  w.cc.state.execHook = null;
  const [first, second] = (await w.call('GET', '/api/activity')).body.entries;
  assert.equal(first.opRunId, second.opRunId);
  assert.deepEqual([first.status, second.status], ['ok', 'running']);
  const stale = await w.call('POST', `/api/activity/${first.id}/cancel`, {});
  assert.deepEqual([stale.status, stale.body.code], [409, 'NOT_RUNNING']);
  assert.equal(held.disconnected, false);
  assert.equal((await w.call('POST', `/api/activity/${second.id}/cancel`, {})).status, 200);
  const r = await within(response, 'the op answering after cancel');
  assert.deepEqual([r.status, r.body.code], [409, 'CANCELLED']);
  await within(held.closed, 'cc seeing the disconnect');
  assert.equal(held.disconnected, true);
});

test('a write that opts into cancel is cancelled', async (t) => {
  const w = await world(t);
  const { held, response, entry } = await startHeld(t, w, 'test.cancellableWrite');
  assert.equal(entry.cancellable, true);
  assert.equal((await w.call('POST', `/api/activity/${entry.id}/cancel`, {})).status, 200);
  assert.equal((await within(response, 'the op answering after cancel')).body.code, 'CANCELLED');
  await within(held.closed, 'cc seeing the disconnect');
  assert.equal(held.disconnected, true);
});

test('an unknown API path is a JSON 404, never the UI', async (t) => {
  const { call } = await world(t);
  const r = await call('GET', '/api/nope');
  assert.deepEqual([r.status, r.body.code], [404, 'NOT_FOUND']);
});

test('cc answering without a usable body is 503 CONDUCTOR_UNAVAILABLE, never a crash', async (t) => {
  const w = await world(t);
  const prev = process.env.CONDUCTOR_URL;
  process.env.CONDUCTOR_URL = `${w.cc.url}/not-cc`; // the fake answers 404 '{}' there
  t.after(() => { process.env.CONDUCTOR_URL = prev; });
  for (const p of ['/api/repos', '/api/repos/app/worktrees']) {
    const r = await w.call('GET', p);
    assert.deepEqual([r.status, r.body.code], [503, 'CONDUCTOR_UNAVAILABLE'], p);
  }
  const op = await w.call('POST', '/api/ops/repo.summary', { target: APP });
  assert.deepEqual([op.status, op.body.code], [503, 'CONDUCTOR_UNAVAILABLE']);
});

// Write op runs (docs/protocol.md → Activity): the bracket a client waits on before reading a settled repo.

/** Every `activity` and `run` event the log emits from now on, in emission order, as {type, data}. */
function record(activity) {
  const events = [];
  activity.events.on('activity', (data) => events.push({ type: 'activity', data }));
  activity.events.on('run', (data) => events.push({ type: 'run', data }));
  return events;
}

/** Resolves the first run matching `pred` once it is ended (already, or later). */
function runEnded(activity, pred) {
  return new Promise((resolve) => {
    const done = activity.listRuns().find((r) => pred(r) && r.status === 'ended');
    if (done) { resolve(done); return; }
    const on = (r) => { if (pred(r) && r.status === 'ended') { activity.events.off('run', on); resolve(r); } };
    activity.events.on('run', on);
  });
}

/** Resolves the next `name` event of `activity` matching `pred`. */
const nextEvent = (activity, name, pred) => new Promise((resolve) => {
  const on = (e) => { if (pred(e)) { activity.events.off(name, on); resolve(e); } };
  activity.events.on(name, on);
});

const runOf = async (w, op) => (await w.call('GET', '/api/activity')).body.runs.filter((r) => r.op === op);

// Invariant: a write run's `ended` comes after every one of its entries closed, and is emitted exactly once.
test('a multi-command write emits run running before its first entry opens and run ended exactly once after its last entry closes', async (t) => {
  const w = await world(t);
  const events = record(w.activity);
  const r = await w.call('POST', '/api/ops/test.twoWrites', { target: APP });
  assert.equal(r.status, 200);
  const ended = await within(runEnded(w.activity, (x) => x.op === 'test.twoWrites'), 'the run ending');
  const mine = events.filter((e) => e.data.opRunId === ended.opRunId).map((e) => `${e.type}:${e.data.status}`);
  assert.deepEqual(mine, ['run:running', 'activity:running', 'activity:ok', 'activity:running', 'activity:ok', 'run:ended']);
  await w.call('POST', '/api/ops/test.write', { target: APP });
  await within(runEnded(w.activity, (x) => x.op === 'test.write'), 'the next run ending');
  assert.equal(events.filter((e) => e.type === 'run' && e.data.opRunId === ended.opRunId && e.data.status === 'ended').length, 1);
});

// Invariant: between two commands of a write (no entry running) the run still reads running.
test('between two commands of a write, GET api/activity shows its run running though none of its entries is', async (t) => {
  const w = await world(t);
  let open;
  gate = new Promise((r) => { open = r; });
  t.after(() => open());
  const firstClosed = nextEvent(w.activity, 'activity', (e) => e.op === 'test.gapWrite' && e.status !== 'running');
  const response = w.call('POST', '/api/ops/test.gapWrite', { target: APP });
  await within(firstClosed, 'the first command closing');
  const { body } = await w.call('GET', '/api/activity');
  const entries = body.entries.filter((e) => e.op === 'test.gapWrite');
  assert.deepEqual(entries.map((e) => e.status), ['ok']);
  assert.deepEqual(body.runs.filter((r) => r.op === 'test.gapWrite').map((r) => [r.status, r.opRunId]), [['running', entries[0].opRunId]]);
  open();
  assert.equal((await within(response, 'the write answering')).status, 200);
  assert.equal((await within(runEnded(w.activity, (x) => x.op === 'test.gapWrite'), 'the run ending')).opRunId, entries[0].opRunId);
});

// Invariant: an op that throws, a refused preflight and a client disconnect all end the run (no stale running run).
test('a write that fails after its first command, one refused before any command, and one whose client left all end their run', async (t) => {
  const w = await world(t);
  const fails = await w.call('POST', '/api/ops/test.writeFails', { target: APP });
  assert.equal(fails.body.code, 'GIT_FAILED');
  await within(runEnded(w.activity, (x) => x.op === 'test.writeFails'), 'the failed run ending');

  const before = w.repo.git('rev-parse', 'HEAD');
  const refused = await w.call('POST', '/api/ops/test.write', { target: { project: 'app', sub: ['nope'] } });
  assert.equal(refused.status >= 400, true, JSON.stringify(refused.body));
  assert.equal(w.repo.git('rev-parse', 'HEAD'), before);
  const [refusedRun] = await runOf(w, 'test.write');
  assert.deepEqual([refusedRun.status, refusedRun.target], ['ended', { project: 'app', worktree: null, sub: ['nope'] }]);

  const { held, response, controller } = await startHeld(t, w, 'test.cancellableWrite');
  controller.abort();
  assert.deepEqual(await response, { aborted: 'AbortError' });
  await within(held.closed, 'cc seeing the disconnect');
  await within(runEnded(w.activity, (x) => x.op === 'test.cancellableWrite'), 'the cancelled run ending');

  const left = await startHeld(t, w, 'test.twoWrites');
  left.controller.abort();
  assert.deepEqual(await left.response, { aborted: 'AbortError' });
  assert.deepEqual((await runOf(w, 'test.twoWrites')).map((r) => r.status), ['running'], 'a write runs on after its client left');
  left.held.release();
  await within(runEnded(w.activity, (x) => x.op === 'test.twoWrites'), 'the abandoned run ending');
});

// Invariant: ended waits for every git call of the run, including one still queued on the project lock when the op
// already failed.
test('a write whose Promise.all rejects fast stays running until its sibling, queued on the lock then held, settles', async (t) => {
  const w = await world(t);
  w.cc.state.execHook = (b) => (b.argv.includes('status') ? 'hold' : undefined);
  const r = await w.call('POST', '/api/ops/test.writeParallel', { target: APP });
  assert.equal(r.body.code, 'GIT_FAILED');
  assert.deepEqual((await runOf(w, 'test.writeParallel')).map((x) => x.status), ['running'], 'the op answered, its sibling has not settled');
  const held = await within(w.cc.nextHeld(), 'the queued sibling reaching cc');
  w.cc.state.execHook = null;
  assert.deepEqual((await runOf(w, 'test.writeParallel')).map((x) => x.status), ['running']);
  const events = record(w.activity);
  held.release();
  const ended = await within(runEnded(w.activity, (x) => x.op === 'test.writeParallel'), 'the run ending');
  const order = events.filter((e) => e.data.opRunId === ended.opRunId).map((e) => `${e.type}:${e.data.status}`);
  assert.deepEqual(order, ['activity:ok', 'run:ended']);
});

// Invariant: only writes open runs; two writes on one project each end on their own.
test('reads open no run; two concurrent writes on one project each end independently', async (t) => {
  const w = await world(t);
  await w.call('POST', '/api/ops/repo.summary', { target: APP });
  await w.call('POST', '/api/ops/test.twoStep', { target: APP });
  assert.deepEqual((await w.call('GET', '/api/activity')).body.runs, []);

  w.cc.state.execHook = () => 'hold';
  const r1 = w.call('POST', '/api/ops/test.write', { target: APP });
  const h1 = await w.cc.nextHeld();
  const secondOpen = nextEvent(w.activity, 'run', (x) => x.status === 'running');
  const r2 = w.call('POST', '/api/ops/test.write', { target: APP });
  const second = await within(secondOpen, 'the second run opening');
  assert.deepEqual((await runOf(w, 'test.write')).map((x) => x.status), ['running', 'running']);
  h1.release();
  assert.equal((await r1).status, 200);
  const first = await within(runEnded(w.activity, (x) => x.opRunId !== second.opRunId), 'the first run ending');
  const h2 = await w.cc.nextHeld();
  w.cc.state.execHook = null;
  assert.deepEqual((await runOf(w, 'test.write')).map((x) => [x.opRunId, x.status]), [[first.opRunId, 'ended'], [second.opRunId, 'running']]);
  h2.release();
  assert.equal((await r2).status, 200);
  await within(runEnded(w.activity, (x) => x.opRunId === second.opRunId), 'the second run ending');
});

// Invariant: the wire contract — SSE `event: run` on open and on end, and GET's `{entries, runs}`.
test('SSE delivers event: run when a write run opens and when it ends; GET api/activity answers {entries, runs}', async (t) => {
  const w = await world(t);
  const stream = await sse(`${w.url}/api/activity/events`, t);
  await w.call('POST', '/api/ops/test.write', { target: APP });
  const open = await within(stream.next((e) => e.event === 'run'), 'event: run (open)');
  assert.deepEqual([open.data.op, open.data.kind, open.data.status, open.data.target], ['test.write', 'write', 'running', { project: 'app', worktree: null }]);
  const end = await within(stream.next((e) => e.event === 'run'), 'event: run (end)');
  assert.deepEqual([end.data.id, end.data.opRunId, end.data.status], [open.data.id, open.data.opRunId, 'ended']);
  const { body } = await w.call('GET', '/api/activity');
  assert.deepEqual(Object.keys(body).sort(), ['entries', 'runs']);
  assert.deepEqual(body.runs.map((r) => [r.opRunId, r.status]), [[open.data.opRunId, 'ended']]);
  assert.ok(body.entries.every((e) => e.opRunId === open.data.opRunId));
});

// Invariant: a closed event stream unsubscribes both its listeners, `run` included.
test('closing the event stream removes its activity and run listeners', async (t) => {
  const w = await world(t);
  const before = { activity: w.activity.events.listenerCount('activity'), run: w.activity.events.listenerCount('run') };
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`${w.url}/api/activity/events`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.deepEqual([w.activity.events.listenerCount('activity'), w.activity.events.listenerCount('run')], [before.activity + 1, before.run + 1]);
  controller.abort();
  // The server sees the close asynchronously: wait for the activity listener (removed in the same stop()) to go.
  await within((async () => { while (w.activity.events.listenerCount('activity') > before.activity) await new Promise((r) => setImmediate(r)); })(), 'the stream closing');
  assert.equal(w.activity.events.listenerCount('run'), before.run);
});
