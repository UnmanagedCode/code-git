import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getOp, OPS } from '../src/git/ops/index.js';
import { refused } from './_ops.js';
import { LFS_CMD, LFS_HOOKS, LFS_PROBE, LFS_SKIP, lfsAvailable, lfsWorld, runsLfs, strippedWorld } from './_lfs.js';

const HAVE_LFS = lfsAvailable();
const WRITES = [['lfs.files', {}], ['lfs.track', { pattern: '*.dat' }], ['lfs.untrack', { pattern: '*.bin' }], ['lfs.pull', {}], ['lfs.prune', {}]];
const ATTR_LINE = (p) => `${p} filter=lfs diff=lfs merge=lfs -text`;
const exists = (p) => fs.existsSync(p);

test('absence: with no git-lfs on the System PATH, status answers available: false and every write refuses LFS_UNAVAILABLE, running nothing after `lfs version`', async (t) => {
  const w = await strippedWorld(t);
  assert.deepEqual(await w.op('lfs.status', {}), {
    available: false, version: null, supported: false, filters: null, attributes: null, patterns: null,
  });
  assert.deepEqual(w.argvs(), [LFS_PROBE]);
  for (const [name, params] of WRITES) {
    const before = w.argvs().length;
    await assert.rejects(w.op(name, params), refused('LFS_UNAVAILABLE'), name);
    const ran = w.argvs().slice(before);
    assert.deepEqual(ran.at(-1), LFS_PROBE, `${name}: lfs version is the last command`);
  }
});

test("a repo's `alias.lfs` never runs on a System without git-lfs: the probe empties it, and git's failed expansion reads as available: false", async (t) => {
  const w = await strippedWorld(t);
  const marker = path.join(w.repo.root, 'alias-ran');
  w.repo.git('config', 'alias.lfs', `!echo ALIASED > ${marker}`);
  assert.deepEqual(await w.op('lfs.status', {}), {
    available: false, version: null, supported: false, filters: null, attributes: null, patterns: null,
  });
  await assert.rejects(w.op('lfs.pull', {}), refused('LFS_UNAVAILABLE'));
  assert.equal(exists(marker), false, 'the alias did not run');
  assert.ok(w.argvs().every((a) => !a.includes('lfs') || a.join(' ') === LFS_PROBE.join(' ')), 'only the probe reached git');
});

test('params: track and untrack take a checked pattern (BAD_PARAMS otherwise); status, files, pull and prune take none', () => {
  for (const name of ['lfs.track', 'lfs.untrack']) {
    assert.deepEqual(getOp(OPS, name).params({ pattern: '*.psd' }), { pattern: '*.psd' });
    for (const bad of [{}, { pattern: '-x' }, { pattern: '#x' }, { pattern: 'a\nb' }, { pattern: '*.psd', extra: 1 }]) {
      assert.throws(() => getOp(OPS, name).params(bad), refused('BAD_PARAMS'), `${name} ${JSON.stringify(bad)}`);
    }
  }
  for (const name of ['lfs.status', 'lfs.files', 'lfs.pull', 'lfs.prune']) {
    assert.deepEqual(getOp(OPS, name).params({}), {});
    assert.throws(() => getOp(OPS, name).params({ x: 1 }), refused('BAD_PARAMS'), name);
  }
  assert.equal(OPS.get('lfs.status').kind, 'read');
  assert.equal(OPS.get('lfs.files').kind, 'write', 'git-lfs ls-files may write .git/lfs and hooks');
  assert.equal(OPS.get('lfs.files').journal, 'neutral', 'listing files keeps the undo slots');
  for (const name of ['lfs.track', 'lfs.untrack', 'lfs.pull', 'lfs.prune']) assert.equal(OPS.get(name).cancellable, false, name);
});

test('a git-lfs below 3.2.0: status reports its version as unsupported; writes refuse GIT_TOO_OLD {feature, need, have}', async (t) => {
  const w = await strippedWorld(t, { stub: '#!/bin/sh\necho "git-lfs/3.1.4 (GitHub; linux amd64; go 1.17)"\n' });
  assert.deepEqual(await w.op('lfs.status', {}), {
    available: true, version: '3.1.4', supported: false, filters: null, attributes: null, patterns: null,
  });
  for (const [name, params] of WRITES) {
    await assert.rejects(w.op(name, params), refused('GIT_TOO_OLD'), name);
    await assert.rejects(w.op(name, params), (e) => {
      assert.deepEqual(e.extra, { feature: 'git-lfs', need: '3.2.0', have: '3.1.4' });
      return true;
    });
  }
});

test('a git-lfs whose version line does not parse is GIT_FAILED, not a guess', async (t) => {
  const w = await strippedWorld(t, { stub: '#!/bin/sh\necho "something else"\n' });
  await assert.rejects(w.op('lfs.status', {}), refused('GIT_FAILED'));
});

test('status lists the root .gitattributes patterns and the filter config, and leaves .git byte-identical (no hook, no .git/lfs)', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  w.stripLfsState();
  const before = w.snapshotGitDir();
  const s = await w.op('lfs.status', {});
  assert.equal(s.available, true);
  assert.match(s.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual({ ...s, version: null }, { available: true, version: null, supported: true, filters: true, attributes: 'ok', patterns: ['*.bin'] });
  assert.deepEqual(w.snapshotGitDir(), before, '.git unchanged');
  for (const h of LFS_HOOKS) assert.equal(exists(path.join(w.gitDir, 'hooks', h)), false, h);
  // Only `lfs version` reaches git-lfs: every other read is plain git.
  assert.deepEqual(w.argvs().filter((a) => a.includes('lfs')), [LFS_PROBE]);
  w.repo.git('config', '--global', '--unset', 'filter.lfs.process');
  assert.equal((await w.op('lfs.status', {})).filters, false);
});

