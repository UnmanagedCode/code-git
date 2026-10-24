import { dropVerified, listStashes } from '../../stash/resolve.js';
import { stale } from './shared.js';

// `stash`: stash entries an op created or removed, stored back or dropped by oid (docs/undo.md → Steps). git stores only
// at the top, so an entry put back lands at stash@{0} with a new reflog date; its oid, message and contents are exact (R1).

/** This direction's `stores` (put back on the list: undo stores what the op removed) and `drops` (taken off it). */
export function stashSides(step, dir) {
  const storing = dir === 'undo' ? 'removed' : 'created';
  return { stores: step.entries.filter((e) => e.side === storing), drops: step.entries.filter((e) => e.side !== storing) };
}

async function preflight(git, step, dir) {
  const { stores, drops } = stashSides(step, dir);
  const listed = new Set((await listStashes(git)).map((s) => s.oid));
  for (const e of drops) if (!listed.has(e.oid)) throw stale(`stash ${e.oid.slice(0, 10)} is no longer on the stash list`);
  for (const e of stores) {
    if (listed.has(e.oid)) throw stale(`stash ${e.oid.slice(0, 10)} is already back on the stash list`);
    const r = await git(['cat-file', '-e', '--end-of-options', `${e.oid}^{commit}`], { okExit: [0, 1, 128] });
    if (r.exitCode !== 0) throw stale(`stash ${e.oid.slice(0, 10)}'s commits were pruned`);
  }
}

async function apply(git, step, dir) {
  const { stores, drops } = stashSides(step, dir);
  // Stores first: a drop refused (STASH_MOVED) then loses nothing. `stash store` takes no --end-of-options; a full oid
  // can never read as an option.
  for (const e of stores) await git(['stash', 'store', `--message=${e.message}`, e.oid]);
  for (const e of drops) await dropVerified(git, e.oid);
}

export const stash = { kind: 'stash', preflight, apply };
