import { useState } from 'react';
import { CcWarning, fieldClass, RefDialogFrame, useRefOp } from '@/features/branches/dialogs/Frame';
import { ccHeadWarning } from '@/features/branches/refInfo';
import { clip } from '@/lib/clip';
import { useGraphData } from '@/state/graph';
import { closeSequenceDialog, useSequenceDialog, type SequenceDialog } from '@/state/sequenceDialog';
import { refreshAfterWrite } from '@/state/workdir';
import { rebaseStart } from './api';
import { headBranchInfo } from './actions';
import { rebaseDone, startFailed } from './flows';

const ids = new WeakMap<SequenceDialog, number>();
let next = 0;
/** One id per opened dialog: a new dialog starts from fresh state. */
const idOf = (d: SequenceDialog) => {
  if (!ids.has(d)) ids.set(d, ++next);
  return ids.get(d)!;
};

/** "Rebase N commits onto…": the newest N commits of HEAD's branch replayed onto a local or remote branch picked here. */
function RebaseOntoDialog({ d }: { d: SequenceDialog }) {
  const refs = useGraphData(d.tab).refs;
  const head = headBranchInfo(d.tab);
  const branches = (refs?.refs ?? []).filter((r) => (r.kind === 'local' || r.kind === 'remote') && r.oid && r.name !== refs?.head.branch);
  const [onto, setOnto] = useState(branches[0]?.name ?? '');
  const { busy, error, run } = useRefOp();
  const target = branches.find((r) => r.name === onto);
  const submit = () => {
    if (!target?.oid) return;
    void run(d.tab, { running: `Rebasing ${head.name} onto ${target.short}…`, done: rebaseDone(d.tab, head.name, target.short), failed: startFailed },
      () => rebaseStart(d.tab, { onto: target.oid!, upstream: d.upstream, expect: d.expect, ccOwned: head.cc || undefined }),
      () => { closeSequenceDialog(); void refreshAfterWrite(d.tab); });
  };
  return (
    <RefDialogFrame
      title={`Rebase ${d.count} commits onto…`} submit="Rebase" busyLabel="Rebasing…" busy={busy} error={error} canSubmit={!!target}
      description={<>The newest {d.count} commits of <span className="font-mono">{clip(head.name)}</span> are replayed onto the branch you pick; older ones are left out of it.</>}
      onSubmit={submit} onClose={closeSequenceDialog}
    >
      <label className={fieldClass}>
        Onto
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={onto} onChange={(e) => setOnto(e.target.value)}>
          {branches.length === 0 && <option value="">No other branch</option>}
          {branches.map((r) => <option key={r.name} value={r.name}>{clip(r.short)}</option>)}
        </select>
      </label>
      {head.cc && <CcWarning>{ccHeadWarning(head.name, 'Rebasing it')}</CcWarning>}
    </RefDialogFrame>
  );
}

/** Renders the open merge/rebase dialog (state/sequenceDialog.ts), mounted once by the shell. */
export function SequenceDialogHost() {
  const d = useSequenceDialog();
  if (!d) return null;
  return <RebaseOntoDialog key={idOf(d)} d={d} />;
}