test('status never reads through a symlinked .gitattributes: attributes unsupported, patterns null; track and untrack refuse ATTRIBUTES_UNSUPPORTED, the target unchanged', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  const outside = path.join(w.repo.root, 'outside-attributes');
  fs.writeFileSync(outside, `${ATTR_LINE('*.secret')}\n`);
  fs.rmSync(path.join(w.repo.dir, '.gitattributes'));
  fs.symlinkSync(outside, path.join(w.repo.dir, '.gitattributes'));
  const s = await w.op('lfs.status', {});
  assert.equal(s.attributes, 'unsupported');
  assert.equal(s.patterns, null);
  await assert.rejects(w.op('lfs.track', { pattern: '*.dat' }), refused('ATTRIBUTES_UNSUPPORTED'));
  await assert.rejects(w.op('lfs.untrack', { pattern: '*.secret' }), refused('ATTRIBUTES_UNSUPPORTED'));
  assert.equal(fs.readFileSync(outside, 'utf8'), `${ATTR_LINE('*.secret')}\n`);
  assert.equal(w.argvs().some((a) => runsLfs(a, 'track') || runsLfs(a, 'untrack')), false);
});

test('files lists every LFS file with size, oid and whether its object is downloaded', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  const { files } = await w.op('lfs.files', {});
  assert.equal(files.length, 1);
  assert.deepEqual({ ...files[0], oid: null }, { path: 'a.bin', size: 4, oid: null, downloaded: false });
  assert.match(files[0].oid, /^[0-9a-f]{64}$/);
});

test('track adds a filter=lfs line to the root .gitattributes and status lists it; untrack removes it (removed: true), an unknown pattern is removed: false', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  assert.deepEqual(await w.op('lfs.track', { pattern: '*.dat' }), { pattern: '*.dat' });
  assert.ok(fs.readFileSync(path.join(w.repo.dir, '.gitattributes'), 'utf8').split('\n').includes(ATTR_LINE('*.dat')));
  assert.deepEqual((await w.op('lfs.status', {})).patterns, ['*.bin', '*.dat']);
  assert.deepEqual(await w.op('lfs.untrack', { pattern: '*.dat' }), { pattern: '*.dat', removed: true });
  assert.deepEqual((await w.op('lfs.status', {})).patterns, ['*.bin']);
  assert.deepEqual(await w.op('lfs.untrack', { pattern: '*.nope' }), { pattern: '*.nope', removed: false });
  const runs = w.argvs().filter((a) => runsLfs(a, 'track') || runsLfs(a, 'untrack'));
  assert.deepEqual(runs.map((a) => a.slice(LFS_CMD.length + 1)), [['--', '*.dat'], ['--', '*.dat'], ['--', '*.nope']], 'the pattern follows --');
});

test('pull downloads the objects over the file transfer: the pointer becomes the original bytes and files reports downloaded', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  assert.match(fs.readFileSync(path.join(w.repo.dir, 'a.bin'), 'utf8'), /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
  assert.deepEqual(await w.op('lfs.pull', {}), {});
  assert.equal(fs.readFileSync(path.join(w.repo.dir, 'a.bin'), 'utf8'), 'one\n');
  // Under the runner's GIT_LITERAL_PATHSPECS=1 git-lfs's pull checks nothing out and still exits 0.
  assert.deepEqual(w.argvs().find((a) => runsLfs(a, 'pull')), [...LFS_CMD, 'pull']);
  assert.equal((await w.op('lfs.files', {})).files[0].downloaded, true);
  assert.deepEqual(w.repo.git('status', '--porcelain'), '', 'the checkout stays clean');
});

test("prune deletes an object only an old pushed commit references and keeps HEAD's", { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  w.repo.git('lfs', 'fetch', '--all', 'origin');
  w.repo.git('lfs', 'pull');
  assert.equal(exists(w.objectPath('old\n')), true);
  assert.equal(exists(w.objectPath('one\n')), true);
  assert.deepEqual(await w.op('lfs.prune', {}), {});
  assert.equal(exists(w.objectPath('old\n')), false, 'old.bin, referenced only by the first commit, is pruned');
  assert.equal(exists(w.objectPath('one\n')), true, "HEAD's a.bin is kept");
});

test("git-lfs's own side effect on the writes, from a smudge-skipped clone with no LFS hooks: each creates .git/lfs/tmp and installs the four hooks (pull through the checkout it makes)", { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  for (const [name, params] of WRITES) {
    const w = await lfsWorld(t);
    w.stripLfsState();
    await w.op(name, params);
    for (const h of LFS_HOOKS) assert.equal(exists(path.join(w.gitDir, 'hooks', h)), true, `${name}: ${h}`);
    assert.equal(exists(path.join(w.gitDir, 'lfs', 'tmp')), true, `${name}: .git/lfs/tmp`);
  }
});

test('a foreign hook at one of those names blocks every LFS hook install; the foreign hook is kept and the op still succeeds', { skip: !HAVE_LFS && LFS_SKIP }, async (t) => {
  const w = await lfsWorld(t);
  w.stripLfsState();
  w.repo.hook('pre-push', '#!/bin/sh\necho mine\n');
  await w.op('lfs.track', { pattern: '*.foreign' });
  assert.equal(fs.readFileSync(path.join(w.gitDir, 'hooks', 'pre-push'), 'utf8'), '#!/bin/sh\necho mine\n');
  for (const h of LFS_HOOKS.filter((x) => x !== 'pre-push')) assert.equal(exists(path.join(w.gitDir, 'hooks', h)), false, h);
});
