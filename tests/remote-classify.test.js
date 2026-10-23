import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRemoteFailure } from '../src/git/parse/push.js';
import { remoteFailure } from '../src/git/remote/net.js';

// git's stderr (LC_ALL=C) of remote commands that failed as a whole, captured from git 2.55 against local servers
// (http 401/403/404, a closed port, an unresolvable host, a missing path) and OpenSSH's wording for key and host-key failures.
const SSH_TAIL = 'fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n';
const FIXTURES = {
  'http 401, no credential helper': ["fatal: could not read Username for 'http://127.0.0.1:18401': terminal prompts disabled\nerror: unable to read askpass response from 'false'\nfatal: could not read Username for 'http://127.0.0.1:18401': terminal prompts disabled\n", 'REMOTE_AUTH_FAILED', 'prompt'],
  'http 401, a helper giving bad credentials': ["fatal: could not read Username for 'http://127.0.0.1:18401': terminal prompts disabled\nfatal: Authentication failed for 'http://127.0.0.1:18401/r.git/'\n", 'REMOTE_AUTH_FAILED', 'credentials'],
  'http 403': ["fatal: unable to access 'http://127.0.0.1:18403/r.git/': The requested URL returned error: 403\n", 'REMOTE_AUTH_FAILED', 'credentials'],
  'http 401 with a body (GitLab)': ["remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://h/r.git/'\n", 'REMOTE_AUTH_FAILED', 'credentials'],
  'a password prompt': ["fatal: could not read Password for 'https://u@h': No such device or address\n", 'REMOTE_AUTH_FAILED', 'prompt'],
  'ssh publickey': [`git@127.0.0.1: Permission denied (publickey).\r\n${SSH_TAIL}`, 'REMOTE_AUTH_FAILED', 'ssh-key'],
  'ssh host key': [`No ED25519 host key is known for [127.0.0.1]:2222 and you have requested strict checking.\r\nHost key verification failed.\r\n${SSH_TAIL}`, 'REMOTE_AUTH_FAILED', 'ssh-host-key'],
  'http unresolvable host': ["fatal: unable to access 'http://nonexistent.invalid/r.git/': Could not resolve host: nonexistent.invalid\n", 'REMOTE_UNREACHABLE', 'dns'],
  'ssh unresolvable host': [`ssh: Could not resolve hostname nonexistent.invalid: Name or service not known\r\n${SSH_TAIL}`, 'REMOTE_UNREACHABLE', 'dns'],
  'ssh connection refused': [`ssh: connect to host 127.0.0.1 port 1: Connection refused\r\n${SSH_TAIL}`, 'REMOTE_UNREACHABLE', 'refused'],
  'http connection refused': ["fatal: unable to access 'http://127.0.0.1:1/r.git/': Failed to connect to 127.0.0.1 port 1 after 0 ms: Could not connect to server\n", 'REMOTE_UNREACHABLE', 'refused'],
  'ssh timeout': [`ssh: connect to host 10.255.255.1 port 22: Connection timed out\r\n${SSH_TAIL}`, 'REMOTE_UNREACHABLE', 'timeout'],
  'a missing path': [`fatal: '/tmp/x/missing.git' does not appear to be a git repository\n${SSH_TAIL}`, 'REMOTE_UNREACHABLE', 'not-found'],
  'http 404': ["fatal: repository 'http://127.0.0.1:18404/r.git/' not found\n", 'REMOTE_UNREACHABLE', 'not-found'],
  'a TLS failure': ["fatal: unable to access 'https://h/': SSL certificate problem: self-signed certificate\n", 'REMOTE_UNREACHABLE', 'unavailable'],
};

test('classifyRemoteFailure: each captured stderr → its code and reason; credential rules win over the prompt and unreachable lines they print beside', () => {
  for (const [name, [stderr, code, reason]] of Object.entries(FIXTURES)) {
    assert.deepEqual(classifyRemoteFailure(stderr), { code, reason }, name);
  }
});

test('classifyRemoteFailure: a hook refusal, a blocked transport or any other git error → null', () => {
  for (const stderr of [
    "error: failed to push some refs to '/tmp/r.git'\npre-push hook said no\n",
    "fatal: transport 'ext' not allowed\n",
    `fatal: couldn't find remote ref refs/heads/nope\n`,
    '',
  ]) assert.equal(classifyRemoteFailure(stderr), null, stderr);
});

test('remoteFailure: a classified failure carries reason, stderr and a message naming the remote and what to set up on the System; else GIT_FAILED with the exit code', () => {
  const r = (stderr, exitCode = 128) => ({ exitCode, stderr: Buffer.from(stderr), stdout: Buffer.alloc(0) });
  const prompt = remoteFailure('origin', r(FIXTURES['http 401, no credential helper'][0]), 'fetch');
  assert.equal(prompt.code, 'REMOTE_AUTH_FAILED');
  assert.equal(prompt.extra.reason, 'prompt');
  assert.equal(prompt.extra.stderr, FIXTURES['http 401, no credential helper'][0]);
  assert.match(prompt.message, /^origin needs credentials and code-git cannot prompt: configure a credential helper or an ssh key\/agent on the project's System$/);
  assert.match(remoteFailure('up', r(FIXTURES['ssh host key'][0]), 'fetch').message, /^up's ssh host key is not trusted.*known_hosts on the project's System$/);
  assert.match(remoteFailure('up', r(FIXTURES['ssh publickey'][0]), 'fetch').message, /^up refused the ssh key.*on the project's System$/);
  assert.match(remoteFailure('up', r(FIXTURES['http 403'][0]), 'fetch').message, /^up refused the credentials.*on the project's System$/);
  const unreachable = remoteFailure('up', r(FIXTURES['ssh connection refused'][0]), 'fetch');
  assert.deepEqual([unreachable.code, unreachable.extra.reason, unreachable.message], ['REMOTE_UNREACHABLE', 'refused', 'up refused the connection']);
  for (const [name, [stderr, code, reason]] of Object.entries(FIXTURES)) {
    const e = remoteFailure('x', r(stderr), 'fetch');
    assert.deepEqual([e.code, e.extra.reason], [code, reason], name);
    assert.ok(e.message.startsWith('x'), name);
  }
  const other = remoteFailure('origin', r('pre-push hook said no\n', 1), 'push');
  assert.equal(other.code, 'GIT_FAILED');
  assert.deepEqual(other.extra, { exitCode: 1, stderr: 'pre-push hook said no\n' });
  assert.equal(other.message, 'git push exited with 1');
});
