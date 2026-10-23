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
