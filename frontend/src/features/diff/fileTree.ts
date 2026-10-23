// A file list's Tree view (features/diff/FileList.tsx): the files as nested directories, and the order it shows them in.

export interface TreeDir<F> { kind: 'dir'; name: string; path: string; children: TreeNode<F>[] }
export interface TreeFile<F> { kind: 'file'; name: string; path: string; file: F }
export type TreeNode<F> = TreeDir<F> | TreeFile<F>;

/** Directory levels the tree nests; deeper components stay in the file's name (a crafted path can have thousands). */
export const MAX_TREE_DEPTH = 32;

/** The changed files as nested directories (at most MAX_TREE_DEPTH deep): directories first, then files, each by name. */
export function buildFileTree<F extends { path: string }>(files: readonly F[]): TreeNode<F>[] {
  const root: TreeDir<F> = { kind: 'dir', name: '', path: '', children: [] };
  for (const file of files) {
    const all = file.path.split('/');
    const parts = all.length > MAX_TREE_DEPTH + 1 ? [...all.slice(0, MAX_TREE_DEPTH), all.slice(MAX_TREE_DEPTH).join('/')] : all;
    let dir = root;
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = dir.children.find((c): c is TreeDir<F> => c.kind === 'dir' && c.name === name);
      if (!next) dir.children.push(next = { kind: 'dir', name, path, children: [] });
      dir = next;
    });
    dir.children.push({ kind: 'file', name: parts[parts.length - 1], path: file.path, file });
  }
  const sort = (nodes: TreeNode<F>[]): TreeNode<F>[] => nodes
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    .map((n) => (n.kind === 'dir' ? { ...n, children: sort(n.children) } : n));
  return sort(root.children);
}

/** The files in the order a list shows them: as given in Path, the tree's depth-first file order in Tree. */
export function orderedFiles<F extends { path: string }>(files: readonly F[], view: 'path' | 'tree'): F[] {
  if (view === 'path') return [...files];
  const out: F[] = [];
  const walk = (nodes: TreeNode<F>[]) => { for (const n of nodes) { if (n.kind === 'file') out.push(n.file); else walk(n.children); } };
  walk(buildFileTree(files));
  return out;
}

/** The text colour of a file's status letter: the one status palette of every file list. */
export function statusClass(status: string): string {
  switch (status) {
    case 'A': case '?': return 'text-success';
    case 'D': case 'U': return 'text-destructive';
    case 'M': return 'text-info';
    case 'R': case 'C': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}
