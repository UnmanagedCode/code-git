import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityLog } from '../src/activity/log.js';
import { LIMITS } from '../src/git/limits.js';
import { createLocks } from '../src/git/locks.js';
import { BASE_ARGS, runGit, subcommandOf } from '../src/git/runner.js';
import { ctxFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

async function world(t) {
  const repo = makeRepo(t);
  repo.commit({ 'a.txt': 'a\n' });
  const other = makeRepo(t, { name: 'other' });
  other.commit({ 'b.txt': 'b\n' });
  const cc = await fakeCc({ projects: { app: { dir: repo.dir }, other: { dir: other.dir } }, home: repo.home });
  t.after(() => cc.close());
  return { repo, cc };
}

const APP = { project: 'app', worktree: null };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('argv is git + BASE_ARGS + the op args; stdout comes back as bytes', async (t) => {
  const { cc } = await world(t);
  const r = await runGit(ctxFor(APP), ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(r.stdout.toString().trim(), 'main');
  assert.deepEqual(cc.state.execCalls[0].argv, ['git', ...BASE_ARGS, 'rev-parse', '--abbrev-ref', 'HEAD']);
  assert.deepEqual(BASE_ARGS, ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '--work-tree=.']);
});

test('the base env makes git non-interactive and literal; GIT_OPTIONAL_LOCKS=0 on reads only', async (t) => {
  const { cc } = await world(t);
  await runGit(ctxFor(APP, 'read'), ['rev-parse', 'HEAD']);
  await runGit(ctxFor(APP, 'write'), ['rev-parse', 'HEAD']);
  const [read, write] = cc.state.execCalls.map((c) => c.env);
  for (const env of [read, write]) {
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GCM_INTERACTIVE, 'never');
    assert.equal(env.GIT_EDITOR, 'false');
    assert.equal(env.GIT_SEQUENCE_EDITOR, 'false');
    assert.equal(env.GIT_LITERAL_PATHSPECS, '1');
    assert.equal(env.LC_ALL, 'C');
  }
  assert.equal(read.GIT_OPTIONAL_LOCKS, '0');
  assert.equal('GIT_OPTIONAL_LOCKS' in write, false);
});

/** git's trace switches whose output can print a url's userinfo (GIT_TRACE's `run_command: ssh … user:pw@host`) or headers. */
const TRACE_VARS = ['GIT_TRACE', 'GIT_TRACE_PACKET', 'GIT_TRACE_CURL', 'GIT_TRACE_PERFORMANCE', 'GIT_TRACE_SETUP',
  'GIT_TRACE_SHALLOW', 'GIT_TRACE_PACK_ACCESS', 'GIT_TRACE_REFS', 'GIT_TRACE_FSMONITOR'];

/**
 * git's trace2 switches as every exec sets them: its three targets off, no config values or env vars named for logging,
 * and both redactions on. trace2 redacts only `scheme://` urls: its `child_start` prints ssh's `user:password@host`.
 */
const TRACE2_SET = {
  GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0', GIT_TRACE2_CONFIG_PARAMS: '', GIT_TRACE2_ENV_VARS: '',
  GIT_TRACE_REDACT: '1', GIT_TRACE2_REDACT: '1',
};
/** A System env turning every one of them the other way. */
const TRACE2_ON = {
  GIT_TRACE2: '2', GIT_TRACE2_EVENT: '2', GIT_TRACE2_PERF: '2', GIT_TRACE2_CONFIG_PARAMS: 'remote.*.url', GIT_TRACE2_ENV_VARS: 'GIT_SSH_COMMAND',
  GIT_TRACE_REDACT: '0', GIT_TRACE2_REDACT: '0',
};

