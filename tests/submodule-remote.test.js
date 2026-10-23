import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { BASE_ARGS } from '../src/git/runner.js';
import { NET_CONFIG } from '../src/git/remote/net.js';
import { subWorld } from './_submodules.js';

// Submodule clones and fetches against remotes that refuse: no prompt can hang, and the failure says why. A local http
// server stands in for a credential-demanding host (no live network).

const NO_HTTP = !fs.existsSync(path.join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git-remote-http')) && 'this git has no git-remote-http';

/** A local http server answering every request 401 with a Basic challenge; → its base url. */
async function authServer(t) {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' });
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}`;
}

/** A loopback port nothing listens on. */
async function closedPort() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

/** `p`, or a failed assertion once `ms` pass: a prompt would hold the op until its clone timeout. */
function within(p, ms = 20_000) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new assert.AssertionError({ message: `no answer within ${ms} ms` })), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** libA's url set to `url` in .gitmodules and not cloned: an update must clone from it. */
async function pointedAt(t, url) {
  const w = await subWorld(t, { nested: false });
  w.unclone();
  w.repo.git('config', '-f', '.gitmodules', 'submodule.libA.url', url);
  return w;
}

test('401 http submodule url → REMOTE_AUTH_FAILED fast (no prompt)', { skip: NO_HTTP }, async (t) => {
  const w = await pointedAt(t, `${await authServer(t)}/r.git`);
  const r = await within(w.op('submodule.update', { paths: ['libA'] }));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'REMOTE_AUTH_FAILED');
  assert.match(r.body.stderr, /terminal prompts disabled|could not read Username/);
});

test('refused connection → REMOTE_UNREACHABLE', { skip: NO_HTTP }, async (t) => {
  const w = await pointedAt(t, `http://127.0.0.1:${await closedPort()}/r.git`);
  const r = await within(w.op('submodule.update', { paths: ['libA'] }));
  assert.equal(r.body.code, 'REMOTE_UNREACHABLE');
  assert.equal(typeof r.body.stderr, 'string');
});

test('every network exec carries NET_CONFIG after the sub prefix', async (t) => {
  const w = await subWorld(t);
  await w.ok('submodule.add', { url: w.urls.libB, path: 'again' }, ['libA']);
  await w.ok('submodule.update', { paths: ['libB'] }, ['libA']);
  await w.ok('submodule.update', { paths: ['libA'] });
  const net = w.execArgv().filter((a) => a.includes('submodule') && (a.includes('add') || a.includes('update')));
  assert.equal(net.length, 3);
  const prefixes = net.map((a) => a.slice(1 + BASE_ARGS.length, a.indexOf('submodule')));
  assert.deepEqual(prefixes, [['-C', 'libA', '--git-dir=.git', ...NET_CONFIG], ['-C', 'libA', '--git-dir=.git', ...NET_CONFIG], NET_CONFIG]);
});

test('a credentialed url never reaches the activity log: submodule.setUrl and submodule.add argv show it masked (stderr too)', { skip: NO_HTTP }, async (t) => {
  const w = await subWorld(t, { nested: false });
  const url = `http://u:s3cr3t-pw@127.0.0.1:${await closedPort()}/r.git`;
  assert.equal((await w.op('submodule.setUrl', { path: 'libA', url })).status, 200);
  const add = await w.op('submodule.add', { url, path: 'cred' });
  assert.equal(add.body.code, 'REMOTE_UNREACHABLE');
  // git itself got the real url.
  assert.ok(w.execArgv().some((a) => a.includes(url)));
  const log = await w.app.call('GET', '/api/activity');
  assert.equal(JSON.stringify(log.body).includes('s3cr3t-pw'), false);
  const masked = `http://u:***@127.0.0.1:${new URL(url).port}/r.git`;
  const entries = log.body.entries;
  assert.ok(entries.some((e) => e.op === 'submodule.setUrl' && e.argv.includes(masked)));
  assert.ok(entries.some((e) => e.op === 'submodule.add' && e.argv.at(-2) === masked && e.argv.at(-1) === 'cred'));
  // git's own "clone of '<url>' … failed" line: masked in the entry and in the refusal the UI shows.
  assert.ok(entries.some((e) => e.op === 'submodule.add' && e.stderr.includes(`clone of '${masked}'`)));
  assert.equal(JSON.stringify(add.body).includes('s3cr3t-pw'), false);
  assert.match(add.body.stderr, /u:\*\*\*@/);
});

test("a password holding ' or \" never leaves the backend: add and update refusals, the activity log", { skip: NO_HTTP }, async (t) => {
  for (const pw of ["pa'ss-q1", 'pa"ss-q2']) {
    const w = await subWorld(t, { nested: false });
    const port = await closedPort();
    const url = `http://u:${pw}@127.0.0.1:${port}/r.git`;
    const add = await w.op('submodule.add', { url, path: 'cred' });
    assert.equal(add.body.code, 'REMOTE_UNREACHABLE', pw);
    w.unclone();
    w.repo.git('config', '-f', '.gitmodules', 'submodule.libA.url', url);
    const up = await w.op('submodule.update', { paths: ['libA'] });
    assert.equal(up.body.code, 'REMOTE_UNREACHABLE', pw);
    // git's own lines name the url: masked in both refusals' stderr and everywhere in the log.
    assert.match(up.body.stderr, /registered|clone of/);
    const log = await w.app.call('GET', '/api/activity');
    // The tail after the quote is what a quote-ended mask would have left behind (JSON escapes the quote itself).
    for (const [what, v] of [['add', add.body], ['update', up.body], ['activity', log.body]]) assert.equal(JSON.stringify(v).includes(pw.slice(3)), false, `${what} ${pw}`);
    assert.match(up.body.stderr, /u:\*\*\*@127\.0\.0\.1/);
  }
});

test('a timeout refusal (GIT_TIMEOUT, partial stderr) is masked too', async (t) => {
  const w = await subWorld(t, { nested: false });
  const stderr = "Cloning into 'x'...\nfatal: clone of 'https://u:t1me0ut-pw@h/r.git' into submodule path 'x'\n";
  w.cc.state.execHook = (b) => (b.argv.includes('add') && b.argv.includes('submodule')
    ? { status: 504, body: { error: 'exec: timed out', code: 'EXEC_TIMEOUT', stderr: Buffer.from(stderr).toString('base64'), encoding: 'base64' } } : undefined);
  const r = await w.op('submodule.add', { url: 'https://u:t1me0ut-pw@h/r.git', path: 'x' });
  assert.equal(r.body.code, 'GIT_TIMEOUT');
  assert.match(r.body.stderr, /clone of 'https:\/\/u:\*\*\*@h\/r\.git'/);
  assert.equal(JSON.stringify(r.body).includes('t1me0ut-pw'), false);
  assert.equal(JSON.stringify((await w.app.call('GET', '/api/activity')).body).includes('t1me0ut-pw'), false);
});
