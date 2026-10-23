import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refEntries, refObjects } from '../src/git/refs/resolve.js';
import { ctxFor, gitFor } from './_ctx.js';
import { fakeCc } from './_fakeCc.js';
import { makeRepo } from './_git.js';

// Invariant: refEntries passes its names after --end-of-options: an option-looking name (from repo config) matches
// nothing and never fails the command, while real names still resolve.
test('refEntries: an option-looking name is a pattern, not an option', async (t) => {
  const repo = makeRepo(t);
  const a = repo.commit({ 'a.txt': 'a\n' });
  const cc = await fakeCc({ projects: { repo: { dir: repo.dir } }, home: repo.home });
  t.after(() => cc.close());
  const git = gitFor(ctxFor({ project: 'repo' }, 'read'));
  assert.deepEqual([...(await refEntries(git, ['--help', 'refs/heads/main']))], [['refs/heads/main', { oid: a, symref: null }]]);
  assert.deepEqual([...(await refObjects(git, ['--help']))], []);
  const argv = cc.state.execCalls.at(-1).argv;
  assert.ok(argv.indexOf('--end-of-options') < argv.indexOf('--help'));
});
