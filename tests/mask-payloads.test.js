import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refsWorld } from './_refsWorld.js';
import { subWorld } from './_submodules.js';

// A url password never leaves the backend: in any string of a refusal's body, and in the success payloads that carry
// git's own stderr (a partial fetch, a failed remote of a fetch-all, the graph's worktree listing error).

const PW = 'hunter2-secret';
const credUrl = `https://user:${PW}@example.invalid/x`;
const failWith = (stderr, exitCode = 128) => ({ status: 200, body: { exitCode, stdout: '', stderr: Buffer.from(stderr).toString('base64'), encoding: 'base64', durationMs: 1 } });

test("a refusal's message and lists are masked: a credentialed branch remote echoed by submodule.add's relative-url gate", async (t) => {
  const w = await subWorld(t, { nested: false });
  w.repo.git('config', 'branch.main.remote', credUrl);
  const r = await w.op('submodule.add', { url: '../x.git', path: 'x' });
  assert.deepEqual([r.status, r.body.code, r.body.reason], [409, 'SUBMODULE_UNSAFE', 'url']);
  assert.equal(JSON.stringify(r.body).includes(PW), false);
  assert.match(r.body.error, /user:\*\*\*@example\.invalid/);
  assert.deepEqual(r.body.names, ['https://user:***@example.invalid/x']);
});

test("a partial fetch's stderr is masked in the result", async (t) => {
  const w = await refsWorld(t);
  const moved = w.repo.git('commit-tree', '-p', 'HEAD', '-m', 'fetched', 'HEAD^{tree}');
  // git moves a ref, then fails: the fetch's own stderr names a credentialed url.
  w.cc.state.execHook = (b) => {
    if (!b.argv.includes('fetch')) return undefined;
    w.repo.git('update-ref', 'refs/remotes/origin/main', moved);
    return failWith(`error: cannot lock ref; fatal: unable to update from ${credUrl}\n`, 1);
  };
  const r = await w.op('remote.fetch', { remote: 'origin' });
  assert.equal(r.remotes[0].changes.length, 1);
  assert.match(r.remotes[0].partial, /user:\*\*\*@/);
  assert.equal(JSON.stringify(r).includes(PW), false);
});

test("a failed remote of a fetch-all reports a masked error (message and stderr)", async (t) => {
  const w = await refsWorld(t);
  w.cc.state.execHook = (b) => (b.argv.includes('fetch') ? failWith(`fatal: unable to access '${credUrl}/': Could not resolve host: example.invalid\n`) : undefined);
  const r = await w.op('remote.fetch', { remote: null });
  const failed = r.remotes.find((x) => x.error);
  assert.ok(failed);
  assert.match(failed.error.stderr, /user:\*\*\*@/);
  assert.equal(JSON.stringify(r).includes(PW), false);
});

test("graph.refs' worktreesError is masked", async (t) => {
  const w = await refsWorld(t);
  w.cc.state.execHook = (b) => (b.argv.includes('worktree') ? failWith(`error: ${credUrl} is not a worktree\n`, 129) : undefined);
  const def = getOp(OPS, 'graph.refs');
  const ctx = ctxFor({ project: 'repo', worktree: null }, 'read', { op: 'graph.refs', cancellable: true });
  const r = await def.run(gitFor(ctx), def.params(undefined), { target: ctx.target });
  assert.equal(r.worktrees, null);
  assert.match(r.worktreesError, /user:\*\*\*@/);
  assert.equal(r.worktreesError.includes(PW), false);
});

test('a user name holding @ through submodule.add: the activity argv and stderr never show the password', async (t) => {
  const w = await subWorld(t, { nested: false });
  const url = `http://a@b:${PW}@127.0.0.1:1/r.git`;
  const r = await w.op('submodule.add', { url, path: 'x' });
  assert.notEqual(r.status, 200);
  assert.equal(JSON.stringify(r.body).includes(PW), false);
  const log = (await w.app.call('GET', '/api/activity')).body;
  assert.equal(JSON.stringify(log).includes(PW), false);
  assert.ok(log.entries.some((e) => e.op === 'submodule.add' && e.argv.includes('http://a@b:***@127.0.0.1:1/r.git')));
});
