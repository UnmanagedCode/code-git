import { expect, test } from 'vitest';
import { MAX_TREE_DEPTH } from '@/features/diff/fileTree';
import { oid, ref } from '@/test/graphData';
import { folderName, refTreeRows, type RefTreeRow } from './refTree';

const M = oid(1);
const local = (path: string, over = {}) => ref(`refs/heads/${path}`, M, over);
const none = { pinned: [] as string[], collapsed: () => false };
/** Compact: folders as `dir/ name@depth`, refs as `name@depth`. */
const shape = (rows: RefTreeRow[]) => rows.map((r) => (r.kind === 'folder' ? `${r.name}/@${r.depth}` : `${r.name}@${r.depth}`));

// Invariant: refs group by `/` segment, nesting; folders first then refs, each by name; no single-child compaction.
test('groups by segment and nests; a single-child folder is still a folder; folders before refs, each sorted by name', () => {
  const rows = refTreeRows([local('zed'), local('main'), local('team/b'), local('team/a'), local('team/sub/x'), local('solo/only'), local('apple/z')], none);
  expect(shape(rows)).toEqual(['apple/@0', 'z@1', 'solo/@0', 'only@1', 'team/@0', 'sub/@1', 'x@2', 'a@1', 'b@1', 'main@0', 'zed@0']);
});

// Invariant: a folder's prefix is the full refname prefix with a trailing slash; its label drops the namespace.
test('folder prefix, name and label: local, tags, a remote, and a remote whose name contains a slash', () => {
  const folders = (rows: RefTreeRow[]) => rows.flatMap((r) => (r.kind === 'folder' ? [[r.prefix, r.name, r.label]] : []));
  expect(folders(refTreeRows([local('team/sub/x')], none))).toEqual([['refs/heads/team/', 'team', 'team'], ['refs/heads/team/sub/', 'sub', 'team/sub']]);
  expect(folders(refTreeRows([ref('refs/tags/release/1.0', M)], none))).toEqual([['refs/tags/release/', 'release', 'release']]);
  expect(folders(refTreeRows([ref('refs/remotes/origin/feature/b', M, { remote: 'origin' })], none))).toEqual([['refs/remotes/origin/feature/', 'feature', 'origin/feature']]);
  expect(folders(refTreeRows([ref('refs/remotes/up/stream/feature/b', M, { remote: 'up/stream' })], none))).toEqual([['refs/remotes/up/stream/feature/', 'feature', 'up/stream/feature']]);
});

// Invariant: pinned refs sit flat above the tree in pin order with their full path, and appear once.
test('pinned refs come first in pin order, flat with their full path, and are absent from the tree', () => {
  const rows = refTreeRows([local('team/a'), local('team/b'), local('main'), local('other/c')], { pinned: ['refs/heads/other/c', 'refs/heads/team/b', 'refs/heads/gone'], collapsed: () => false });
  expect(shape(rows)).toEqual(['other/c@0', 'team/b@0', 'team/@0', 'a@1', 'main@0']);
  expect(rows.filter((r) => r.kind === 'ref').map((r) => (r as { ref: { name: string } }).ref.name).sort()).toEqual(['refs/heads/main', 'refs/heads/other/c', 'refs/heads/team/a', 'refs/heads/team/b']);
});

// Invariant: a collapsed folder omits everything below it, but its `refs` still lists them (dimming, HEAD mark).
test('a collapsed folder omits its descendants; an expanded one under a collapsed one is not shown; refs lists all beneath', () => {
  const refs = [local('team/a'), local('team/sub/b', { isHead: true }), local('main')];
  const nested = refTreeRows(refs, { pinned: [], collapsed: (p) => p === 'refs/heads/team/sub/' });
  expect(shape(nested)).toEqual(['team/@0', 'sub/@1', 'a@1', 'main@0']);
  const top = refTreeRows(refs, { pinned: [], collapsed: (p) => p === 'refs/heads/team/' });
  expect(shape(top)).toEqual(['team/@0', 'main@0']);
  const team = top[0] as Extract<RefTreeRow, { kind: 'folder' }>;
  expect(team.expanded).toBe(false);
  expect(team.refs.map((r) => r.name).sort()).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b']);
  expect((nested[1] as Extract<RefTreeRow, { kind: 'folder' }>).expanded).toBe(false);
  expect((nested[0] as Extract<RefTreeRow, { kind: 'folder' }>).expanded).toBe(true);
});

// Invariant: depth is capped like the file tree's (MAX_TREE_DEPTH); the rest stays in the leaf's name.
test('a path deeper than MAX_TREE_DEPTH keeps its tail in the leaf name', () => {
  const segs = Array.from({ length: MAX_TREE_DEPTH + 5 }, (_, i) => `d${i}`);
  const rows = refTreeRows([local(segs.join('/'))], none);
  const folders = rows.filter((r) => r.kind === 'folder');
  expect(folders).toHaveLength(MAX_TREE_DEPTH);
  const leaf = rows.at(-1) as Extract<RefTreeRow, { kind: 'ref' }>;
  expect(leaf.depth).toBe(MAX_TREE_DEPTH);
  expect(leaf.name).toBe(segs.slice(MAX_TREE_DEPTH).join('/'));
});

// Invariant: the tree's depth never exceeds MAX_TREE_DEPTH folders, at the boundary of MAX+1 and MAX+2 components.
test('MAX_TREE_DEPTH + 1 and + 2 components: at most the cap in folders, the leaf keeps the tail', () => {
  for (const extra of [1, 2]) {
    const segs = Array.from({ length: MAX_TREE_DEPTH + extra }, (_, i) => `d${i}`);
    const rows = refTreeRows([local(segs.join('/'))], none);
    expect(rows.filter((r) => r.kind === 'folder')).toHaveLength(MAX_TREE_DEPTH);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(MAX_TREE_DEPTH);
    expect((rows.at(-1) as Extract<RefTreeRow, { kind: 'ref' }>).name).toBe(segs.slice(MAX_TREE_DEPTH).join('/'));
  }
});

// Invariant: a folder's `refs` is every ref beneath it, pinned ones (not rendered in the tree) included.
test('a folder\'s refs include a pinned member that is rendered flat above the tree', () => {
  const rows = refTreeRows([local('team/a'), local('team/b'), local('team/sub/c')], { pinned: ['refs/heads/team/b', 'refs/heads/team/sub/c'], collapsed: () => false });
  const folders = rows.filter((r): r is Extract<RefTreeRow, { kind: 'folder' }> => r.kind === 'folder');
  expect(folders.map((f) => [f.name, f.refs.map((r) => r.name).sort()])).toEqual([
    ['team', ['refs/heads/team/a', 'refs/heads/team/b', 'refs/heads/team/sub/c']],
  ]);
});

// Invariant: accessible folder names differ across namespaces and remotes for the same path.
test('folderName qualifies tag and remote folders so equal paths never share a name', () => {
  const name = (r: ReturnType<typeof ref>) => folderName(refTreeRows([r], none)[0] as Extract<RefTreeRow, { kind: 'folder' }>);
  const names = [
    name(ref('refs/heads/release/a', M)), name(ref('refs/tags/release/a', M)),
    name(ref('refs/remotes/origin/release/a', M, { remote: 'origin' })), name(ref('refs/remotes/up/release/a', M, { remote: 'up' })),
    name(ref('refs/heads/origin/release/a', M)),
  ];
  expect(new Set(names).size).toBe(names.length);
  expect(names[0]).toBe('folder release');
});
