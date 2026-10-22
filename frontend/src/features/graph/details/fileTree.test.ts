import { expect, test } from 'vitest';
import { buildFileTree, statusClass } from './fileTree';

const f = (path: string, status = 'M') => ({ status, path, oldPath: null });

test('the tree nests directories, directories before files, each by name; every file appears once', () => {
  const tree = buildFileTree([f('src/b.ts'), f('README.md'), f('src/a/x.ts', 'A'), f('src/a.ts'), f('docs/z.md', 'D')]);
  const flat = (nodes: ReturnType<typeof buildFileTree>, d = 0): string[] => nodes.flatMap((n) => [`${'  '.repeat(d)}${n.name}`, ...(n.kind === 'dir' ? flat(n.children, d + 1) : [])]);
  expect(flat(tree)).toEqual(['docs', '  z.md', 'src', '  a', '    x.ts', '  a.ts', '  b.ts', 'README.md']);
  const src = tree[1];
  expect(src.kind === 'dir' && src.path).toBe('src');
  expect(buildFileTree([])).toEqual([]);
});

test('status colours: added, deleted, modified, renamed/copied, other', () => {
  expect(['A', 'D', 'M', 'R', 'C', 'T'].map(statusClass)).toEqual(['text-success', 'text-destructive', 'text-info', 'text-warning', 'text-warning', 'text-muted-foreground']);
});
