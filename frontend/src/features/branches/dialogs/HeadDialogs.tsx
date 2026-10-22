import { clip } from '@/lib/clip';
import { useGraphData } from '@/state/graph';
import { closeRefDialog, type RefDialog } from '@/state/refDialog';
import { resetHead } from '../api';
import { ccHead, headOf, shortBranch } from '../refInfo';
import { ccHeadText } from './BranchDialogs';
import { CcWarning, RefDialogFrame, useRefOp } from './Frame';

type Of<K extends RefDialog['kind']> = Extract<RefDialog, { kind: K }>;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function ResetDialog({ d }: { d: Of<'reset'> }) {
  const own = useGraphData(d.tab).checkouts.find((c) => c.isOwn)?.counts;
  const { busy, error, run } = useRefOp();
  const cc = ccHead(d.tab);
  const head = d.branch ?? 'HEAD';
  return (
    <RefDialogFrame
      title={`Reset ${head} to ${d.to.label} (hard)?`} submit="Reset hard" busyLabel="Resetting…" destructive busy={busy} error={error}
      description={own
        ? `Discards ${plural(own.staged, 'staged change')} and ${plural(own.unstaged, 'unstaged change')} (untracked files stay).`
        : 'Discards every staged and unstaged change (untracked files stay).'}
      onSubmit={() => void run(d.tab, { running: `Resetting ${head}…`, done: () => `Reset ${head} to ${d.to.label} (hard)` },
        () => resetHead(d.tab, { to: d.to.oid, mode: 'hard', expect: d.expect, ccOwned: cc || undefined }))}
    >
      {cc && <CcWarning>{ccHeadText(shortBranch(headOf(d.tab).branch!), 'Resetting it')}</CcWarning>}
    </RefDialogFrame>
  );
}

/** The confirmation for moving a code-conductor/* HEAD by an action with no dialog of its own (checkout, soft/mixed reset). */
export function CcHeadMoveDialog({ d }: { d: Of<'ccHeadMove'> }) {
  return (
    <RefDialogFrame
      title={`${clip(d.label)}?`} submit={d.action === 'checkout' ? 'Switch anyway' : 'Reset anyway'} busyLabel="…" destructive busy={false} error={null}
      onSubmit={() => { closeRefDialog(); void d.run(true); }}
    >
      <CcWarning>{ccHeadText(d.branch, d.action === 'checkout' ? 'Switching away' : 'Resetting it')}</CcWarning>
    </RefDialogFrame>
  );
}
