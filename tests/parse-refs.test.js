import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitRemoteRef } from '../src/git/parse/graph.js';
import { parsePushPorcelain, splitRequested } from '../src/git/parse/push.js';
import { parseConflictFiles, parseTracking } from '../src/git/parse/refs.js';

const rec = (...fields) => `${fields.join('\0')}\n`;

test('parseTracking reads every upstream:track form: both counts, ahead only, behind only, gone, in sync, no upstream', () => {
  const out = rec('refs/heads/both', 'refs/remotes/origin/both', 'ahead 3, behind 2')
    + rec('refs/heads/ahead', 'refs/remotes/origin/ahead', 'ahead 12')
    + rec('refs/heads/behind', 'refs/remotes/origin/behind', 'behind 7')
    + rec('refs/heads/gone', 'refs/remotes/origin/gone', 'gone')
    + rec('refs/heads/sync', 'refs/remotes/origin/sync', '')
    + rec('refs/heads/none', '', '');
  assert.deepEqual(parseTracking(out), {
    'refs/heads/both': { upstream: 'refs/remotes/origin/both', ahead: 3, behind: 2, gone: false },
    'refs/heads/ahead': { upstream: 'refs/remotes/origin/ahead', ahead: 12, behind: 0, gone: false },
    'refs/heads/behind': { upstream: 'refs/remotes/origin/behind', ahead: 0, behind: 7, gone: false },
    'refs/heads/gone': { upstream: 'refs/remotes/origin/gone', ahead: 0, behind: 0, gone: true },
    'refs/heads/sync': { upstream: 'refs/remotes/origin/sync', ahead: 0, behind: 0, gone: false },
    'refs/heads/none': { upstream: null, ahead: 0, behind: 0, gone: false },
  });
  assert.deepEqual(parseTracking(''), {});
});

test('parseConflictFiles collects the tab-indented files after each "would be overwritten" header, and nothing else', () => {
  const checkout = 'error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n\tdir/b c.txt\n'
    + 'Please commit your changes or stash them before you switch branches.\nAborting\n';
  assert.deepEqual(parseConflictFiles(checkout), ['a.txt', 'dir/b c.txt']);
  const merge = 'error: Your local changes to the following files would be overwritten by merge:\n\tm.txt\nPlease commit…\n'
    + 'error: The following untracked working tree files would be overwritten by merge:\n\tnew.txt\n\tm.txt\nPlease move…\nAborting\n';
  assert.deepEqual(parseConflictFiles(merge), ['m.txt', 'new.txt']);
  const untracked = 'error: The following untracked working tree files would be overwritten by checkout:\n\ts\nPlease move or remove them before you switch branches.\n';
  assert.deepEqual(parseConflictFiles(untracked), ['s']);
  assert.deepEqual(parseConflictFiles('error: the branch \'x\' is not fully merged\n\tnot-a-file\n'), []);
});

test('parseConflictFiles also reads the two-space list of stash apply --index, indent removed; indented lines without a header are not files', () => {
  assert.deepEqual(parseConflictFiles('error: Your local changes to the following files would be overwritten by merge:\n  dir/c.txt\n  b c.txt\nIndex was not unstashed.\n'), ['dir/c.txt', 'b c.txt']);
  assert.deepEqual(parseConflictFiles('error: Your local changes to the following files would be overwritten by checkout:\n\t  two-leading.txt\n'), ['  two-leading.txt']);
  assert.deepEqual(parseConflictFiles('  indented but no list header\n'), []);
});

test('splitRemoteRef takes the longest remote name prefixing the path, the rest is the branch', () => {
  assert.deepEqual(splitRemoteRef('refs/remotes/origin/feature/a', ['origin']), { remote: 'origin', branch: 'feature/a' });
  assert.deepEqual(splitRemoteRef('refs/remotes/a/b/feat', ['a', 'a/b']), { remote: 'a/b', branch: 'feat' });
  assert.deepEqual(splitRemoteRef('refs/remotes/gone/x/y', []), { remote: 'gone', branch: 'x/y' });
});

test('parsePushPorcelain sorts every flag: updated (fast-forward, forced, deleted, new), rejected with its reason, up to date', () => {
  const out = 'To ../origin.git\n'
    + ' \trefs/heads/ff:refs/heads/ff\t1111111..2222222\n'
    + '+\trefs/heads/forced:refs/heads/forced\t+3333333...4444444 (forced update)\n'
    + '-\t:refs/tags/old\t[deleted]\n'
    + '*\trefs/tags/v1:refs/tags/v1\t[new tag]\n'
    + '!\trefs/tags/v2:refs/tags/v2\t[rejected] (already exists)\n'
    + '!\trefs/heads/hooked:refs/heads/hooked\t[remote rejected] (pre-receive hook declined)\n'
    + '=\trefs/heads/main:refs/heads/main\t[up to date]\n'
    + 'Done\n';
  assert.deepEqual(parsePushPorcelain(out), {
    updated: [
      { ref: 'refs/heads/ff', flag: ' ', summary: '1111111..2222222' },
      { ref: 'refs/heads/forced', flag: '+', summary: '+3333333...4444444 (forced update)' },
      { ref: 'refs/tags/old', flag: '-', summary: '[deleted]' },
      { ref: 'refs/tags/v1', flag: '*', summary: '[new tag]' },
    ],
    rejected: [{ ref: 'refs/tags/v2', reason: 'already exists' }, { ref: 'refs/heads/hooked', reason: 'pre-receive hook declined' }],
    upToDate: ['refs/heads/main'],
  });
  assert.deepEqual(parsePushPorcelain('To x\nDone\n'), { updated: [], rejected: [], upToDate: [] });
});

test('splitRequested keeps only the requested refs in updated/rejected/upToDate and reports every other line as unrequested', () => {
  const parsed = {
    updated: [{ ref: 'refs/tags/v1', flag: '*', summary: '[new tag]' }, { ref: 'refs/tags/v2', flag: '*', summary: '[new tag]' }],
    rejected: [{ ref: 'refs/tags/v3', reason: 'already exists' }, { ref: 'refs/tags/x', reason: 'stale info' }],
    upToDate: ['refs/tags/v4', 'refs/heads/other'],
  };
  assert.deepEqual(splitRequested(parsed, ['refs/tags/v1', 'refs/tags/v3', 'refs/tags/v4']), {
    updated: [{ ref: 'refs/tags/v1', flag: '*', summary: '[new tag]' }],
    rejected: [{ ref: 'refs/tags/v3', reason: 'already exists' }],
    upToDate: ['refs/tags/v4'],
    unrequested: [{ ref: 'refs/tags/v2', flag: '*' }, { ref: 'refs/tags/x', flag: '!' }, { ref: 'refs/heads/other', flag: '=' }],
  });
});
