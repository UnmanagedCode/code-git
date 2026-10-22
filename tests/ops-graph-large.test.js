import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { PAGE_MAX } from '../src/git/ops/graph.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { buildGraphFixture, FIXTURE_DEFAULTS } from './_graphFixture.js';
import { makeRepo } from './_git.js';

// The perf fixture (docs/graph.md → Performance), paged end to end through the ops.

const run = async (name, raw) => {
  const op = getOp(OPS, name);
  return op.run(gitFor(ctxFor({ project: 'big' }, op.kind, { op: name })), op.params(raw));
};

test('the perf fixture pages completely: every commit of the tips exactly once, children before parents', async (t) => {
  const repo = makeRepo(t);
  const built = buildGraphFixture(repo.dir, repo.home);
  assert.deepEqual(built, { heads: FIXTURE_DEFAULTS.branches + 1, remotes: FIXTURE_DEFAULTS.branches + 1, tags: FIXTURE_DEFAULTS.tags, commits: FIXTURE_DEFAULTS.commits, branchesCreated: FIXTURE_DEFAULTS.branches });
  const cc = await fakeCc({ projects: { big: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());

  const { refs } = await run('graph.refs');
  assert.equal(refs.length, built.heads + built.remotes + built.tags);
  assert.equal(Number(repo.git('rev-list', '--merges', '--count', '--all')), FIXTURE_DEFAULTS.merged);
  const tips = [...new Set(refs.map((r) => r.oid))];
  const items = [];
  let skip = 0;
  for (;;) {
    const page = await run('graph.page', { tips, skip, limit: PAGE_MAX });
    items.push(...page.items);
    if (page.nextCursor === null) break;
    skip = page.nextCursor;
  }
  assert.equal(items.length, Number(repo.git('rev-list', '--count', '--all')));
  assert.equal(items.length, FIXTURE_DEFAULTS.commits);
  const pos = new Map(items.map((c, i) => [c.oid, i]));
  assert.equal(pos.size, items.length, 'no duplicates');
  for (const c of items) for (const p of c.parents) assert.ok(pos.get(p) > pos.get(c.oid), `${c.oid} before its parent ${p}`);
  assert.deepEqual(cc.state.violations, []);
});

test('the fixture is deterministic: the same seed writes the same history', (t) => {
  const a = makeRepo(t, { name: 'a' });
  const b = makeRepo(t, { name: 'b' });
  const opts = { commits: 300, branches: 6, merged: 4, tags: 5 };
  buildGraphFixture(a.dir, a.home, opts);
  buildGraphFixture(b.dir, b.home, opts);
  const refs = (r) => r.git('for-each-ref', '--format=%(refname) %(objectname)');
  assert.equal(refs(a), refs(b));
  assert.notEqual(refs(a), (() => { const c = makeRepo(t, { name: 'c' }); buildGraphFixture(c.dir, c.home, { ...opts, seed: 7 }); return refs(c); })());
});
