import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CC_EXEC_CAPS, exec } from '../src/conductor/exec.js';
import { LIMITS } from '../src/git/limits.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPTS = { timeoutMs: 5000, maxOutputBytes: 1 << 20 };

async function world(t) {
  const repo = makeRepo(t);
  repo.commit({ 'a.txt': 'a\n' });
  const wt = repo.worktreeAdd(path.join(repo.root, 'wt'), 'feat');
  const cc = await fakeCc({ projects: { app: { dir: repo.dir, worktrees: { feat: wt.dir } } }, home: repo.home });
  t.after(() => cc.close());
  return { repo, wt, cc };
}

const rejectsWith = (p, code, check = () => true) => assert.rejects(p, (e) => { assert.equal(e.code, code); return check(e); });

test('the request is exec form A with base64 encoding; worktree is omitted for the main checkout', async (t) => {
  const { cc, wt } = await world(t);
  const main = await exec({ project: 'app', worktree: null }, ['git', 'rev-parse', '--show-toplevel'], { ...OPTS, env: { A: '1' }, stdin: 'in' });
  const feat = await exec({ project: 'app', worktree: 'feat' }, ['git', 'rev-parse', '--show-toplevel'], OPTS);
  assert.equal(main.exitCode, 0);
  assert.ok(Buffer.isBuffer(main.stdout) && Buffer.isBuffer(main.stderr));
  assert.equal(feat.stdout.toString().trim(), wt.dir);
  assert.deepEqual(cc.state.execCalls[0], {
    project: 'app', argv: ['git', 'rev-parse', '--show-toplevel'], env: { A: '1' }, stdinB64: Buffer.from('in').toString('base64'),
    encoding: 'base64', timeoutMs: 5000, maxOutputBytes: 1 << 20,
  });
  assert.equal('worktree' in cc.state.execCalls[0], false);
  assert.equal(cc.state.execCalls[1].worktree, 'feat');
  assert.deepEqual(cc.state.violations, []);
});

test('a non-zero exit is a result, not a refusal', async (t) => {
  await world(t);
  const r = await exec({ project: 'app', worktree: null }, ['git', 'rev-parse', '--verify', 'nope'], OPTS);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr.toString(), /fatal/);
});

test('cc refusals map onto code-git refusals', async (t) => {
  const { cc } = await world(t);
  const target = { project: 'app', worktree: null };
  const answer = (status, body) => { cc.state.execHook = () => ({ status, body }); return exec(target, ['git', 'status'], OPTS); };
  await rejectsWith(answer(404, { error: 'x', code: 'PROJECT_UNKNOWN' }), 'PROJECT_UNKNOWN');
  await rejectsWith(answer(404, { error: 'x', code: 'WORKTREE_UNKNOWN' }), 'WORKTREE_UNKNOWN');
  for (const [status, code] of [[501, 'SYSTEMS_UNAVAILABLE'], [501, 'SYSTEM_NOT_REGISTERED'], [501, 'SYSTEM_NO_PROVIDER'], [501, 'SYSTEM_NO_REMOTES'],
    [502, 'SYSTEM_UNREACHABLE'], [502, 'REMOTE_NOT_FOUND']]) {
    await rejectsWith(answer(status, { error: 'x', code }), 'SYSTEM_UNREACHABLE', (e) => e.extra.detail === code);
  }
  await rejectsWith(answer(504, { error: 'x', code: 'EXEC_TIMEOUT', stdout: '', stderr: Buffer.from('partial').toString('base64') }),
    'GIT_TIMEOUT', (e) => e.extra.stderr === 'partial');
  await rejectsWith(answer(422, { error: 'x', code: 'EXEC_OUTPUT_TOO_LARGE', limitBytes: 99 }), 'OUTPUT_TOO_LARGE', (e) => e.extra.limitBytes === 99);
  await rejectsWith(answer(422, { error: 'x', code: 'EXEC_SPAWN_FAILED', errno: 'ENOENT' }), 'GIT_UNAVAILABLE', (e) => e.extra.errno === 'ENOENT');
  t.mock.method(console, 'error', () => {});
  await rejectsWith(answer(400, { error: 'x', code: 'INVALID_ARGUMENT' }), 'INTERNAL');
  await rejectsWith(answer(404, { error: 'not found' }), 'CONDUCTOR_UNAVAILABLE');
  cc.state.execHook = () => ({ status: 502, raw: '<html>bad gateway</html>' });
  await rejectsWith(exec(target, ['git', 'status'], OPTS), 'CONDUCTOR_UNAVAILABLE');
});

