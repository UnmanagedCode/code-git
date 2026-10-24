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
