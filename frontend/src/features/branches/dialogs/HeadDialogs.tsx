import { useGraphData } from '@/state/graph';
import type { RefDialog } from '@/state/refDialog';
import { resetHead } from '../api';
import { ccHead, ccHeadWarning, headOf, shortBranch } from '../refInfo';
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
      {cc && <CcWarning>{ccHeadWarning(shortBranch(headOf(d.tab).branch!), 'Resetting it')}</CcWarning>}
    </RefDialogFrame>
  );
}
