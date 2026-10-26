import { expect, test } from 'vitest';
import { buildFileTree, MAX_TREE_DEPTH, orderedFiles, statusClass } from './fileTree';

const f = (path: string, status = 'M') => ({ status, path, oldPath: null });

test('the tree nests directories, directories before files, each by name; every file appears once', () => {
  const tree = buildFileTree([f('src/b.ts'), f('README.md'), f('src/a/x.ts', 'A'), f('src/a.ts'), f('docs/z.md', 'D')]);
  const flat = (nodes: ReturnType<typeof buildFileTree>, d = 0): string[] => nodes.flatMap((n) => [`${'  '.repeat(d)}${n.name}`, ...(n.kind === 'dir' ? flat(n.children, d + 1) : [])]);
  expect(flat(tree)).toEqual(['docs', '  z.md', 'src', '  a', '    x.ts', '  a.ts', '  b.ts', 'README.md']);
  const src = tree[1];
  expect(src.kind === 'dir' && src.path).toBe('src');
  expect(buildFileTree([])).toEqual([]);
});

test('status colours: added and untracked, deleted and conflicted, modified, renamed/copied, other', () => {
  expect(['A', '?', 'D', 'U', 'M', 'R', 'C', 'T'].map(statusClass)).toEqual([
    'text-success', 'text-success', 'text-destructive', 'text-destructive', 'text-info', 'text-warning', 'text-warning', 'text-muted-foreground',
  ]);
});

test('orderedFiles: Path keeps the input order; Tree is the tree\'s depth-first file order (directories first, each by name)', () => {
  const files = [f('src/b.ts'), f('README.md'), f('src/a/x.ts'), f('src/a.ts'), f('docs/z.md')];
  expect(orderedFiles(files, 'path')).toEqual(files);
  expect(orderedFiles(files, 'tree').map((x) => x.path)).toEqual(['docs/z.md', 'src/a/x.ts', 'src/a.ts', 'src/b.ts', 'README.md']);
  expect(orderedFiles(files, 'tree')[0]).toBe(files[4]);
  expect(orderedFiles([], 'tree')).toEqual([]);
});

test('a path of 20,000 components nests MAX_TREE_DEPTH directories and keeps the rest in the file name', () => {
  const parts = Array.from({ length: 20_000 }, (_, i) => `d${i}`);
  const tree = buildFileTree([f(parts.join('/'))]);
  let depth = 0;
  let node = tree[0];
  while (node.kind === 'dir') { depth++; node = node.children[0]; }
  expect(depth).toBe(MAX_TREE_DEPTH);
  expect(node.name).toBe(parts.slice(MAX_TREE_DEPTH).join('/'));
  expect(node.path).toBe(parts.join('/'));
  expect(buildFileTree([f(Array.from({ length: MAX_TREE_DEPTH + 1 }, (_, i) => `x${i}`).join('/'))])[0].kind).toBe('dir');
});

// Invariant: nesting never exceeds MAX_TREE_DEPTH directories, at the boundary: MAX+1 components fill it with a one-component leaf; MAX+2 keep the tail joined in the leaf.
test('MAX_TREE_DEPTH + 1 and + 2 components: the nesting stops at the cap and the leaf keeps the tail', () => {
  for (const extra of [1, 2]) {
    const parts = Array.from({ length: MAX_TREE_DEPTH + extra }, (_, i) => `d${i}`);
    let node = buildFileTree([f(parts.join('/'))])[0];
    let depth = 0;
    while (node.kind === 'dir') { depth++; node = node.children[0]; }
    expect(depth).toBe(MAX_TREE_DEPTH);
    expect(node.name).toBe(parts.slice(MAX_TREE_DEPTH).join('/'));
  }
});
