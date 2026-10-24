import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityLog, redactArgv } from '../src/activity/log.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { maskDeep, maskUrl, maskUrls } from '../src/mask.js';
import { refsWorld } from './_refsWorld.js';
import { startApp } from './_app.js';

// One masking function for every place a url with a password could be shown: remote.list's display urls and the
// activity log's argv (and so /api/activity, its SSE events and the Activity panel).

test('maskUrl hides everything from the userinfo\'s first : to the authority\'s last @, whatever the password holds', () => {
  assert.equal(maskUrl('https://user:secret@host/r.git'), 'https://user:***@host/r.git');
  assert.equal(maskUrl('https://user:sec/ret@host/r'), 'https://user:***@host/r');
  assert.equal(maskUrl('https://user:p@ss@host/r'), 'https://user:***@host/r');
  assert.equal(maskUrl('https://user:a/b@c@host:8443/r'), 'https://user:***@host:8443/r');
  assert.equal(maskUrl('https://:tok@host/r'), 'https://:***@host/r');
  assert.equal(maskUrl('ssh://u:pw@h:22/r'), 'ssh://u:***@h:22/r');
});

test('maskUrl leaves urls without a password alone', () => {
  for (const u of ['https://host/r.git', 'https://user@host/r', 'ssh://git@host:22/r.git', 'git@host:o/r.git', '/srv/r.git', 'file:///srv/r', 'origin', '--end-of-options']) {
    assert.equal(maskUrl(u), u, u);
  }
});

test('redactArgv masks a url password in any argument; the activity entry, its events and list() never hold it', () => {
  assert.deepEqual(redactArgv(['git', 'remote', 'add', '--end-of-options', 'o', 'https://u:tok@h/r', 'x']), ['git', 'remote', 'add', '--end-of-options', 'o', 'https://u:***@h/r', 'x']);
  const log = createActivityLog();
  const events = [];
  log.events.on('activity', (e) => events.push(e));
  const { entry } = log.open({ opRunId: 'r', op: 'remote.add', kind: 'write', target: { project: 'p' }, argv: ['git', 'remote', 'set-url', 'o', 'https://u:sec/ret@h/r'], cancellable: false });
  log.close(entry, { status: 'ok', exitCode: 0 });
  for (const e of [...events, ...log.list()]) assert.equal(e.argv.at(-1), 'https://u:***@h/r');
  assert.ok(!JSON.stringify([events, log.list()]).includes('sec/ret'));
});

// Invariant: the value of a `git config` write to a remote's key other than url / pushurl / fetch (an `extra` key: a
// proxy, a pack command) is never recorded — replaced by *** with the key kept, whatever its form (a scheme-less
// user:password@host proxy included); url and pushurl keep maskUrl, fetch and everything else is recorded as given; the
// entry's events never hold it either.
test('redactArgv withholds the value of a config write to a remote extra key; url keys keep maskUrl', () => {
  const git = (...args) => ['git', ...BASE_ARGS, ...args];
  const proxy = 'proxyuser:Pr0xyPW@proxy.invalid:8080';
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.proxy', proxy)), git('config', '--add', 'remote.o.proxy', '***'));
  assert.deepEqual(redactArgv(git('config', '--replace-all', 'remote.a.b.receivepack', 'git-receive-pack --secret')), git('config', '--replace-all', 'remote.a.b.receivepack', '***'));
  assert.deepEqual(redactArgv(['git', ...BASE_ARGS, '-C', 'sub', '--git-dir=.git', 'config', '--add', 'remote.o.uploadpack', 'x']), ['git', ...BASE_ARGS, '-C', 'sub', '--git-dir=.git', 'config', '--add', 'remote.o.uploadpack', '***']);
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.url', 'https://u:tok@h/r')), git('config', '--add', 'remote.o.url', 'https://u:***@h/r'));
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.pushurl', 'https://u:tok@h/r')), git('config', '--add', 'remote.o.pushurl', 'https://u:***@h/r'));
  for (const kept of [
    git('config', '--add', 'remote.o.fetch', '+refs/heads/*:refs/remotes/o/*'),
    git('config', '--add', 'remote.pushDefault', 'o'),
    git('config', '--add', 'branch.main.merge', 'refs/heads/main'),
    git('config', '--unset-all', 'remote.o.proxy'),
    git('config', '-z', '--get-regexp', '^remote\\.'),
    ['git', ...BASE_ARGS, '-C', 'config', '--git-dir=.git', 'status', 'remote.o.proxy', 'x'],
  ]) assert.deepEqual(redactArgv(kept), kept, kept.join(' '));
  const log = createActivityLog();
  const events = [];
  log.events.on('activity', (e) => events.push(e));
  const { entry } = log.open({ opRunId: 'r', op: 'undo.undo', kind: 'write', target: { project: 'p' }, argv: git('config', '--add', 'remote.o.proxy', proxy), cancellable: false });
  log.close(entry, { status: 'ok', exitCode: 0 });
  assert.ok(!JSON.stringify([events, log.list()]).includes('Pr0xyPW'));
});