// Invariant: every exec turns git's trace and trace2 output off (each switch '0', trace2's config-param and env-var lists
// empty, both redactions '1'), over a System env that turns them on, so no trace line (a scheme-less user:password@host)
// reaches stderr; GIT_CURL_VERBOSE, which git reads for presence (any value turns curl's verbose output on), is never in an
// exec's env; an op's env cannot set any of them.
test('the base env turns git trace and trace2 output off over a System env that turns it on; never sets GIT_CURL_VERBOSE; an op cannot set them', async (t) => {
  const { cc } = await world(t);
  cc.state.inheritedEnv = { ...Object.fromEntries(TRACE_VARS.map((n) => [n, '1'])), ...TRACE2_ON };
  const r = await runGit(ctxFor(APP, 'write'), ['rev-parse', 'HEAD']);
  const { env } = cc.state.execCalls[0];
  for (const name of TRACE_VARS) assert.equal(env[name], '0', name);
  for (const [name, value] of Object.entries(TRACE2_SET)) assert.equal(env[name], value, name);
  assert.ok(!('GIT_CURL_VERBOSE' in env), 'GIT_CURL_VERBOSE is not set: git reads it for presence');
  assert.equal(r.stderr.toString(), '', 'no trace output');
  for (const name of [...TRACE_VARS, 'GIT_CURL_VERBOSE', ...Object.keys(TRACE2_SET)]) {
    await assert.rejects(runGit(ctxFor(APP, 'write'), ['rev-parse', 'HEAD'], { env: { [name]: '1' } }), new RegExp(`may not set ${name}`), name);
  }
});

test("an op's env is merged in; GIT_EDITOR and GIT_SEQUENCE_EDITOR stay overridable", async (t) => {
  const { cc } = await world(t);
  await runGit(ctxFor(APP), ['rev-parse', 'HEAD'], { env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'cat', MY_VAR: 'x' } });
  const { env } = cc.state.execCalls[0];
  assert.deepEqual([env.GIT_EDITOR, env.GIT_SEQUENCE_EDITOR, env.MY_VAR], ['true', 'cat', 'x']);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test("an op's env cannot set a protected name: prompts, askpass programs, pathspecs, repo/binary selection, any GIT_SSH* or GIT_CONFIG*; nothing reaches exec", async (t) => {
  const { cc } = await world(t);
  const ctx = ctxFor(APP, 'write');
  const names = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_LITERAL_PATHSPECS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_EXEC_PATH',
    'GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_SSH_VARIANT', 'GIT_SSH_ANYTHING_NEW', 'GIT_ASKPASS', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG'];
  for (const name of names) {
    await assert.rejects(runGit(ctx, ['rev-parse', 'HEAD'], { env: { OK: '1', [name]: 'x' } }), new RegExp(`may not set ${name}`), name);
  }
  assert.equal(cc.state.execCalls.length, 0);
  assert.equal(ctx.activity.list().length, 0, 'no activity entry is opened for a refused env');
  // Look-alikes outside the protected names and prefixes stay settable.
  await runGit(ctx, ['rev-parse', 'HEAD'], { env: { MY_GIT_SSH: '1', SSH_AUTH_SOCK_X: '1', GIT_ASKPASS_HINT: '1', XGIT_CONFIG: '1' } });
  assert.equal(cc.state.execCalls.length, 1);
});

test('paths after -- are literal: a dash-led name and pathspec magic match only themselves', async (t) => {
  const { repo } = await world(t);
  repo.commit({ '-rf': 'x', ':(glob)*': 'y', 'other.txt': 'z' });
  const ls = async (p) => (await runGit(ctxFor(APP), ['ls-files', '-z', '--', p])).stdout.toString().split('\0').filter(Boolean);
  assert.deepEqual(await ls('-rf'), ['-rf']);
  assert.deepEqual(await ls(':(glob)*'), [':(glob)*']);
  assert.deepEqual(await ls('*.txt'), []);
});

test('an exit outside okExit throws GIT_FAILED with the exit code and stderr; okExit widens it', async (t) => {
  const { repo } = await world(t);
  await assert.rejects(runGit(ctxFor(APP), ['rev-parse', '--verify', 'nope']), (e) => {
    assert.equal(e.code, 'GIT_FAILED');
    assert.equal(e.extra.exitCode, 128);
    assert.match(e.extra.stderr, /fatal/);
    return true;
  });
  repo.write('a.txt', 'changed\n');
  await assert.rejects(runGit(ctxFor(APP), ['diff', '--quiet', 'HEAD']), (e) => e.code === 'GIT_FAILED' && e.extra.exitCode === 1);
  const r = await runGit(ctxFor(APP), ['diff', '--quiet', 'HEAD'], { okExit: [0, 1] });
  assert.equal(r.exitCode, 1);
});

test('a GIT_FAILED message names the subcommand, past leading -c pairs', async (t) => {
  await world(t);
  await assert.rejects(runGit(ctxFor(APP), ['rev-parse', '--verify', 'nope']), (e) => e.message === 'git rev-parse exited with 128');
  await assert.rejects(runGit(ctxFor(APP), ['-c', 'a.b=1', '-c', 'c.d=2', 'rev-parse', '--verify', 'nope']), (e) => e.message === 'git rev-parse exited with 128');
  assert.equal(subcommandOf(['-c', 'protocol.ext.allow=never', 'push', '-c']), 'push');
  assert.equal(subcommandOf(['-c', 'protocol.ext.allow=never', '--no-literal-pathspecs', 'lfs', 'pull']), 'lfs', "the LFS ops' pathspec switch");
});

test('writes on one project are serialized; reads and other projects are not held behind them', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => 'hold';
  const activity = createActivityLog();
  const locks = createLocks();
  const ctx = (target, kind) => ctxFor(target, kind, { activity, locks });
  const tagged = (target, kind, tag) => runGit(ctx(target, kind), ['rev-parse', 'HEAD'], { env: { CG_TAG: tag } });
  const tagOf = (h) => h.body.env.CG_TAG;

  const a = tagged(APP, 'write', 'A');
  const heldA = await cc.nextHeld();
  assert.equal(tagOf(heldA), 'A');
  const b = tagged(APP, 'write', 'B');
  const c = tagged(APP, 'read', 'C');
  const d = tagged({ project: 'other' }, 'write', 'D');
  const others = [await cc.nextHeld(), await cc.nextHeld()];
  assert.deepEqual(others.map(tagOf).sort(), ['C', 'D']);
  await tick(50);
  assert.equal(cc.state.execCalls.length, 3, 'the second write on app waits for the first');

  cc.state.execHook = null;
  others.forEach((h) => h.release());
  heldA.release();
  await Promise.all([a, b, c, d]);
  assert.deepEqual(cc.state.execCalls.map((x) => x.env.CG_TAG), ['A', 'C', 'D', 'B']);
});

