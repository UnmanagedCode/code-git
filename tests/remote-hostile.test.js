import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { refsWorld } from './_refsWorld.js';
import { assertNetPinned } from './_remotes.js';

// A repo's config can route a remote to the `ext::` transport (which runs any command) or `fd::`: `protocol.allow` /
// `protocol.<name>.allow`, and an `insteadOf` rewriting the remote's url. Every network command pins both off (NET_CONFIG).

/** Each network op, run against remote `evil` (its tag/branch `x` exists locally and is pushed or fetched). */
const NETWORK_OPS = {
  'tag.push': (w) => w.op('tag.push', { remote: 'evil', names: ['x'] }),
  'tag.deleteRemote': (w) => w.op('tag.deleteRemote', { remote: 'evil', names: ['x'] }),
  'branch.deleteRemote': (w) => w.op('branch.deleteRemote', { remote: 'evil', branches: ['x'] }),
  'remote.fetch': (w) => w.op('remote.fetch', { remote: 'evil' }),
  'remote.fetch (every remote)': async (w) => {
    const r = await w.op('remote.fetch', { remote: null });
    throw Object.assign(new Error('per remote'), { extra: { stderr: r.remotes.find((x) => x.remote === 'evil').error.stderr } });
  },
  'remote.peek': (w) => w.op('remote.peek', { remote: 'evil', branch: 'x' }),
  'remote.push': (w) => w.op('remote.push', { branch: 'x', remote: 'evil' }),
  'remote.pull': (w) => {
    w.repo.git('config', 'branch.main.remote', 'evil');
    return w.op('remote.pull', { mode: 'ff' });
  },
};

/** refsWorld with remote `evil` whose url the repo's config rewrites to `ext::sh -c touch <marker>`; branch and tag `x`. */
async function evilWorld(t, transport) {
  const w = await refsWorld(t);
  const marker = path.join(w.repo.root, 'ext-ran');
  w.repo.git('branch', 'x');
  w.repo.git('tag', 'x');
  w.repo.git('remote', 'add', 'evil', 'http://evil.invalid/r.git');
  w.repo.git('config', 'protocol.allow', 'always');
  w.repo.git('config', `protocol.${transport}.allow`, 'always');
  const to = transport === 'ext' ? `ext::sh -c touch% ${marker}% #` : 'fd::7';
  w.repo.git('config', `url.${to}.insteadOf`, 'http://evil.invalid/');
  return { w, marker };
}

test('the fixture is live: plain git, without the pin, runs the ext:: command', async (t) => {
  const { w, marker } = await evilWorld(t, 'ext');
  try { w.repo.git('push', 'evil', 'refs/tags/x'); } catch { /* the command is not a git server */ }
  assert.equal(fs.existsSync(marker), true);
});

for (const [name, run] of Object.entries(NETWORK_OPS)) {
  test(`${name}: an insteadOf rewrite to ext:: with protocol.ext.allow=always fails and never runs the command`, async (t) => {
    const { w, marker } = await evilWorld(t, 'ext');
    await assert.rejects(run(w), (e) => /transport 'ext' not allowed/.test(e.extra?.stderr ?? ''));
    assert.equal(fs.existsSync(marker), false, 'the ext:: command never ran');
    assertNetPinned(w.cc.state.execCalls);
  });

  test(`${name}: an insteadOf rewrite to fd:: with protocol.fd.allow=always is refused by git`, async (t) => {
    const { w } = await evilWorld(t, 'fd');
    await assert.rejects(run(w), (e) => /transport 'fd' not allowed/.test(e.extra?.stderr ?? ''));
    assertNetPinned(w.cc.state.execCalls);
  });
}
