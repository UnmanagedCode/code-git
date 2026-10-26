import { buildFileTree, type TreeNode } from '@/features/diff/fileTree';
import type { Ref } from './types';
import { refBase, sectionOf, SECTION_BASE } from './visibility';

export type RefTreeRow =
  | { kind: 'folder'; prefix: string; name: string; label: string; depth: number; expanded: boolean; refs: Ref[] }
  | { kind: 'ref'; ref: Ref; name: string; depth: number };

interface Leaf { path: string; ref: Ref }

const leaves = (nodes: TreeNode<Leaf>[]): Ref[] => nodes.flatMap((n) => (n.kind === 'file' ? [n.file.ref] : leaves(n.children)));

/**
 * One list's rows (Local, one remote, or Tags): pinned refs first, in pin order and flat (name = path within the
 * namespace), then the tree depth-first (folders first, then refs, by name); a collapsed folder's rows left out.
 */
export function refTreeRows(refs: readonly Ref[], opts: { pinned: readonly string[]; collapsed: (prefix: string) => boolean }): RefTreeRow[] {
  const rows: RefTreeRow[] = [];
  const byName = new Map(refs.map((r) => [r.name, r]));
  for (const name of opts.pinned) {
    const r = byName.get(name);
    if (r) rows.push({ kind: 'ref', ref: r, name: r.name.slice(refBase(r).length), depth: 0 });
  }
  const pinned = new Set(opts.pinned);
  const tree = buildFileTree(refs.filter((r) => !pinned.has(r.name)).map((ref): Leaf => ({ path: ref.name.slice(refBase(ref).length), ref })));
  const walk = (nodes: TreeNode<Leaf>[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === 'file') {
        rows.push({ kind: 'ref', ref: n.file.ref, name: n.name, depth });
        continue;
      }
      const under = leaves(n.children);
      const prefix = `${refBase(under[0])}${n.path}/`;
      const expanded = !opts.collapsed(prefix);
      rows.push({ kind: 'folder', prefix, name: n.name, label: prefix.slice(SECTION_BASE[sectionOf(under[0])].length, -1), depth, expanded, refs: under });
      if (expanded) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}
