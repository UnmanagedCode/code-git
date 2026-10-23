import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityLog, redactArgv } from '../src/activity/log.js';
import { maskUrl } from '../src/mask.js';
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
