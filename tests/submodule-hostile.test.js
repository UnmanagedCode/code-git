import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { afterBase, subWorld } from './_submodules.js';

// Repositories set up to run a command, reach a transport or write where they should not, through the submodule ops. A
// marker file is what such a command would create: none may appear. Each case also names what stops it.

const extUrl = (w, m) => `ext::sh -c touch% ${w.marker(m)}`;
const ranUpdate = (w) => w.execArgv().map(afterBase).some((a) => a.includes('update') && a.includes('submodule'));
const refusal = async (w, name, params, code, sub) => {
  const r = await w.op(name, params, sub);
  assert.equal(r.body.code, code, JSON.stringify(r.body));
  return r.body;
};

test('update=!touch in .git/config: --checkout runs a checkout instead (top level and nested)', async (t) => {
  const w = await subWorld(t);
  w.unclone();
  w.fx('.', 'submodule', 'init', '-q');
  w.repo.git('config', 'submodule.libA.update', `!${w.markerScript('top')}`);
  await w.ok('submodule.update', { paths: ['libA'] });
  assert.ok(fs.existsSync(w.file('libA/libB/b.txt')));
  // Nested: libB's update=!cmd in libA's config, run by the recursion.
  w.fx('libA', 'submodule', 'deinit', '-q', '-f', 'libB');
  w.fx('libA', 'submodule', 'init', '-q');
  w.repo.git('-C', 'libA', 'config', 'submodule.libB.update', `!${w.markerScript('nested')}`);
  await w.ok('submodule.update', { paths: ['libA'] });
  assert.ok(fs.existsSync(w.file('libA/libB/b.txt')));
  // From a submodule tab, the same through libA's own update.
  w.fx('libA', 'submodule', 'deinit', '-q', '-f', 'libB');
  w.fx('libA', 'submodule', 'init', '-q');
  w.repo.git('-C', 'libA', 'config', 'submodule.libB.update', `!${w.markerScript('tab')}`);
  await w.ok('submodule.update', { paths: ['libB'] }, ['libA']);
  assert.deepEqual(w.markers(), []);
});

test('url ext::sh -c touch… in local config refused before exec', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.unclone();
  w.fx('.', 'submodule', 'init', '-q');
  w.repo.git('config', 'submodule.libA.url', extUrl(w, 'ext'));
  const b = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_UNSAFE');
  assert.deepEqual([b.reason, b.names], ['url', ['libA']]);
  assert.equal(ranUpdate(w), false);
  assert.deepEqual(w.markers(), []);
});

test("url.ext::….insteadOf rewriting a valid url → transport 'ext' not allowed, no marker", async (t) => {
  // A submodule's own config, which no gate reads: it allows ext and rewrites its origin's url to an ext:: command. The
  // parent's pointer moves to a commit libA must fetch, so git talks to that remote inside libA.
  const w = await subWorld(t, { nested: false });
  const next = w.advance('libA', { 'a.txt': 'next\n' });
  w.repo.git('update-index', '--cacheinfo', `160000,${next},libA`);
  w.repo.git('-C', 'libA', 'config', 'protocol.ext.allow', 'always');
  w.repo.git('-C', 'libA', 'config', `url.${extUrl(w, 'insteadof')}.insteadOf`, w.urls.libA);
  const b = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_TRANSPORT_BLOCKED');
  assert.equal(b.transport, 'ext');
  assert.deepEqual(w.markers(), []);
});

