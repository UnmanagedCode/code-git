import { ccRetry, withCcHeadAck } from '@/features/branches/actions';
import { rebaseInteractive, type RebaseResult } from '@/features/sequence/api';
import { rebaseDone, runSequenceOp, startFailed } from '@/features/sequence/flows';
import { openWorkingTree } from '@/features/workdir/entry';
import { confirm } from '@/lib/confirm';
import type { ToastText } from '@/lib/opToast';
import type { Tab } from '@/state/tabs';
import { droppedCount, toRequest, validate, type RebaseSession } from './model';
import { closeRebaseEditor } from './open';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The editor's header, by mode. */
export function editorTitle(s: RebaseSession): string {
  if (s.mode === 'pick') return `Cherry-pick ${plural(s.rows.length, 'commit')} onto ${s.branch}`;
  if (s.mode === 'squash') return `Squash ${plural(s.rows.filter((r) => r.action === 'squash').length + 1, 'commit')}`;
  return `Interactive rebase ${s.branch} onto ${s.ontoLabel}`;
}

const done = (tab: Tab, s: RebaseSession) => (r: RebaseResult): string | ToastText => {
  if (r.outcome === 'done' && s.mode === 'pick') return `Cherry-picked ${plural(s.rows.filter((x) => x.action !== 'drop').length, 'commit')} onto ${s.branch}`;
  if (r.outcome === 'done' && s.mode === 'squash') return `Squashed into one commit on ${s.branch}`;
  if (r.outcome === 'upToDate') return `${s.branch}: nothing changed`;
  return rebaseDone(tab, s.branch, s.ontoLabel)(r);
};

/**
 * Runs the editor's rows: nothing while `validate` has errors; asks first when commits are dropped; the cc HEAD gate for
 * a rebase or squash (a cherry-pick only adds). Success closes the editor; a stop also opens Changes.
 */
export async function startRebase(tab: Tab, s: RebaseSession): Promise<void> {
  if (validate(s).length) return;
  const drops = droppedCount(s.rows);
  if (drops) {
    const ok = await confirm({
      title: `Drop ${plural(drops, 'commit')}?`, body: 'Dropped commits leave the branch: their changes are gone from it once the rebase finishes.',
      confirmLabel: 'Drop and start', irreversible: true,
    });
    if (!ok) return;
  }
  const req = toRequest(s);
  const label = editorTitle(s);
  const go = async (ccOwned?: true): Promise<unknown> => {
    const r = await runSequenceOp(tab, {
      running: `${label}…`, done: done(tab, s), failed: (e) => ccRetry(tab, 'rebase', label, go)(e) ?? startFailed(e),
    }, () => rebaseInteractive(tab, { ...req, ccOwned }));
    if (!r.ok) return;
    closeRebaseEditor(tab);
    if (r.result.outcome === 'conflicts' || r.result.outcome === 'stopped') openWorkingTree(tab);
  };
  if (s.mode === 'pick') await go();
  else withCcHeadAck(tab, 'rebase', label, go);
}
