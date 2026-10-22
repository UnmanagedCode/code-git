import type { CommitFile } from '../types';

export interface TreeDir { kind: 'dir'; name: string; path: string; children: TreeNode[] }
export interface TreeFile { kind: 'file'; name: string; path: string; file: CommitFile }
export type TreeNode = TreeDir | TreeFile;

/** The changed files as nested directories: directories first, then files, each by name. */
export function buildFileTree(files: CommitFile[]): TreeNode[] {
  const root: TreeDir = { kind: 'dir', name: '', path: '', children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = dir.children.find((c): c is TreeDir => c.kind === 'dir' && c.name === name);
      if (!next) dir.children.push(next = { kind: 'dir', name, path, children: [] });
      dir = next;
    });
    dir.children.push({ kind: 'file', name: parts[parts.length - 1], path: file.path, file });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] => nodes
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    .map((n) => (n.kind === 'dir' ? { ...n, children: sort(n.children) } : n));
  return sort(root.children);
}

/** The text colour of a file's status letter. */
export function statusClass(status: string): string {
  switch (status) {
    case 'A': return 'text-success';
    case 'D': return 'text-destructive';
    case 'M': return 'text-info';
    case 'R': case 'C': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}
