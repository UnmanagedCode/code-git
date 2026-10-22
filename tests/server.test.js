import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { CSP, DEFAULT_PORT } from '../server.js';
import { startApp } from './_app.js';
import { tempDir } from './_git.js';

const assertHeaders = (r, what) => {
  assert.equal(r.headers.get('content-security-policy'), CSP, `CSP on ${what}`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `nosniff on ${what}`);
};

function builtDist(t) {
  const dist = tempDir(t, 'cg-dist-');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.mkdirSync(path.join(dist, '.vite'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>code-git</title>');
  fs.writeFileSync(path.join(dist, 'theme-init.js'), '// init');
  fs.writeFileSync(path.join(dist, 'assets', 'index-AbC_1.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'assets', 'index-AbC_1.js.map'), '{}');
  fs.writeFileSync(path.join(dist, '.hidden.js'), 'secret');
  fs.writeFileSync(path.join(dist, '.vite', 'manifest.json'), '{}');
  const outside = tempDir(t, 'cg-outside-');
  fs.writeFileSync(path.join(outside, 'leak.js'), 'leak');
  fs.symlinkSync(path.join(outside, 'leak.js'), path.join(dist, 'leak.js'));
  return dist;
}

test('CSP has the policy the host contract needs and nothing looser', () => {
  for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'", "connect-src 'self'",
    "img-src 'self'", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(CSP.split('; ').includes(d), d);
  assert.equal(CSP.split('; ').length, 9);
  assert.equal(DEFAULT_PORT, 7500);
});

test('every response carries the CSP and nosniff: health, API JSON, 404, 503 unbuilt, 415 and 400 errors', async (t) => {
  const prev = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  t.after(() => { if (prev !== undefined) process.env.CONDUCTOR_URL = prev; });
  const { call } = await startApp(t);
  const health = await call('GET', '/health');
  assert.deepEqual([health.status, health.body], [200, { ok: true }]);
  assertHeaders(health, '/health');
  const repos = await call('GET', '/api/repos');
  assert.deepEqual([repos.status, repos.body.code], [503, 'CONDUCTOR_UNAVAILABLE']);
  assertHeaders(repos, 'API refusal');
  const missing = await call('GET', '/nope');
  assert.equal(missing.status, 404);
  assertHeaders(missing, '404');
  const unbuilt = await call('GET', '/');
  assert.equal(unbuilt.status, 503);
  assert.match(unbuilt.body, /UI not built/);
  assertHeaders(unbuilt, '503');
  const media = await call('POST', '/api/ops/repo.summary', 'x', { headers: { 'content-type': 'text/plain' } });
  assert.equal(media.status, 415);
  assertHeaders(media, '415');
  const malformed = await call('POST', '/api/ops/repo.summary', '{bad');
  assert.equal(malformed.status, 400);
  assertHeaders(malformed, '400');
  const huge = await call('POST', '/api/ops/repo.summary', JSON.stringify({ x: 'y'.repeat(2 * 1024 * 1024) }));
  assert.deepEqual([huge.status, huge.body.code], [413, 'BODY_TOO_LARGE']);
});

test('unbuilt: HTML entry pages 503, every other non-API path 404 (host URLs included), health stays up', async (t) => {
  const { call } = await startApp(t);
  for (const p of ['/', '/index.html', '/other.html']) assert.equal((await call('GET', p)).status, 503, p);
  for (const p of ['/theme-init.js', '/pluginBridge.js', '/pluginTheme.css', '/assets/x.js']) assert.equal((await call('GET', p)).status, 404, p);
  assert.equal((await call('GET', '/health')).status, 200);
});

test('built: the allowlist serves the page and assets, and nothing else', async (t) => {
  const { call } = await startApp(t, { distDir: builtDist(t) });
  const index = await call('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /code-git/);
  assertHeaders(index, 'index');
  assert.equal((await call('GET', '/index.html')).status, 200);
  assert.equal((await call('GET', '/theme-init.js')).status, 200);
  assert.equal((await call('GET', '/assets/index-AbC_1.js')).body, 'console.log(1)');
  for (const p of ['/assets/index-AbC_1.js.map', '/assets/index-AbC_1.js%2Emap', '/assets/index-AbC_1.js%2emap', '/.hidden.js', '/%2Ehidden.js',
    '/.vite/manifest.json', '/leak.js', '/pluginBridge.js', '/pluginTheme.css', '/assets', '/assets/', '/%E0%A4%A']) {
    const r = await call('GET', p);
    assert.equal(r.status, 404, p);
    assertHeaders(r, p);
  }
  assert.equal((await call('POST', '/index.html', {})).status, 404);
});

test('the server binds loopback only', async (t) => {
  const { server } = await startApp(t);
  assert.equal(server.address().address, '127.0.0.1');
});

test('a request the HTTP parser rejects is answered 400 with the CSP', async (t) => {
  const { server } = await startApp(t);
  const raw = await new Promise((resolve, reject) => {
    const s = net.connect(server.address().port, '127.0.0.1', () => s.write('BROKEN\r\n\r\n'));
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('end', () => resolve(buf));
    s.on('error', reject);
  });
  assert.match(raw, /^HTTP\/1\.1 400 /);
  assert.ok(raw.includes(`Content-Security-Policy: ${CSP}\r\n`));
  assert.ok(raw.includes('X-Content-Type-Options: nosniff\r\n'));
});

test('the JSON check accepts application/json with parameters, any case, and refuses look-alikes', async (t) => {
  const { call } = await startApp(t);
  const post = (type) => call('POST', '/api/activity/1/cancel', '{}', { headers: { 'content-type': type } });
  for (const type of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json ;charset=utf-8']) {
    assert.equal((await post(type)).body.code, 'ACTIVITY_UNKNOWN', type);
  }
  for (const type of ['application/jsonp', 'application/json-patch+json', 'text/json', 'text/plain; application/json', 'multipart/form-data']) {
    const r = await post(type);
    assert.deepEqual([r.status, r.body.code], [415, 'UNSUPPORTED_MEDIA_TYPE'], type);
  }
});

test('an oversized request header is answered 431 with the CSP', async (t) => {
  const { server } = await startApp(t);
  const raw = await new Promise((resolve, reject) => {
    const s = net.connect(server.address().port, '127.0.0.1', () => s.write(`GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(70_000)}\r\n\r\n`));
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('end', () => resolve(buf));
    s.on('error', (e) => (buf ? resolve(buf) : reject(e)));
  });
  assert.match(raw, /^HTTP\/1\.1 431 /);
  assert.ok(raw.includes(`Content-Security-Policy: ${CSP}\r\n`));
});
