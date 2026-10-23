import { abbrev, headOf, isCcOwned, refNamed, shortBranch } from '@/features/branches/refInfo';
import type { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { trackOp, type ToastText } from '@/lib/opToast';
import { trackingOf } from '@/state/branchTracking';
import { openRemoteDialog } from '@/state/remoteDialog';
import type { Tab } from '@/state/tabs';
import { peekBranch, pushBranch, type BranchPushResult, type PushRequest } from './api';
import { fetchFlow, runRemoteOp } from './run';

// Pushing a branch, from every surface (toolbar, menus, drop, push-after-commit): the code-conductor/* warning, the push,
// and on a rejection the force-with-lease flow — which first asks the remote where the branch is (remote.peek) and
// offers Fetch instead of force when the tracking ref is stale. Nothing is sent unless a confirmation resolves true.

/** What a push names; no `remote`: the branch's upstream. */
export type PushTarget = Omit<PushRequest, 'expect' | 'ccOwned'>;

const ccWarning = (names: string[]) =>
  `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} owned by code-conductor: its worktree's sync and merge expect only the agent to move ${names.length > 1 ? 'them' : 'it'} on the remote.`;

function pushDone(r: BranchPushResult): string {
  const where = `${r.remote}/${r.to}`;
  const up = r.upstreamSet ? ` (upstream set)` : '';
  if (r.upToDate) return `${r.branch} is already at ${where}${up}`;
  if (r.created) return `Pushed ${r.branch} to a new branch ${where}${up}`;
  return `${r.forced ? 'Force-pushed' : 'Pushed'} ${r.branch} to ${where}${up}`;
}

const rejectedBody = (e: ApiError) => (e.body ?? {}) as { remote?: unknown; to?: unknown; rejected?: { ref: string; reason: string }[] };

/** Runs the push; a rejection offers Force with lease (not for a lease that was itself rejected), a stale cc refusal the warning. */
function send(tab: Tab, req: PushRequest): Promise<unknown> {
  return runRemoteOp(tab, 'push', {
    running: `Pushing ${req.branch}…`,
    done: pushDone,
    failed: (e): Partial<ToastText> | undefined => {
      if (e.code === 'CC_OWNED_BRANCH') {
        const branches = (e.body as { branches?: unknown } | undefined)?.branches;
        const names = Array.isArray(branches) ? branches.filter((b): b is string => typeof b === 'string') : [];
        return { action: { label: 'Review…', onClick: () => void confirmCc(names, req.branch).then((ok) => { if (ok) void send(tab, { ...req, ccOwned: true }); }) } };
      }
      if (e.code !== 'PUSH_REJECTED') return undefined;
      const lines = (rejectedBody(e).rejected ?? []).map((r) => `${r.ref}: ${r.reason}`);
      return {
        title: req.expect === undefined ? 'The remote rejected the push' : 'The remote moved: the lease refused the force push',
        description: lines.join('\n') || e.message,
        action: req.expect === undefined ? { label: 'Force with lease…', onClick: () => void forceFlow(tab, req, e) } : undefined,
      };
    },
  }, () => pushBranch(tab, req));
}

const confirmCc = (names: string[], branch: string) => confirm({ title: `Push ${branch}?`, body: ccWarning(names), confirmLabel: 'Push anyway' });

/** Pushes `p` (asking first when it names a code-conductor/* branch). */
export async function pushFlow(tab: Tab, p: PushTarget): Promise<void> {
  const cc = [...new Set([p.branch, ...(p.remote && p.to ? [p.to] : [])])].filter(isCcOwned);
  if (cc.length && !(await confirmCc(cc, p.branch))) return;
  await send(tab, { ...p, ...(cc.length ? { ccOwned: true } : {}) });
}

/**
 * After a rejected push: asks the remote where the branch is. Stale tracking ref → offers Fetch, never force; else
 * the destructive confirmation, whose confirm re-pushes leasing on the remote value it showed.
 */
export async function forceFlow(tab: Tab, req: PushRequest, e: ApiError): Promise<void> {
  const { remote, to } = rejectedBody(e);
  if (typeof remote !== 'string' || typeof to !== 'string') return;
  const peek = await trackOp(() => peekBranch(tab, remote, to), { running: `Checking ${remote}/${to}…`, done: () => null });
  if (!peek.ok) return;
  const p = peek.result;
  const at = (oid: string | null | undefined) => (oid ? abbrev(oid) : 'nothing');
  if (p.stale) {
    const fetch = await confirm({
      title: `${remote}/${to} moved since the last fetch`,
      body: `On ${remote} it is at ${at(p.oid)}; the remote-tracking ref here says ${at(p.tracking?.oid)}. Fetch and review the new commits before forcing anything.`,
      confirmLabel: `Fetch ${remote}`,
    });
    if (fetch) await fetchFlow(tab, remote);
    return;
  }
  const local = refNamed(tab, `refs/heads/${req.branch}`)?.oid;
  const ok = await confirm({
    title: `Force push ${req.branch}?`,
    body: `Overwrite ${remote}/${to} (at ${at(p.oid)}) with ${req.branch} (${at(local)})? Commits only on the remote branch are lost. Uses --force-with-lease: refused if the remote moved.`,
    confirmLabel: 'Force push', irreversible: true,
  });
  if (ok) await send(tab, { ...req, remote, to, expect: p.oid });
}

/** Pushes HEAD's branch: to its upstream at once, or through the Push dialog when it has none on a remote. */
export function pushHead(tab: Tab): void {
  const branch = headOf(tab).branch;
  if (!branch) return;
  const upstream = trackingOf(tab, branch)?.upstream;
  if (upstream?.startsWith('refs/remotes/')) void pushFlow(tab, { branch: shortBranch(branch) });
  else openRemoteDialog({ kind: 'push', tab, branch: shortBranch(branch), remote: null });
}
