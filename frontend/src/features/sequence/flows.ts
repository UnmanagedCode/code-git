import { abbrev } from '@/features/branches/refInfo';
import { fileList, runRefOp, type RefOpLabels } from '@/features/branches/run';
import { openWorkingTree } from '@/features/workdir/entry';
import type { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import type { ToastText, Tracked } from '@/lib/opToast';
import type { Tab } from '@/state/tabs';
import { refreshAfterWrite, setWorkdirBusy } from '@/state/workdir';
import { abortOp, continueOp, skipOp, type OperationKind, type ResumeResult, type SkippableKind } from './api';

// Running the merge / rebase / cherry-pick / revert ops from the UI (docs/merge.md → Using it): each goes through
// runRefOp (toast, graph refresh), then refreshAfterWrite so the Changes panel and its banner show what is in progress.

const NAME: Record<OperationKind, string> = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' };
const CAPITAL: Record<OperationKind, string> = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };
const ABORT_BODY: Record<OperationKind, string> = {
  merge: 'Discards the merge in progress and any conflict resolutions made so far; HEAD goes back to where it was.',
  rebase: 'Discards the rebase in progress and any conflict resolutions made so far; the branch goes back to where it was before the rebase.',
  'cherry-pick': 'Discards the cherry-pick in progress and any conflict resolutions made so far; HEAD goes back to where it was.',
  revert: 'Discards the revert in progress and any conflict resolutions made so far; HEAD goes back to where it was.',
};

/** Runs `fn` as a ref op with the Changes panel busy, then reloads the panel (its banner reads commit.state). */
export async function runSequenceOp<T>(tab: Tab, labels: RefOpLabels<T>, fn: () => Promise<T>): Promise<Tracked<T>> {
  setWorkdirBusy(tab, true);
  try {
    return await runRefOp(tab, labels, fn);
  } finally {
    setWorkdirBusy(tab, false);
    await refreshAfterWrite(tab);
  }
}

/** Abort `kind` in progress, after asking. */
export async function abortFlow(tab: Tab, kind: OperationKind): Promise<void> {
  const ok = await confirm({ title: `Abort the ${NAME[kind]}?`, body: ABORT_BODY[kind], confirmLabel: `Abort ${NAME[kind]}`, irreversible: true });
  if (ok) await runSequenceOp(tab, { running: `Aborting the ${NAME[kind]}…`, done: () => `${CAPITAL[kind]} aborted` }, () => abortOp(tab, kind));
}

/**
 * The toast of an outcome that left `kind` in progress: conflicts (warning, the files, **Resolve…** opening Changes and
 * **Abort…**) or an `edit` stop.
 */
export function stoppedToast(tab: Tab, kind: OperationKind, r: { outcome: string; files: string[]; oid: string | null }): ToastText {
  const resolve = { label: 'Resolve…', onClick: () => openWorkingTree(tab) };
  if (r.outcome === 'stopped') {
    return { tone: 'warning', title: `Stopped to edit ${r.oid ? abbrev(r.oid) : 'a commit'}`, description: 'Amend the commit if you like, then Continue.', action: { ...resolve, label: 'Open Changes' } };
  }
  return {
    tone: 'warning', title: `The ${NAME[kind]} stopped on conflicts`,
    description: `Conflicts in ${fileList(r.files)}. Resolve them, then Continue, or abort.`,
    action: resolve, secondary: { label: 'Abort…', onClick: () => void abortFlow(tab, kind) },
  };
}

const DONE: Record<OperationKind, string> = {
  merge: 'Merge committed', rebase: 'Rebase finished', 'cherry-pick': 'Cherry-pick committed', revert: 'Revert committed',
};

function resumeFailed(e: ApiError): Partial<ToastText> | undefined {
  if (e.code === 'CONFLICTED') return { title: 'Resolve the conflicts first', description: `Still conflicted: ${fileList(filesOf(e))}.` };
  if (e.code === 'NOTHING_TO_COMMIT') return { title: 'Nothing to commit here: skip this commit, or abort' };
  if (e.code === 'DIRTY_WORKTREE') return { title: 'Stage or discard the unstaged changes first' };
  return undefined;
}

export const filesOf = (e: ApiError): string[] => {
  const f = (e.body as { files?: unknown } | undefined)?.files;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
};

const resumeDone = (tab: Tab, kind: OperationKind) => (r: ResumeResult) => (r.outcome === 'done' ? DONE[kind] : stoppedToast(tab, kind, r));

/** Continue `kind` in progress. */
export async function continueFlow(tab: Tab, kind: OperationKind): Promise<void> {
  await runSequenceOp(tab, { running: `Continuing the ${NAME[kind]}…`, done: resumeDone(tab, kind), failed: resumeFailed }, () => continueOp(tab, kind));
}

/** Skip the commit `kind` stopped at, after asking. */
export async function skipFlow(tab: Tab, kind: SkippableKind): Promise<void> {
  const ok = await confirm({
    title: 'Skip this commit?', body: `Leaves this commit's changes out of the ${NAME[kind]}, and any conflict resolutions made for it; the ${NAME[kind]} goes on with the next one.`,
    confirmLabel: 'Skip commit',
  });
  if (ok) await runSequenceOp(tab, { running: `Skipping…`, done: resumeDone(tab, kind), failed: resumeFailed }, () => skipOp(tab, kind));
}
