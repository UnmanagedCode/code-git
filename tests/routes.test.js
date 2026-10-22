import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { buildRegistry } from '../src/git/ops/index.js';
import { ops as repoOps } from '../src/git/ops/repo.js';
import { assertRev } from '../src/git/validate.js';
import { sse, startApp } from './_app.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

// Test-only ops beside C1's own: two writes (one opting into cancel) and a read taking a revision.
const commitOp = (over) => ({
  kind: 'write', params: () => ({}),
  async run(git) { await git(['commit', '--allow-empty', '-q', '-m', 'w']); return { done: true }; },
  ...over,
});
const TEST_OPS = buildRegistry([repoOps, [
  commitOp({ name: 'test.write' }),
  commitOp({ name: 'test.cancellableWrite', cancellable: true }),
  {
    // Two commands: the first finishes, the second is the one a test holds.
    name: 'test.twoStep', kind: 'read', params: () => ({}),
    async run(git) { await git(['rev-parse', 'HEAD']); await git(['status']); return { done: true }; },
  },
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
  const app = await startApp(t, { ops: TEST_OPS });
  return { repo, cc, ...app };
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
  assert.equal(body.entries.length, 2);
  assert.ok(body.entries[0].id < body.entries[1].id);
  assert.deepEqual(body.entries[1].target, { project: 'app', worktree: 'feat' });
  assert.ok(body.entries[0].argv.includes('--porcelain=v2'));
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
  const closed = live.status === 'running' ? (await stream.next((e) => e.data.id === entry.id && e.data.status !== 'running')).data : live;
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
    ? (await within(stream.next((e) => e.data.id === entry.id && e.data.status !== 'running'), 'the entry closing')).data : live;
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
