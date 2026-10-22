import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityLog } from '../src/activity/log.js';
import { createLocks } from '../src/git/locks.js';
import { BASE_ARGS, runGit } from '../src/git/runner.js';
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
  assert.deepEqual(BASE_ARGS, ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false']);
});

test('the base env makes git non-interactive and literal; GIT_OPTIONAL_LOCKS=0 on reads only', async (t) => {
  const { cc } = await world(t);
  await runGit(ctxFor(APP, 'read'), ['status']);
  await runGit(ctxFor(APP, 'write'), ['status']);
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

test("an op's env is merged in but cannot re-enable prompts", async (t) => {
  const { cc } = await world(t);
  await runGit(ctxFor(APP), ['status'], { env: { GIT_TERMINAL_PROMPT: '1', GCM_INTERACTIVE: 'always', GIT_EDITOR: 'true', MY_VAR: 'x' } });
  const { env } = cc.state.execCalls[0];
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GCM_INTERACTIVE, 'never');
  assert.equal(env.GIT_EDITOR, 'true', 'a later card may set its own editor');
  assert.equal(env.MY_VAR, 'x');
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

test('writes on one project are serialized; reads and other projects are not held behind them', async (t) => {
  const { cc } = await world(t);
  cc.state.execHook = () => 'hold';
  const activity = createActivityLog();
  const locks = createLocks();
  const ctx = (target, kind) => ctxFor(target, kind, { activity, locks });
  const tagged = (target, kind, tag) => runGit(ctx(target, kind), ['status'], { env: { CG_TAG: tag } });
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
