import { Button } from '@/components/ui/button';
import { abbrev } from '@/features/branches/refInfo';
import { graphStore, getGraph } from '@/state/graph';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import type { WorkdirState } from '@/state/workdir';
import { abortFlow, continueFlow, skipFlow } from './flows';
import { operationTitle } from './labels';

const plural = (n: number) => `${n} conflicted ${n === 1 ? 'file' : 'files'}`;

/**
 * What is in progress in this checkout (commit.state, so it shows after a reload): the operation's title, what to do next,
 * and Continue / Skip / Abort…. Conflicts with no operation (a squash merge, a stash apply) are counted, with no buttons.
 */
export function OperationBanner({ tab, state }: { tab: Tab; state: WorkdirState }) {
  useStore(graphStore);
  const { operation: op, conflicts } = state;
  if (!op && !conflicts.length) return null;
  const refs = getGraph(tab).refs;
  if (!op) {
    return (
      <div role="status" aria-label="Conflicts" className="border-b bg-warning/15 px-3 py-2 text-xs text-warning">
        {plural(conflicts.length)}: resolve them, then stage them.
      </div>
    );
  }
  const head = refs?.head.branch && !refs.head.detached ? refs.head.branch : null;
  const title = operationTitle(op, head, refs?.refs ?? []);
  const staged = !!state.staged?.files.length;
  const next = conflicts.length
    ? `${plural(conflicts.length)} — resolve them, then Continue`
    : op.kind === 'rebase' && !staged && op.incoming
      ? `Stopped at ${abbrev(op.incoming.oid)}: amend if you like, then Continue`
      : 'Conflicts resolved: Continue';
  const busy = state.busy;
  return (
    <div role="status" aria-label="Operation in progress" className="space-y-1.5 border-b bg-warning/15 px-3 py-2 text-xs text-warning">
      <p className="font-medium break-words">{title}</p>
      <p className="break-words">{next}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7" disabled={busy || conflicts.length > 0} onClick={() => void continueFlow(tab, op.kind)}>Continue</Button>
        {op.kind !== 'merge' && (
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void skipFlow(tab, op.kind as Exclude<typeof op.kind, 'merge'>)}>Skip</Button>
        )}
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void abortFlow(tab, op.kind)}>Abort…</Button>
      </div>
    </div>
  );
}
