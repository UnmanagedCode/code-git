import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitRemoteRef } from '../src/git/parse/graph.js';
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

test('splitRemoteRef takes the longest remote name prefixing the path, the rest is the branch', () => {
  assert.deepEqual(splitRemoteRef('refs/remotes/origin/feature/a', ['origin']), { remote: 'origin', branch: 'feature/a' });
  assert.deepEqual(splitRemoteRef('refs/remotes/a/b/feat', ['a', 'a/b']), { remote: 'a/b', branch: 'feat' });
  assert.deepEqual(splitRemoteRef('refs/remotes/gone/x/y', []), { remote: 'gone', branch: 'x/y' });
});