test('end to end: remote.add with a credential url writes it to git config but /api/activity shows it masked', async (t) => {
  const w = await refsWorld(t);
  const app = await startApp(t);
  const r = await app.call('POST', '/api/ops/remote.add', { target: { project: 'repo' }, params: { name: 'up', url: 'https://me:p@ss/word@h.example/r.git' } });
  assert.equal(r.status, 200);
  assert.equal(w.repo.git('config', 'remote.up.url'), 'https://me:p@ss/word@h.example/r.git');
  const body = JSON.stringify((await app.call('GET', '/api/activity')).body);
  assert.ok(body.includes('https://me:***@h.example/r.git'));
  assert.ok(!body.includes('ss/word'), 'the password never reaches the activity API');
  const listed = (await app.call('POST', '/api/ops/remote.list', { target: { project: 'repo' } })).body.result.remotes.find((x) => x.name === 'up');
  assert.equal(listed.displayUrl, 'https://me:***@h.example/r.git');
});

test('maskUrls masks every credentialed url inside a text, stopping at whitespace or a quote, and leaves the rest', () => {
  const text = "Cloning into 'x'...\nfatal: clone of 'https://u:p@ss@host/r.git' into submodule path 'x' failed\nsee ssh://git:k3y@h:22/r and http://plain/h@x";
  assert.equal(maskUrls(text), "Cloning into 'x'...\nfatal: clone of 'https://u:***@host/r.git' into submodule path 'x' failed\nsee ssh://git:***@h:22/r and http://plain/h@x");
  assert.equal(maskUrls('no urls here'), 'no urls here');
});

test("maskUrls: a password holding ' or \" is masked whole (quotes do not end it; whitespace does)", () => {
  assert.equal(maskUrls("fatal: clone of 'https://u:pa'ss@host/r.git' into submodule path"), "fatal: clone of 'https://u:***@host/r.git' into submodule path");
  assert.equal(maskUrls('Submodule \'c\' (http://u:pa"ss@h/r.git) registered'), "Submodule 'c' (http://u:***@h/r.git) registered");
});

test('a user name holding @: maskUrl, maskUrls and redactArgv take the first : after scheme:// and the last @', () => {
  const url = 'https://a@b:c0ntr4@host/r.git';
  assert.equal(maskUrl(url), 'https://a@b:***@host/r.git');
  assert.equal(maskUrls(`fatal: clone of '${url}' into submodule path 'x'`), "fatal: clone of 'https://a@b:***@host/r.git' into submodule path 'x'");
  assert.deepEqual(redactArgv(['git', 'submodule', 'add', '--', url, 'x']), ['git', 'submodule', 'add', '--', 'https://a@b:***@host/r.git', 'x']);
  // No password: unchanged (a port colon with no @ after it is not one).
  for (const plain of ['https://a@host:8080/r.git', 'https://host/r.git', 'git@host:o/r.git']) assert.equal(maskUrl(plain), plain);
});

test('maskDeep masks every string through arrays and plain objects, and leaves other values', () => {
  const u = 'https://u:pw1@h/r';
  assert.deepEqual(maskDeep({ error: `refs ${u}`, names: [u, 'origin'], n: 3, nested: { stderr: u }, ok: true, none: null }),
    { error: 'refs https://u:***@h/r', names: ['https://u:***@h/r', 'origin'], n: 3, nested: { stderr: 'https://u:***@h/r' }, ok: true, none: null });
});
