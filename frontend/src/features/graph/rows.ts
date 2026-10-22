import type { Checkout, CommitItem, GraphRow, LayoutInput, RowId, Stash } from './types';

export const wipId = (c: Checkout): RowId => `wip:${c.target.worktree ?? ''}`;
export const stashId = (s: Stash): RowId => `stash:${s.oid}`;

/**
 * The graph's rows top to bottom: WIP rows first (the own checkout, then the others by name), then the commits, each
 * stash directly above its base commit. A WIP row links to its HEAD and a stash to its base only once that commit is
 * loaded, and a stash whose base is not loaded is left out: no lane ever waits for a row that may never come.
 */
export function buildInputs(commits: CommitItem[], wips: Checkout[], stashes: Stash[]): { rows: GraphRow[]; inputs: LayoutInput[] } {
  const loaded = new Set(commits.map((c) => c.oid));
  const rows: GraphRow[] = [];
  const inputs: LayoutInput[] = [];
  const ordered = [...wips].sort((a, b) => Number(b.isOwn) - Number(a.isOwn) || a.name.localeCompare(b.name));
  for (const c of ordered) {
    const id = wipId(c);
    rows.push({ kind: 'wip', id, checkout: c });
    inputs.push({ id, parents: c.headOid && loaded.has(c.headOid) ? [c.headOid] : [], dashed: true });
  }
  const byBase = new Map<string, Stash[]>();
  for (const s of stashes) {
    const base = s.parents[0];
    if (base && loaded.has(base)) byBase.set(base, [...(byBase.get(base) ?? []), s]);
  }
  for (const item of commits) {
    for (const s of byBase.get(item.oid) ?? []) {
      const id = stashId(s);
      rows.push({ kind: 'stash', id, stash: s });
      inputs.push({ id, parents: [item.oid], dashed: true });
    }
    rows.push({ kind: 'commit', id: item.oid, item });
    inputs.push({ id: item.oid, parents: item.parents, dashed: false });
  }
  return { rows, inputs };
}
