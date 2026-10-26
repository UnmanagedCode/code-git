import { buildFileTree, type TreeNode } from '@/features/diff/fileTree';
import type { Ref } from './types';
import { inFolder, refBase, sectionOf, SECTION_BASE } from './visibility';

export type RefTreeRow =
  | { kind: 'folder'; prefix: string; name: string; label: string; depth: number; expanded: boolean; refs: Ref[] }
  | { kind: 'ref'; ref: Ref; name: string; depth: number };

interface Leaf { path: string; ref: Ref }

/** The first ref beneath `nodes`, in tree order. */
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
  const pinnedRefs = refs.filter((r) => pinned.has(r.name));
  const tree = buildFileTree(refs.filter((r) => !pinned.has(r.name)).map((ref): Leaf => ({ path: ref.name.slice(refBase(ref).length), ref })));
  const walk = (nodes: TreeNode<Leaf>[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === 'file') {
        rows.push({ kind: 'ref', ref: n.file.ref, name: n.name, depth });
        continue;
      }
      const beneath = leaves(n.children);
      const first = beneath[0];
      const prefix = `${refBase(first)}${n.path}/`;
      // Every ref beneath, pinned ones included: they are not rendered here but still belong to the folder.
      const under = [...beneath, ...pinnedRefs.filter((r) => inFolder(r, prefix))];
      const expanded = !opts.collapsed(prefix);
      rows.push({ kind: 'folder', prefix, name: n.name, label: prefix.slice(SECTION_BASE[sectionOf(first)].length, -1), depth, expanded, refs: under });
      if (expanded) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

/** A folder's accessible name, unique across namespaces: `folder a/b`, `tag folder a/b`, `remote origin folder a/b`. */
export function folderName(row: Extract<RefTreeRow, { kind: 'folder' }>): string {
  const r = row.refs[0];
  if (r.kind === 'tag') return `tag folder ${row.label}`;
  if (r.kind === 'remote') return `remote ${r.remote ?? ''} folder ${row.prefix.slice(refBase(r).length, -1)}`;
  return `folder ${row.label}`;
}
