import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFlowConfig } from '../src/git/flow/config.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refsWorld } from './_refsWorld.js';

const read = (w) => readFlowConfig(gitFor(ctxFor({ project: 'repo' })));

test('readFlowConfig reads the nvie/AVH keys; initialized needs both branches and the three type prefixes, not the version-tag prefix', async (t) => {
  const w = await refsWorld(t);
  assert.deepEqual(await read(w), {
    initialized: false, main: null, develop: null, prefixes: { feature: null, release: null, hotfix: null, versionTag: null },
  });
  w.repo.git('config', 'gitflow.branch.master', 'main');
  w.repo.git('config', 'gitflow.branch.develop', 'develop');
  w.repo.git('config', 'gitflow.prefix.feature', 'feat/');
  w.repo.git('config', 'gitflow.prefix.release', 'rel/');
  assert.equal((await read(w)).initialized, false, 'no hotfix prefix yet');
  w.repo.git('config', 'gitflow.prefix.hotfix', 'fix/');
  assert.deepEqual(await read(w), {
    initialized: true, main: 'main', develop: 'develop', prefixes: { feature: 'feat/', release: 'rel/', hotfix: 'fix/', versionTag: null },
  });
  // An empty value is a value (`versiontag =`); a repeated key's last value wins, as git's own reads do.
  w.repo.git('config', 'gitflow.prefix.versiontag', '');
  w.repo.git('config', '--add', 'gitflow.prefix.feature', 'f/');
  const c = await read(w);
  assert.equal(c.prefixes.versionTag, '');
  assert.equal(c.prefixes.feature, 'f/');
});

test('flow.config defaults: main is `main` if it exists, else `master`, else HEAD\'s branch, else null', async (t) => {
  const w = await refsWorld(t);
  const defaults = async () => (await w.op('flow.config', {})).defaults;
  assert.deepEqual(await defaults(), {
    main: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' },
  });
  w.repo.git('branch', 'master');
  assert.equal((await defaults()).main, 'main');
  w.repo.git('branch', '-m', 'main', 'trunk');
  assert.equal((await defaults()).main, 'master');
  w.repo.git('branch', '-D', 'master');
  assert.equal((await defaults()).main, 'trunk', "HEAD's branch");
  w.repo.git('checkout', '-q', '--detach');
  assert.equal((await defaults()).main, null);
});
