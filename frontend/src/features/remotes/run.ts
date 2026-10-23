import { ccRetry, withCcHeadAck } from '@/features/branches/actions';
import { headLabel } from '@/features/branches/refInfo';
import { fileList, runRefOp, type RefOpLabels } from '@/features/branches/run';
import type { ApiError } from '@/lib/api';
import { abortFlow } from '@/features/sequence/flows';
import { confirm } from '@/lib/confirm';
import type { ToastText, Tracked } from '@/lib/opToast';
import { refreshRemotes, setRemoteBusy, type RemoteBusy } from '@/state/remotes';
import { refsKey, type Tab } from '@/state/tabs';
import { refreshWorkdir } from '@/state/workdir';
import { fetchRemotes, isFetchError, pullHead, type FetchResult, type PullMode, type PullResult } from './api';

// Running remote ops from the UI: runRemoteOp (busy flag, toast, graph and remotes refresh), and the fetch and pull
// flows with their outcome toasts (docs/remotes.md → Using it).

export const PULL_LABEL: Record<PullMode, string> = { ff: 'Pull (fast-forward if possible)', ffOnly: 'Pull (fast-forward only)', rebase: 'Pull (rebase)' };

/** runRefOp (toast, then a graph refresh) with the project's `kind` (if any) busy while it runs, then the remotes listed again. */
export async function runRemoteOp<T>(tab: Tab, kind: RemoteBusy | null, labels: RefOpLabels<T>, fn: () => Promise<T>): Promise<Tracked<T>> {
  if (kind) setRemoteBusy(refsKey(tab), kind, true);
  try {
    return await runRefOp(tab, labels, fn);
  } finally {
    if (kind) setRemoteBusy(refsKey(tab), kind, false);
    void refreshRemotes(tab);
  }
}

const shortTracking = (ref: string) => ref.replace(/^refs\/remotes\//, '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a fetch changed, as a phrase: "2 updated, 1 new, 1 pruned" or "up to date". */
function changeSummary(r: FetchResult): string {
  const ok = r.remotes.flatMap((x) => (isFetchError(x) ? [] : x.changes));
  const counts = [
    [ok.filter((c) => c.old && c.new).length, 'updated'], [ok.filter((c) => !c.old).length, 'new'], [ok.filter((c) => !c.new).length, 'pruned'],
  ] as const;
  const parts = counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  return parts.length ? parts.join(', ') : 'up to date';
}

/**
 * A fetch's outcome toast: what changed; a warning when a remote failed (`remote: message`), was partly fetched, or a
 * dangling symbolic ref came to life (`ref → target`).
 */
export function fetchToast(r: FetchResult, what: string): string | ToastText {
  const lines: string[] = [];
  for (const x of r.remotes) {
    if (isFetchError(x)) lines.push(`${x.remote}: ${x.error.message}`);
    else if (x.partial) lines.push(`${x.remote}: partly fetched`);
  }
  const symrefs = r.remotes.flatMap((x) => (isFetchError(x) ? [] : x.symrefsResolved));
  for (const s of symrefs) lines.push(`${s.ref} → ${s.target}: a symbolic ref this fetch brought to life; the next fetch refuses it until it is removed`);
  const summary = `Fetched ${what}: ${changeSummary(r)}`;
  if (!lines.length) return summary;
  const failed = r.remotes.filter(isFetchError).length;
  return { tone: 'warning', title: failed ? `Fetched ${r.remotes.length - failed} of ${plural(r.remotes.length, 'remote')}` : summary, description: lines.join('\n') };
}

/** Fetches `remote` (null: every remote). `prune` asks first: it deletes remote-tracking branches. */
export async function fetchFlow(tab: Tab, remote: string | null, prune = false): Promise<void> {
  const what = remote ?? 'all remotes';
  if (prune) {
    const ok = await confirm({
      title: `Fetch ${what} and prune?`,
      body: 'Deletes remote-tracking branches whose branch is gone from the remote; local branches and tags are untouched.',
      confirmLabel: 'Fetch and prune',
    });
    if (!ok) return;
  }
  await runRemoteOp(tab, 'fetch', { running: `Fetching ${what}…`, done: (r) => fetchToast(r, what) }, () => fetchRemotes(tab, remote, prune));
}

function pullDone(tab: Tab, r: PullResult): string | ToastText {
  const up = shortTracking(r.upstream);
  const head = headLabel(tab);
  switch (r.outcome) {
    case 'upToDate': return `${head} is up to date with ${up}`;
    case 'fastForward': return `Fast-forwarded ${head} to ${up}`;
    case 'merged': return `Merged ${up} into ${head}`;
    case 'rebased': return `Rebased ${head} onto ${up}`;
    case 'conflicts': {
      // A rebase pull's conflicts stay in progress as a merge pull's do: the Changes banner continues or aborts either.
      const kind = r.mode === 'rebase' ? 'rebase' : 'merge';
      return {
        tone: 'warning', title: 'The pull stopped on conflicts',
        description: `Conflicts in ${fileList(r.files)}. Resolve them, then Continue, or abort the ${kind}.`,
        action: { label: `Abort ${kind}…`, onClick: () => void abortFlow(tab, kind) },
      };
    }
  }
}

function pullFailed(e: ApiError): Partial<ToastText> | undefined {
  if (e.code === 'NOT_FAST_FORWARD') return { title: 'Diverged: pick Pull (fast-forward if possible) or Pull (rebase)', description: e.message };
  if (e.code === 'DIRTY_WORKTREE') return { title: 'Commit or stash first', description: e.message };
  return undefined;
}

/** Pulls HEAD's upstream with `mode`. A rebase of a code-conductor/* HEAD asks first (withCcHeadAck). */
export function pullFlow(tab: Tab, mode: PullMode): void {
  const label = `Rebasing ${headLabel(tab)}`;
  const go = (ccOwned?: true): Promise<unknown> => runRemoteOp(tab, 'pull', {
    running: `${PULL_LABEL[mode]}…`, done: (r) => pullDone(tab, r),
    failed: (e) => ccRetry(tab, 'rebase', label, go)(e) ?? pullFailed(e),
  }, () => pullHead(tab, mode, ccOwned)).finally(() => refreshWorkdir(tab));
  if (mode === 'rebase') withCcHeadAck(tab, 'rebase', label, go);
  else void go();
}