test('a read is retried after a dropped connection; a write never is', async (t) => {
  const { cc } = await world(t);
  let resets = 1;
  cc.state.execHook = () => (resets-- > 0 ? 'reset' : undefined);
  const r = await runGit(ctxFor(APP, 'read'), ['rev-parse', 'HEAD']);
  assert.equal(r.exitCode, 0);
  assert.equal(cc.state.execCalls.length, 2);
  resets = 1;
  await assert.rejects(runGit(ctxFor(APP, 'write'), ['rev-parse', 'HEAD']), (e) => e.code === 'CONDUCTOR_UNAVAILABLE');
  assert.equal(cc.state.execCalls.length, 3);
});

test('per-kind limits are sent unless the op overrides them', async (t) => {
  const { cc } = await world(t);
  await runGit(ctxFor(APP, 'read'), ['rev-parse', 'HEAD']);
  await runGit(ctxFor(APP, 'write'), ['rev-parse', 'HEAD']);
  await runGit(ctxFor(APP, 'read'), ['rev-parse', 'HEAD'], { timeoutMs: 1234, maxOutputBytes: 5678 });
  const [read, write, custom] = cc.state.execCalls;
  assert.deepEqual([read.timeoutMs, read.maxOutputBytes], [LIMITS.read.timeoutMs, LIMITS.read.maxOutputBytes]);
  assert.deepEqual([write.timeoutMs, write.maxOutputBytes], [LIMITS.write.timeoutMs, LIMITS.write.maxOutputBytes]);
  assert.deepEqual([custom.timeoutMs, custom.maxOutputBytes], [1234, 5678]);
});

test('stdin reaches git as bytes', async (t) => {
  await world(t);
  const r = await runGit(ctxFor(APP, 'write'), ['hash-object', '--stdin'], { stdin: 'hello\n' });
  assert.equal(r.stdout.toString().trim(), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
