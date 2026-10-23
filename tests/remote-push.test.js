import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { OPS } from '../src/git/ops/index.js';
import { NETWORK_LIMITS } from '../src/git/remote/limits.js';
import { BASE_ENV } from '../src/git/runner.js';
import { startApp } from './_app.js';
import { refsWorld, refused } from './_refsWorld.js';

const NETWORK_OPS = ['branch.deleteRemote', 'tag.push', 'tag.deleteRemote', 'remote.fetch', 'remote.push'];
const hasHttp = (() => {
  try { return fs.existsSync(path.join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git-remote-http')); } catch { return false; }
})();

test('NETWORK_LIMITS stay within cc\'s exec caps', () => {
  assert.ok(NETWORK_LIMITS.timeoutMs > 0 && NETWORK_LIMITS.timeoutMs <= CC_EXEC_CAPS.EXEC_MAX_TIMEOUT_MS);
  assert.ok(NETWORK_LIMITS.maxOutputBytes > 0 && NETWORK_LIMITS.maxOutputBytes <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES);
});

test('the network writes are cancellable; every other branch, tag, HEAD and remote write is not; the remote reads are cancellable', () => {
  for (const [name, def] of OPS) {
    if (!/^(branch|tag|head|remote)\./.test(name) || def.kind !== 'write') continue;
    assert.equal(def.cancellable, NETWORK_OPS.includes(name), name);
  }
  for (const name of NETWORK_OPS) assert.equal(OPS.get(name)?.kind, 'write', name);
  for (const name of ['remote.list', 'remote.peek']) assert.deepEqual([OPS.get(name)?.kind, OPS.get(name)?.cancellable], ['read', true], name);
});

test('a push to a remote asking for credentials fails fast with REMOTE_AUTH_FAILED: prompts are off, nothing is added to the env', { skip: !hasHttp && 'this git has no git-remote-http' }, async (t) => {
  const w = await refsWorld(t);
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' });
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  w.repo.git('remote', 'add', 'locked', `http://127.0.0.1:${server.address().port}/r.git`);
  w.repo.git('tag', 'v1', w.base);
  await assert.rejects(w.op('tag.push', { remote: 'locked', names: ['v1'] }), refused('REMOTE_AUTH_FAILED'));
  const push = w.cc.state.execCalls.find((b) => b.argv.includes('push'));
  assert.deepEqual(push.env, BASE_ENV);
  assert.equal(push.timeoutMs, NETWORK_LIMITS.timeoutMs);
  assert.equal(push.maxOutputBytes, NETWORK_LIMITS.maxOutputBytes);
});

test('an askpass program inherited from the System\'s environment never runs: a push to a credential-demanding remote fails fast', { skip: !hasHttp && 'this git has no git-remote-http' }, async (t) => {
  const w = await refsWorld(t);
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' });
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  // A hanging askpass, as a desktop session or credential manager may export: it marks that it ran, then waits.
  const marker = path.join(w.repo.root, 'askpass-ran');
  const askpass = path.join(w.repo.root, 'askpass.sh');
  fs.writeFileSync(askpass, `#!/bin/sh\ntouch '${marker}'\nexec sleep 60\n`, { mode: 0o755 });
  w.cc.state.inheritedEnv = { GIT_ASKPASS: askpass, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force' };
  w.repo.git('remote', 'add', 'locked', `http://127.0.0.1:${server.address().port}/r.git`);
  w.repo.git('tag', 'v1', w.base);
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the push waited on the inherited askpass')), 15_000); });
  await assert.rejects(Promise.race([w.op('tag.push', { remote: 'locked', names: ['v1'] }), late]).finally(() => clearTimeout(timer)), refused('REMOTE_AUTH_FAILED'));
  assert.equal(fs.existsSync(marker), false, 'the inherited askpass never ran');
  const push = w.cc.state.execCalls.find((b) => b.argv.includes('push'));
  assert.deepEqual([push.env.GIT_ASKPASS, push.env.SSH_ASKPASS, push.env.SSH_ASKPASS_REQUIRE], ['false', 'false', 'never']);
});

test('an unreachable remote → REMOTE_UNREACHABLE', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('remote', 'add', 'nowhere', path.join(w.repo.root, 'missing.git'));
  w.repo.git('tag', 'v1', w.base);
  await assert.rejects(w.op('tag.push', { remote: 'nowhere', names: ['v1'] }), refused('REMOTE_UNREACHABLE'));
});

test('a held push is cancelled from the activity route: the op answers CANCELLED and the entry ends cancelled', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('tag', 'v1', w.base);
  const app = await startApp(t);
  w.cc.state.execHook = (body) => (body.argv.includes('push') ? 'hold' : undefined);
  const response = app.call('POST', '/api/ops/tag.push', { target: { project: 'repo' }, params: { remote: 'origin', names: ['v1'] } });
  const held = await w.cc.nextHeld();
  const entry = (await app.call('GET', '/api/activity')).body.entries.at(-1);
  assert.equal(entry.op, 'tag.push');
  assert.equal(entry.cancellable, true);
  const c = await app.call('POST', `/api/activity/${entry.id}/cancel`, {});
  assert.equal(c.status, 200);
  const r = await response;
  assert.deepEqual([r.status, r.body.code], [409, 'CANCELLED']);
  await held.closed;
  assert.equal(held.disconnected, true);
  assert.equal((await app.call('GET', '/api/activity')).body.entries.at(-1).status, 'cancelled');
});