test('fd:: and -oProxyCommand urls refused (update and add)', async (t) => {
  const w = await subWorld(t, { nested: false });
  for (const url of ['fd::3', `-oProxyCommand=touch ${w.marker('proxy')}`, `ssh://-oProxyCommand=touch%20${w.marker('proxy2')}/r`]) {
    w.unclone();
    w.fx('.', 'submodule', 'init', '-q');
    w.repo.git('config', 'submodule.libA.url', url);
    assert.equal((await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_UNSAFE')).reason, 'url', url);
    await refusal(w, 'submodule.add', { url, path: 'x' }, 'BAD_URL');
  }
  assert.equal(ranUpdate(w), false);
  assert.deepEqual(w.markers(), []);
});

test('local protocol.file.allow=always / protocol.allow=always → SUBMODULE_UNSAFE config (add and update; a submodule tab reads its own)', async (t) => {
  const w = await subWorld(t);
  for (const [key, value] of [['protocol.file.allow', 'always'], ['protocol.allow', 'always'], ['protocol.ext.allow', 'never']]) {
    w.repo.git('config', key, value);
    for (const [name, params] of [['submodule.update', { paths: ['libA'] }], ['submodule.add', { url: w.urls.libA, path: 'x' }]]) {
      const b = await refusal(w, name, params, 'SUBMODULE_UNSAFE');
      assert.deepEqual([b.reason, b.keys], ['config', [key]]);
    }
    w.repo.git('config', '--unset', key);
  }
  w.repo.git('-C', 'libA', 'config', 'protocol.file.allow', 'always');
  assert.deepEqual((await refusal(w, 'submodule.update', { paths: ['libB'] }, 'SUBMODULE_UNSAFE', ['libA'])).keys, ['protocol.file.allow']);
  assert.equal(ranUpdate(w), false);
  // The System's own (global) opt-in is not refused: hermeticEnv's protocol.file.allow.
  w.repo.git('-C', 'libA', 'config', '--unset', 'protocol.file.allow');
  await w.ok('submodule.update', { paths: ['libA'] });
});

test('relative URL against an ext:: parent remote refused (add, and update after init resolves it)', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('remote', 'add', 'origin', extUrl(w, 'remote'));
  const b = await refusal(w, 'submodule.add', { url: '../x.git', path: 'x' }, 'SUBMODULE_UNSAFE');
  assert.deepEqual([b.reason, b.names], ['url', ['origin']]);
  // No default remote at all: refused too (git would resolve against the checkout's own path).
  w.repo.git('remote', 'remove', 'origin');
  await refusal(w, 'submodule.add', { url: '../x.git', path: 'x' }, 'SUBMODULE_UNSAFE');
  // An insteadOf turning origin's https url into ext:: is what git would resolve against: refused.
  w.repo.git('remote', 'add', 'origin', 'https://example.invalid/p.git');
  w.repo.git('config', `url.${extUrl(w, 'rewrite')}.insteadOf`, 'https://example.invalid/');
  await refusal(w, 'submodule.add', { url: '../x.git', path: 'x' }, 'SUBMODULE_UNSAFE');
  w.repo.git('config', '--remove-section', `url.${extUrl(w, 'rewrite')}`);
  w.repo.git('remote', 'set-url', 'origin', extUrl(w, 'remote'));
  w.unclone();
  w.repo.git('config', '-f', '.gitmodules', 'submodule.libA.url', '../libA.git');
  const u = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_UNSAFE');
  assert.deepEqual([u.reason, u.names], ['url', ['libA']]);
  assert.equal(w.execArgv().map(afterBase).some((a) => a.includes('add') && a.includes('submodule')), false);
  assert.equal(ranUpdate(w), false);
  assert.deepEqual(w.markers(), []);
});

test('core.fsmonitor and core.hooksPath markers in the submodule config: fsmonitor pinned; hooks run as they do in the root', async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('-C', 'libA', 'config', 'core.fsmonitor', w.markerScript('fsmonitor'));
  const hooks = path.join(w.root, 'sub-hooks');
  fs.mkdirSync(hooks);
  fs.copyFileSync(w.markerScript('post-checkout'), path.join(hooks, 'post-checkout'));
  fs.chmodSync(path.join(hooks, 'post-checkout'), 0o755);
  w.repo.git('-C', 'libA', 'config', 'core.hooksPath', hooks);
  w.repo.write('libA/dirty.txt', 'x\n');
  await w.ok('submodule.list');
  // A pointer to move to: the update checks out in libA.
  const next = w.advance('libA', { 'a.txt': 'next\n' });
  w.repo.git('update-index', '--cacheinfo', `160000,${next},libA`);
  await w.ok('submodule.update', { paths: ['libA'] });
  await w.ok('repo.summary', undefined, ['libA']);
  // The residual (docs/submodules.md): the submodule's hooks are its repo's, as the checkout's own are.
  assert.deepEqual(w.markers(), ['post-checkout']);
});

test('no submodule exec sets protocol.file.allow or GIT_ALLOW_PROTOCOL', async (t) => {
  const w = await subWorld(t);
  await w.ok('submodule.list');
  await w.ok('submodule.list', undefined, ['libA']);
  await w.ok('submodule.add', { url: w.urls.libB, path: 'two' });
  await w.ok('submodule.init', { paths: ['libA'] });
  await w.ok('submodule.sync', { paths: ['libA'] });
  await w.ok('submodule.setUrl', { path: 'libA', url: w.urls.libA });
  await w.ok('submodule.update', { paths: ['libA'] });
  await w.ok('submodule.update', { paths: ['libB'] }, ['libA']);
  w.fx('libA', 'commit', '-q', '--allow-empty', '-m', 'moved');
  await w.ok('submodule.commitPointer', { path: 'libA', expect: w.repo.git('-C', 'libA', 'rev-parse', 'HEAD'), summary: 's' });
  await w.ok('submodule.remove', { path: 'two', discard: true });
  const ops = new Set((await w.activity()).map((e) => e.op));
  assert.deepEqual([...ops].sort(), ['submodule.add', 'submodule.commitPointer', 'submodule.init', 'submodule.list', 'submodule.remove', 'submodule.setUrl', 'submodule.sync', 'submodule.update']);
  for (const b of w.execCalls()) {
    assert.equal(b.argv.some((a) => /protocol\.(file\.)?allow/.test(a)), false, b.argv.join(' '));
    assert.equal(Object.keys(b.env ?? {}).some((k) => k === 'GIT_ALLOW_PROTOCOL' || k.startsWith('GIT_CONFIG')), false);
    assert.equal(b.stdinB64 === undefined || !Buffer.from(b.stdinB64, 'base64').toString().includes('protocol'), true);
  }
});

test('allowFile:false → update refused SUBMODULE_TRANSPORT_BLOCKED; add too', async (t) => {
  const w = await subWorld(t, { nested: false, populated: false, allowFile: false });
  const b = await refusal(w, 'submodule.update', { paths: ['libA'] }, 'SUBMODULE_TRANSPORT_BLOCKED');
  assert.equal(b.transport, 'file');
  assert.match(b.error, /protocol\.file\.allow/);
  assert.deepEqual(fs.readdirSync(w.file('libA')), []);
  assert.equal((await refusal(w, 'submodule.add', { url: w.urls.libA, path: 'x' }, 'SUBMODULE_TRANSPORT_BLOCKED')).transport, 'file');
});
