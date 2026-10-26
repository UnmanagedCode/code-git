import { perRemote } from '@/features/branches/actions';
import type { BranchDropCtx, RefCtx, RemoteCtx } from '@/features/graph/contexts';
import { confirm } from '@/lib/confirm';
import type { MenuAction } from '@/shell/menus';
import { getTracking, trackingOf } from '@/state/branchTracking';
import { getGraph } from '@/state/graph';
import { openRemoteDialog } from '@/state/remoteDialog';
import { remoteInfo } from '@/state/remotes';
import { refsKey, type Tab } from '@/state/tabs';
import { removeRemote } from './api';
import { pushFlow } from './pushFlow';
import { fetchFlow, runRemoteOp } from './run';
import { ArrowUpFromLineIcon, CloudDownloadIcon, CopyIcon, PencilIcon, Trash2Icon } from 'lucide-react';

// The remote actions (docs/remotes.md → Using it). Orders: on a branch and a drop, 250 (group `remote`, beside the tag
// push); on a remote, 150 fetch, 700 edit, 720 remove, 900 copy.

/** The local branch's upstream on a remote, or null. */
const remoteUpstream = (tab: Tab, ref: string): string | null => {
  const up = trackingOf(tab, ref)?.upstream ?? null;
  return up?.startsWith('refs/remotes/') ? up : null;
};

const isLocal = (c: RefCtx) => c.ref.kind === 'local';
const dropPushes = (c: BranchDropCtx) => c.source.kind === 'local' && c.target.kind === 'remote' && !!c.target.remote && !!c.source.oid;
/** The dropped-on remote branch's name on its remote: `origin/feature/a` → `feature/a`. */
const dropTo = (c: BranchDropCtx) => c.target.short.slice(c.target.remote!.length + 1);

/** The tracking refs a remove deletes (as the graph lists them) and the local branches whose upstream it is. */
function removalOf(tab: Tab, remote: string) {
  const refs = (getGraph(tab).refs?.refs ?? []).filter((r) => r.kind === 'remote' && r.remote === remote);
  const branches = Object.entries(getTracking(tab).data?.branches ?? {})
    .filter(([, t]) => t.upstream?.startsWith(`refs/remotes/${remote}/`)).map(([ref]) => ref.replace(/^refs\/heads\//, ''));
  return { refs, branches };
}

async function removeFlow(tab: Tab, remote: string): Promise<void> {
  const { refs, branches } = removalOf(tab, remote);
  const ok = await confirm({
    title: `Remove remote ${remote}?`,
    body: `Deletes its configuration and its ${refs.length} remote-tracking ${refs.length === 1 ? 'branch' : 'branches'} here; nothing changes on the remote. ${branches.length ? 'These branches lose their upstream:' : 'No local branch tracks it.'}`,
    items: branches,
    confirmLabel: 'Remove remote',
  });
  if (!ok) return;
  await runRemoteOp(tab, null, { running: `Removing ${remote}…`, done: () => `Removed remote ${remote}` }, () => removeRemote(tab, remote));
}

export const REMOTE_ACTIONS: MenuAction<never>[] = [
  // ---- a local branch ----
  {
    id: 'remotes.branch.push', icon: ArrowUpFromLineIcon, context: 'branch', group: 'remote', order: 250,
    label: 'Push',
    when: (c: RefCtx) => isLocal(c) && !!c.ref.oid && remoteUpstream(c.tab, c.ref.name) !== null,
    run: (c: RefCtx) => void pushFlow(c.tab, { branch: c.ref.short }),
  },
  ...perRemote<RefCtx>('remotes.branch.pushTo', 'branch', { group: 'remote', order: 251, icon: ArrowUpFromLineIcon }, { one: (remote) => `Push to ${remote}…`, many: 'Push to remote' },
    (c, remote) => openRemoteDialog({ kind: 'push', tab: c.tab, branch: c.ref.short, remote }))
    .map((a) => ({ ...a, when: (c: RefCtx) => isLocal(c) && !!c.ref.oid && (a.when?.(c) ?? true) })),
  // ---- a branch dropped on a remote branch ----
  {
    id: 'remotes.drop.push', icon: ArrowUpFromLineIcon, context: 'branch-drop', group: 'remote', order: 250,
    label: (c: BranchDropCtx) => `Push ${c.source.short} to ${c.target.short}`,
    when: dropPushes,
    run: (c: BranchDropCtx) => void pushFlow(c.tab, {
      branch: c.source.short, remote: c.target.remote!, to: dropTo(c), setUpstream: remoteUpstream(c.tab, c.source.name) === null,
    }),
  },
  // ---- a remote (refs panel) ----
  {
    id: 'remotes.remote.fetch', icon: CloudDownloadIcon, context: 'remote', group: 'fetch', order: 150,
    label: (c: RemoteCtx) => `Fetch ${c.remote}`, run: (c: RemoteCtx) => void fetchFlow(c.tab, c.remote),
  },
  {
    id: 'remotes.remote.fetchPrune', icon: CloudDownloadIcon, context: 'remote', group: 'fetch', order: 151,
    label: (c: RemoteCtx) => `Fetch ${c.remote} (prune)…`, run: (c: RemoteCtx) => void fetchFlow(c.tab, c.remote, true),
  },
  {
    id: 'remotes.remote.edit', icon: PencilIcon, context: 'remote', group: 'edit', order: 700, label: 'Edit…',
    when: (c: RemoteCtx) => remoteInfo(refsKey(c.tab), c.remote)?.legacy === false,
    run: (c: RemoteCtx) => openRemoteDialog({ kind: 'edit', tab: c.tab, remote: c.remote }),
  },
  {
    id: 'remotes.remote.remove', icon: Trash2Icon, context: 'remote', group: 'edit', order: 720, destructive: true, label: 'Remove…',
    when: (c: RemoteCtx) => remoteInfo(refsKey(c.tab), c.remote)?.legacy === false,
    run: (c: RemoteCtx) => void removeFlow(c.tab, c.remote),
  },
  {
    id: 'remotes.remote.copyUrl', icon: CopyIcon, context: 'remote', group: 'copy', order: 900, label: 'Copy URL',
    when: (c: RemoteCtx) => !!remoteInfo(refsKey(c.tab), c.remote)?.displayUrl,
    run: (c: RemoteCtx) => void navigator.clipboard?.writeText(remoteInfo(refsKey(c.tab), c.remote)!.displayUrl!),
  },
] as MenuAction<never>[];

