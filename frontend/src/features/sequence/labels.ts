import type { Ref } from '@/features/graph/types';
import type { Operation } from './api';

// How an operation and its two sides are named in the banner, the toasts and the conflict tool (docs/merge.md →
// Labels). Pure. "Current" is stage 2 (ours) and "Incoming" stage 3 (theirs) for every kind; during a rebase stage 2 is
// the onto side with the commits replayed so far, and stage 3 the commit being replayed.

const HEADS = 'refs/heads/';
const abbrev = (oid: string) => oid.slice(0, 7);
const short = (branch: string) => (branch.startsWith(HEADS) ? branch.slice(HEADS.length) : branch);

/** A commit as the user knows it: the first local branch at it, else a remote branch, else its short oid. */
export function commitLabel(oid: string, refs: readonly Ref[]): string {
  const at = refs.filter((r) => r.oid === oid);
  return (at.find((r) => r.kind === 'local') ?? at.find((r) => r.kind === 'remote'))?.short ?? abbrev(oid);
}

const commitLine = (o: Operation) => (o.incoming ? `${abbrev(o.incoming.oid)} ${o.incoming.subject}` : 'the commit being applied');

export interface SideLabels { current: string; incoming: string }

/** The Current / Incoming names for `op` (null: nothing in progress); `headBranch`: HEAD's branch (full) or null. */
export function sideLabels(op: Operation | null, headBranch: string | null, refs: readonly Ref[]): SideLabels {
  const head = headBranch ? short(headBranch) : 'HEAD';
  switch (op?.kind) {
    case 'merge': return { current: head, incoming: op.incoming ? commitLabel(op.incoming.oid, refs) : 'Incoming' };
    case 'rebase': {
      const onto = op.rebase?.onto ? commitLabel(op.rebase.onto, refs) : 'the new base';
      return { current: `${onto} (rebased so far)`, incoming: commitLine(op) };
    }
    case 'cherry-pick': return { current: head, incoming: commitLine(op) };
    case 'revert': return { current: head, incoming: op.incoming ? `revert of ${abbrev(op.incoming.oid)}` : 'the revert' };
    default: return { current: 'Current', incoming: 'Incoming' };
  }
}

/** "Rebasing feature onto main (step 2 of 5)", "Merging feature into main", "Cherry-picking 3f2a91c Fix it". */
export function operationTitle(op: Operation, headBranch: string | null, refs: readonly Ref[]): string {
  const head = headBranch ? short(headBranch) : 'HEAD';
  switch (op.kind) {
    case 'rebase': {
      const r = op.rebase;
      const branch = r?.branch ? short(r.branch) : 'HEAD';
      const onto = r?.onto ? ` onto ${commitLabel(r.onto, refs)}` : '';
      const step = r?.step && r.total ? ` (step ${r.step} of ${r.total})` : '';
      return `Rebasing ${branch}${onto}${step}`;
    }
    case 'merge': return `Merging ${op.incoming ? commitLabel(op.incoming.oid, refs) : 'a commit'} into ${head}`;
    case 'cherry-pick': return `Cherry-picking ${commitLine(op)}`;
    case 'revert': return `Reverting ${commitLine(op)}`;
  }
}