test('the fake enforces cc limits for real: the output cap and the timeout', async (t) => {
  const { repo } = await world(t);
  repo.commit({ 'big.txt': 'x'.repeat(10_000) });
  await rejectsWith(exec({ project: 'app', worktree: null }, ['git', 'show', 'HEAD:big.txt'], { timeoutMs: 5000, maxOutputBytes: 100 }), 'OUTPUT_TOO_LARGE');
  await rejectsWith(exec({ project: 'app', worktree: null }, ['sh', '-c', 'echo partial >&2; sleep 5'], { timeoutMs: 200, maxOutputBytes: 1000 }),
    'GIT_TIMEOUT', (e) => e.extra.stderr === 'partial\n');
  await rejectsWith(exec({ project: 'app', worktree: null }, ['no-such-binary-cg'], OPTS), 'GIT_UNAVAILABLE', (e) => e.extra.errno === 'ENOENT');
  await rejectsWith(exec({ project: 'app', worktree: 'nope' }, ['git', 'status'], OPTS), 'WORKTREE_UNKNOWN');
});

test('aborting the signal aborts the request, cc sees the disconnect, and the call rejects CANCELLED', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => 'hold';
  const controller = new AbortController();
  const p = exec({ project: 'app', worktree: null }, ['git', 'status'], { ...OPTS, signal: controller.signal });
  const held = await cc.nextHeld();
  controller.abort();
  await rejectsWith(p, 'CANCELLED');
  await held.closed;
  assert.equal(held.disconnected, true);
});

test('CONDUCTOR_URL unset → CONDUCTOR_UNAVAILABLE', async (t) => {
  const prev = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  t.after(() => { if (prev !== undefined) process.env.CONDUCTOR_URL = prev; });
  await rejectsWith(exec({ project: 'app', worktree: null }, ['git', 'status'], OPTS), 'CONDUCTOR_UNAVAILABLE');
});

test('a connection failure is retried only when retry is on', async (t) => {
  const { cc } = await world(t);
  let resets = 1;
  cc.state.execHook = () => (resets-- > 0 ? 'reset' : undefined);
  const r = await exec({ project: 'app', worktree: null }, ['git', 'status'], { ...OPTS, retry: true });
  assert.equal(r.exitCode, 0);
  assert.equal(cc.state.execCalls.length, 2);

  resets = 1;
  await rejectsWith(exec({ project: 'app', worktree: null }, ['git', 'status'], OPTS), 'CONDUCTOR_UNAVAILABLE');
  assert.equal(cc.state.execCalls.length, 3);
});

test('a failure answer from cc is never retried', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => ({ status: 502, body: { error: 'x', code: 'SYSTEM_UNREACHABLE' } });
  await rejectsWith(exec({ project: 'app', worktree: null }, ['git', 'status'], { ...OPTS, retry: true }), 'SYSTEM_UNREACHABLE');
  assert.equal(cc.state.execCalls.length, 1);
});

test("the plugin's limits stay within cc's exec caps", () => {
  for (const kind of ['read', 'write']) {
    assert.ok(LIMITS[kind].timeoutMs > 0 && LIMITS[kind].timeoutMs <= CC_EXEC_CAPS.EXEC_MAX_TIMEOUT_MS, kind);
    assert.ok(LIMITS[kind].maxOutputBytes > 0 && LIMITS[kind].maxOutputBytes <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES, kind);
  }
});

test('guard: only http/static.js touches the filesystem and no src module spawns processes (git runs through cc)', () => {
  const src = path.join(here, '..', 'src');
  const files = fs.readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 15, 'the guard sees the sources');
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(text, /from ['"](node:)?child_process['"]/, f);
    if (f !== path.join('http', 'static.js')) assert.doesNotMatch(text, /from ['"](node:)?fs(\/promises)?['"]/, f);
  }
});
