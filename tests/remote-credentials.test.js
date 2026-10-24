import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskUrl } from '../src/mask.js';
import { startApp } from './_app.js';
import { refsWorld } from './_refsWorld.js';

// A password in a remote's url or push url never leaves the backend: remote.list and every remote op's result carry it
// masked, while git config, undo, redo and the re-add of a removed remote keep the raw value. Ops run over HTTP, so the
// route's own wire copy (forTheWire) is what is checked.

const PW = 'Url5ecret';
const PUSH_PW = 'Push5ecret';
const url = (n) => `https://user:${PW}@example.invalid/${n}.git`;
const pushUrl = (n) => `https://user:${PUSH_PW}@example.invalid/${n}.git`;
const masked = (n) => `https://user:***@example.invalid/${n}.git`;
const target = { project: 'repo' };

async function world(t) {
  const w = await refsWorld(t);
  const app = await startApp(t);
  /** POSTs op `name`; asserts `status`; the response body. */
  const call = async (name, params, status = 200) => {
    const r = await app.call('POST', `/api/ops/${name}`, { target, ...(params === undefined ? {} : { params }) });
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  /** git config's values for `key` ([] when unset). */
  const config = (key) => { try { return w.repo.git('config', '--get-all', key).split('\n'); } catch { return []; } };
  /** The exec'd commands that write a remote's config. */
  const remoteWrites = () => w.argvs().filter((a) => (a[0] === 'remote' && a.length > 1)
    || (a[0] === 'config' && a.some((x) => ['--add', '--replace-all', '--unset-all', '--remove-section'].includes(x))));
  return { ...w, call, config, remoteWrites };
}

/** `body` holds neither password. */
const lacksSecrets = (body) => {
  for (const secret of [PW, PUSH_PW]) assert.ok(!JSON.stringify(body).includes(secret), JSON.stringify(body));
};

// Invariant: remote.list answers every url and push url masked (several values each), password-less ones verbatim, while
// git config keeps the raw values.
test('remote.list masks every url and push url; password-less urls verbatim; git config keeps them raw', async (t) => {
  const w = await world(t);
  w.repo.git('remote', 'add', 'cred', url('one'));
  w.repo.git('config', '--add', 'remote.cred.url', url('two'));
  w.repo.git('config', 'remote.cred.pushurl', pushUrl('p'));
  w.repo.git('remote', 'add', 'scp', 'git@h.invalid:o/r.git');
  w.repo.git('remote', 'add', 'user', 'https://user@h.invalid/r');
  const body = await w.call('remote.list');
  lacksSecrets(body);
  const by = Object.fromEntries(body.result.remotes.map((r) => [r.name, r]));
  assert.deepEqual([by.cred.urls, by.cred.pushUrls], [[masked('one'), masked('two')], [masked('p')]]);
  assert.deepEqual([by.cred.displayUrl, by.cred.displayPushUrl], [masked('one'), masked('p')]);
  assert.deepEqual(by.scp.urls, ['git@h.invalid:o/r.git']);
  assert.deepEqual(by.user.urls, ['https://user@h.invalid/r']);
  assert.deepEqual(w.config('remote.cred.url'), [url('one'), url('two')]);
  assert.deepEqual(w.config('remote.cred.pushurl'), [pushUrl('p')]);
});

// Invariant: the route answers every remote op's undo record with both sides' urls and push urls masked (add's new, edit's
// old and new, rename's old and new entries, remove's old), the journal still holding the raw ones.
test('remote.add / edit / rename / remove answer undo.remotes with every url and push url masked on both sides', async (t) => {
  const w = await world(t);
  const side = (s) => s && [s.urls, s.pushUrls];
  const add = await w.call('remote.add', { name: 'cred', url: url('one'), pushUrl: pushUrl('p') });
  lacksSecrets(add);
  assert.deepEqual(add.result.undo.remotes.map((r) => [r.name, side(r.old), side(r.new)]), [['cred', null, [[masked('one')], [masked('p')]]]]);
  const edit = await w.call('remote.edit', { name: 'cred', url: url('two') });
  lacksSecrets(edit);
  assert.deepEqual(edit.result.undo.remotes.map((r) => [r.name, side(r.old), side(r.new)]), [['cred', [[masked('one')], [masked('p')]], [[masked('two')], [masked('p')]]]]);
  const rename = await w.call('remote.rename', { name: 'cred', newName: 'cred2' });
  lacksSecrets(rename);
  assert.deepEqual(rename.result.undo.remotes.map((r) => [r.name, side(r.old), side(r.new)]), [
    ['cred', [[masked('two')], [masked('p')]], null],
    ['cred2', null, [[masked('two')], [masked('p')]]],
  ]);
  const remove = await w.call('remote.remove', { name: 'cred2' });
  lacksSecrets(remove);
  assert.deepEqual(remove.result.undo.remotes.map((r) => [r.name, side(r.old), side(r.new)]), [['cred2', [[masked('two')], [masked('p')]], null]]);
});

/** A remote `cred` (url `one`, push url `p`, both credentialed) added through the API; the exec log's length before the next call. */
async function credRemote(w) {
  await w.call('remote.add', { name: 'cred', url: url('one'), pushUrl: pushUrl('p') });
  return w.remoteWrites().length;
}

// Invariant: an edit field equal to the mask of the remote's single current value counts as not sent: no set-url runs,
// git config keeps the raw credential (url and push url alike), and the other field is still written.
test('remote.edit with a field echoing the masked current url keeps the stored credential and writes nothing for it', async (t) => {
  const w = await world(t);
  const before = await credRemote(w);
  lacksSecrets(await w.call('remote.edit', { name: 'cred', url: masked('one') }));
  lacksSecrets(await w.call('remote.edit', { name: 'cred', pushUrl: masked('p') }));
  lacksSecrets(await w.call('remote.edit', { name: 'cred', url: masked('one'), pushUrl: masked('p') }));
  assert.deepEqual(w.remoteWrites().slice(before), [], 'no set-url ran');
  assert.deepEqual([w.config('remote.cred.url'), w.config('remote.cred.pushurl')], [[url('one')], [pushUrl('p')]]);
  await w.call('remote.edit', { name: 'cred', url: masked('one'), pushUrl: '/push.git' });
  assert.deepEqual(w.remoteWrites().slice(before), [['remote', 'set-url', '--push', '--end-of-options', 'cred', '/push.git']], 'only the push url was set');
  assert.deepEqual([w.config('remote.cred.url'), w.config('remote.cred.pushurl')], [[url('one')], ['/push.git']]);
});

// Invariant: an edit of the push url alone leaves the credentialed url as it was in git config.
test('remote.edit of the push url only keeps the credentialed url', async (t) => {
  const w = await world(t);
  await credRemote(w);
  lacksSecrets(await w.call('remote.edit', { name: 'cred', pushUrl: pushUrl('q') }));
  assert.deepEqual([w.config('remote.cred.url'), w.config('remote.cred.pushurl')], [[url('one')], [pushUrl('q')]]);
  lacksSecrets(await w.call('remote.edit', { name: 'cred', pushUrl: null }));
  assert.deepEqual([w.config('remote.cred.url'), w.config('remote.cred.pushurl')], [[url('one')], []]);
});

// Invariant: an edit field that still holds the mask but differs from the current value's mask (another host, path or
// user; or a remote with no push url) is refused BAD_URL before any write: the stored password is never spliced into
// it, and the refusal never echoes a password.
test('remote.edit keeping the mask but changing the url → BAD_URL, nothing written', async (t) => {
  const w = await world(t);
  const before = await credRemote(w);
  for (const params of [
    { url: 'https://user:***@other.invalid/one.git' },
    { url: masked('elsewhere') },
    { url: 'https://other:***@example.invalid/one.git' },
    { pushUrl: 'https://user:***@other.invalid/p.git' },
    { url: masked('one'), pushUrl: masked('one') },
  ]) {
    const body = await w.call('remote.edit', { name: 'cred', ...params }, 400);
    assert.equal(body.code, 'BAD_URL', JSON.stringify(params));
    lacksSecrets(body);
  }
  assert.deepEqual(w.remoteWrites().slice(before), [], 'nothing written');
  assert.deepEqual([w.config('remote.cred.url'), w.config('remote.cred.pushurl')], [[url('one')], [pushUrl('p')]]);
  w.repo.git('config', '--unset-all', 'remote.cred.pushurl');
  assert.equal((await w.call('remote.edit', { name: 'cred', pushUrl: masked('p') }, 400)).code, 'BAD_URL', 'no push url to echo');
  assert.deepEqual(w.config('remote.cred.pushurl'), []);
});

// Invariant: remote.add refuses a url or push url that holds the mask BAD_URL, before any remote is written.
test('remote.add with a masked url or push url → BAD_URL before any remote write', async (t) => {
  const w = await world(t);
  for (const params of [{ url: masked('one') }, { url: '/srv/r.git', pushUrl: masked('p') }]) {
    const body = await w.call('remote.add', { name: 'pasted', ...params }, 400);
    assert.equal(body.code, 'BAD_URL', JSON.stringify(params));
  }
  assert.deepEqual(w.remoteWrites(), []);
  assert.deepEqual(w.config('remote.pasted.url'), []);
});

// Invariant: the unchanged rule fires only on a single-valued list: the mask of one value of a multi-valued url or push
// url list is still refused REMOTE_CONFIG_UNSUPPORTED, as any edit of that list is.
test('remote.edit with the masked url of a multi-valued list still refuses REMOTE_CONFIG_UNSUPPORTED', async (t) => {
  const w = await world(t);
  w.repo.git('remote', 'add', 'multi', url('one'));
  w.repo.git('config', '--add', 'remote.multi.url', url('two'));
  w.repo.git('config', '--add', 'remote.multi.pushurl', pushUrl('p'));
  w.repo.git('config', '--add', 'remote.multi.pushurl', pushUrl('q'));
  for (const params of [{ url: masked('one') }, { url: masked('two') }, { pushUrl: masked('p') }]) {
    const body = await w.call('remote.edit', { name: 'multi', ...params }, 409);
    assert.equal(body.code, 'REMOTE_CONFIG_UNSUPPORTED', JSON.stringify(params));
    lacksSecrets(body);
  }
  assert.deepEqual(w.remoteWrites(), []);
});

// Invariant: an edit that wrote nothing (every field echoed unchanged) records no undo entry, so the slots it cleared stay
// empty; an edit that wrote something is recorded.
test('remote.edit that ends up writing nothing records no undo entry', async (t) => {
  const w = await world(t);
  await credRemote(w);
  assert.ok((await w.call('undo.state')).result.undo, 'the add is undoable');
  await w.call('remote.edit', { name: 'cred', url: masked('one'), pushUrl: masked('p') });
  assert.deepEqual((await w.call('undo.state')).result, { undo: null, redo: null });
  await w.call('remote.edit', { name: 'cred', url: masked('one'), pushUrl: '/push.git' });
  assert.equal((await w.call('undo.state')).result.undo.label, 'Edit remote cred');
});
