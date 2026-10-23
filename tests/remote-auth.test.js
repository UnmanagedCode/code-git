import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { OPS } from '../src/git/ops/index.js';
import { BASE_ENV, READ_ENV } from '../src/git/runner.js';
import { refsWorld, refused } from './_refsWorld.js';
import { authServer, NO_HTTP, netCalls, within } from './_remotes.js';

// Real git against servers that demand credentials, for every network op: prompts are off (BASE_ENV), so each fails
// fast with REMOTE_AUTH_FAILED and a reason instead of waiting on a prompt; the System's credential helper still runs.

const FAST_MS = 15_000;

/** Each network op against remote `locked`: `setup(w)` once the remote exists, `run(w)` the op. */
const CALLERS = {
  'tag.push': { setup: (w) => w.repo.git('tag', 'v1', w.base), run: (w) => w.op('tag.push', { remote: 'locked', names: ['v1'] }) },
  'remote.fetch': { setup: () => {}, run: (w) => w.op('remote.fetch', { remote: 'locked' }) },
  'remote.peek': { setup: () => {}, run: (w) => w.op('remote.peek', { remote: 'locked', branch: 'main' }) },
};

async function lockedWorld(t, url) {
  const w = await refsWorld(t);
  w.repo.git('remote', 'add', 'locked', url);
  return w;
}

for (const [name, { setup, run }] of Object.entries(CALLERS)) {
  test(`${name}: a 401 with no credential helper → REMOTE_AUTH_FAILED (prompt) at once; the env is exactly BASE_ENV (+ READ_ENV for a read)`, { skip: NO_HTTP }, async (t) => {
    const w = await lockedWorld(t, `${await authServer(t, 401)}/r.git`);
    await setup(w);
    await assert.rejects(within(run(w), FAST_MS, name), refused('REMOTE_AUTH_FAILED', { reason: 'prompt' }));
    const env = OPS.get(name.split(' ')[0]).kind === 'read' ? { ...BASE_ENV, ...READ_ENV } : BASE_ENV;
    for (const b of netCalls(w.cc.state.execCalls)) assert.deepEqual(b.env, env);
  });

  test(`${name}: a 403 → REMOTE_AUTH_FAILED (credentials), not unreachable`, { skip: NO_HTTP }, async (t) => {
    const w = await lockedWorld(t, `${await authServer(t, 403)}/r.git`);
    await setup(w);
    await assert.rejects(within(run(w), FAST_MS, name), refused('REMOTE_AUTH_FAILED', { reason: 'credentials' }));
  });

  test(`${name}: the System's credential helper runs; credentials the remote refuses → REMOTE_AUTH_FAILED (credentials)`, { skip: NO_HTTP }, async (t) => {
    const w = await lockedWorld(t, `${await authServer(t, 401)}/r.git`);
    const ran = path.join(w.repo.root, 'helper-ran');
    w.repo.git('config', 'credential.helper', `!f() { touch '${ran}'; echo username=u; echo password=wrong; }; f`);
    await setup(w);
    await assert.rejects(within(run(w), FAST_MS, name), refused('REMOTE_AUTH_FAILED', { reason: 'credentials' }));
    assert.equal(fs.existsSync(ran), true, 'the credential helper ran');
  });

  test(`${name}: a hanging askpass inherited from the System's environment never runs`, { skip: NO_HTTP }, async (t) => {
    const w = await lockedWorld(t, `${await authServer(t, 401)}/r.git`);
    const marker = path.join(w.repo.root, 'askpass-ran');
    const askpass = path.join(w.repo.root, 'askpass.sh');
    fs.writeFileSync(askpass, `#!/bin/sh\ntouch '${marker}'\nexec sleep 60\n`, { mode: 0o755 });
    w.cc.state.inheritedEnv = { GIT_ASKPASS: askpass, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force' };
    await setup(w);
    await assert.rejects(within(run(w), FAST_MS, name), refused('REMOTE_AUTH_FAILED'));
    assert.equal(fs.existsSync(marker), false, 'the inherited askpass never ran');
  });
}

test('real ssh to a closed local port → REMOTE_UNREACHABLE (refused)', async (t) => {
  const w = await lockedWorld(t, 'ssh://git@127.0.0.1:1/r.git');
  w.repo.git('config', 'core.sshCommand', 'ssh -F /dev/null -o BatchMode=yes');
  await CALLERS['tag.push'].setup(w);
  await assert.rejects(within(CALLERS['tag.push'].run(w), FAST_MS, 'ssh'), refused('REMOTE_UNREACHABLE', { reason: 'refused' }));
});

// OpenSSH's own stderr for a refused key and an unknown host key (no sshd here: a core.sshCommand replays it, so git's
// handling of an ssh failure is real and only the server side is canned).
const SSH_STDERR = {
  'ssh-key': 'git@127.0.0.1: Permission denied (publickey).\r\n',
  'ssh-host-key': 'No ED25519 host key is known for 127.0.0.1 and you have requested strict checking.\r\nHost key verification failed.\r\n',
};
for (const [reason, stderr] of Object.entries(SSH_STDERR)) {
  test(`an ssh transport failing with OpenSSH's ${reason} message → REMOTE_AUTH_FAILED (${reason})`, async (t) => {
    const w = await lockedWorld(t, 'ssh://git@127.0.0.1/r.git');
    const script = path.join(w.repo.root, 'fake-ssh.sh');
    fs.writeFileSync(script, `#!/bin/sh\nprintf '%s' '${stderr}' >&2\nexit 255\n`, { mode: 0o755 });
    w.repo.git('config', 'core.sshCommand', script);
    await CALLERS['tag.push'].setup(w);
    await assert.rejects(within(CALLERS['tag.push'].run(w), FAST_MS, 'ssh'), refused('REMOTE_AUTH_FAILED', { reason }));
  });
}

// RUN_REAL_SSH=1 REAL_SSH_URL=ssh://user@host/path: real ssh to a real server, with no key and an empty known_hosts.
const REAL_SSH = process.env.RUN_REAL_SSH === '1' && process.env.REAL_SSH_URL;
test('real ssh (RUN_REAL_SSH=1, REAL_SSH_URL): an unknown host key, then (host accepted) no key, each fail fast with its reason', { skip: !REAL_SSH && 'set RUN_REAL_SSH=1 and REAL_SSH_URL' }, async (t) => {
  const w = await lockedWorld(t, process.env.REAL_SSH_URL);
  const knownHosts = path.join(w.repo.root, 'known_hosts');
  const ssh = (strict) => `ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o IdentityAgent=none -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=${strict}`;
  await CALLERS['tag.push'].setup(w);
  w.repo.git('config', 'core.sshCommand', ssh('yes'));
  await assert.rejects(within(CALLERS['tag.push'].run(w), FAST_MS, 'ssh'), refused('REMOTE_AUTH_FAILED', { reason: 'ssh-host-key' }));
  w.repo.git('config', 'core.sshCommand', ssh('accept-new'));
  await assert.rejects(within(CALLERS['tag.push'].run(w), FAST_MS, 'ssh'), refused('REMOTE_AUTH_FAILED', { reason: 'ssh-key' }));
});
