// Hover highlight: the commits a ref reaches, among the loaded rows only.

let memo: { parents: ReadonlyMap<string, string[]>; oid: string; size: number; result: ReadonlySet<string> } | null = null;

/** `oid` and its ancestors reachable through `parents` (oid → parent oids of the loaded commits). Memoized on the last call. */
export function ancestorsWithin(oid: string, parents: ReadonlyMap<string, string[]>): ReadonlySet<string> {
  if (memo && memo.parents === parents && memo.oid === oid && memo.size === parents.size) return memo.result;
  const seen = new Set<string>();
  if (parents.has(oid)) {
    const queue = [oid];
    seen.add(oid);
    while (queue.length) {
      for (const p of parents.get(queue.pop()!) ?? []) {
        if (!seen.has(p) && parents.has(p)) { seen.add(p); queue.push(p); }
      }
    }
  }
  memo = { parents, oid, size: parents.size, result: seen };
  return seen;
}
