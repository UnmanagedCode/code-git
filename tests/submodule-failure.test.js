import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submoduleFailure } from '../src/git/submodule/failure.js';

// What a failed clone, update or sync becomes, by git's (LC_ALL=C) stderr.

const fail = (stderr, exitCode = 1) => submoduleFailure({ exitCode, stderr: Buffer.from(stderr) }, 'submodule update');

test('submoduleFailure: transport policy, checkout over local changes, remote auth/reach, else GIT_FAILED; stderr always kept', () => {
  const cases = [
    ["fatal: transport 'file' not allowed\n", 'SUBMODULE_TRANSPORT_BLOCKED', { transport: 'file' }],
    ["fatal: transport 'ext' not allowed\n", 'SUBMODULE_TRANSPORT_BLOCKED', { transport: 'ext' }],
    ['error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n', 'SUBMODULE_DIRTY', {}],
    ["fatal: could not read Username for 'https://h': terminal prompts disabled\n", 'REMOTE_AUTH_FAILED', {}],
    ["fatal: unable to access 'https://h/r.git/': Could not resolve host: h\n", 'REMOTE_UNREACHABLE', {}],
    ['fatal: something else\n', 'GIT_FAILED', { exitCode: 128 }],
  ];
  for (const [stderr, code, extra] of cases) {
    const e = fail(stderr, extra.exitCode ?? 1);
    assert.equal(e.code, code, stderr);
    assert.equal(e.extra.stderr, stderr);
    for (const [k, v] of Object.entries(extra)) assert.equal(e.extra[k], v);
  }
  assert.match(fail("fatal: transport 'file' not allowed\n").message, /protocol\.file\.allow/);
});
