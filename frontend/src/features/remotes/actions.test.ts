import { waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { BranchDropCtx, RefCtx, RemoteCtx } from '@/features/graph/contexts';
import { toDragRef } from '@/features/graph/drag';
import type { Ref } from '@/features/graph/types';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { actionsFor, labelOf, type ResolvedAction } from '@/shell/menus';
import { trackingStore } from '@/state/branchTracking';
import { remoteDialogStore } from '@/state/remoteDialog';
import { oid, ref } from '@/test/graphData';
import { remote, remotesWorld, T } from '@/test/remotesWorld';

const MAIN = ref('refs/heads/main', oid(9), { isHead: true });
const FEATURE = ref('refs/heads/feature', oid(7));
const ORIGIN_MAIN = ref('refs/remotes/origin/main', oid(8));
const ORIGIN_DEEP = ref('refs/remotes/origin/team/x', oid(5));
const TAG = ref('refs/tags/v1', oid(5));

function labels<C>(list: ResolvedAction<C>[], ctx: C): string[] {
  return list.flatMap((a) => (a.children ? labels(a.children, ctx).map((l) => `${labelOf(a, ctx)} › ${l}`) : [labelOf(a, ctx)]));
}
const menu = (context: string, ctx: unknown) => labels(actionsFor(context, ctx), ctx);
const remoteItems = (context: string, ctx: unknown) => menu(context, ctx).filter((l) => /^(Push|Fetch|Edit|Remove|Copy URL)/.test(l));
function run<C>(context: string, ctx: C, path: string) {
  const [top, child] = path.split(' › ');
  const a = actionsFor(context, ctx).find((x) => labelOf(x, ctx) === top);
  const hit = child ? a?.children?.find((x) => labelOf(x, ctx) === child) : a;
  if (!hit?.run) throw new Error(`no "${path}" in ${menu(context, ctx).join(' | ')}`);
  return hit.run(ctx);
}
const drop = (source: Ref, target: Ref): BranchDropCtx => ({ tab: T, source: toDragRef(source)!, target: toDragRef(target)! });
const branch = (r: Ref): RefCtx => ({ tab: T, ref: r });
const remoteCtx = (name: string): RemoteCtx => ({ tab: T, remote: name });

test('a local branch dropped on a remote branch offers Push <source> to <target>, and nothing else of this card', async () => {
  const w = remotesWorld();
  expect(remoteItems('branch-drop', drop(FEATURE, ORIGIN_DEEP))).toEqual(['Push feature to origin/team/x']);
  expect(remoteItems('branch-drop', drop(FEATURE, MAIN))).toEqual([]);
  expect(remoteItems('branch-drop', drop(ORIGIN_MAIN, FEATURE))).toEqual([]);
  expect(remoteItems('branch-drop', drop(ORIGIN_MAIN, ORIGIN_DEEP))).toEqual([]);
  // `feature` has no upstream: the drop sets it; `main` has one: it does not.
  await run('branch-drop', drop(FEATURE, ORIGIN_DEEP), 'Push feature to origin/team/x');
  await run('branch-drop', drop(MAIN, ORIGIN_MAIN), 'Push main to origin/main');
  await waitFor(() => expect(w.posts('remote.push')).toEqual([
    { branch: 'feature', remote: 'origin', to: 'team/x', setUpstream: true },
    { branch: 'main', remote: 'origin', to: 'main' },
  ]));
});

test('a local branch: Push (to its upstream) when it has one, and Push to <remote>… (a submenu for several) opening the Push dialog; none on a remote branch or tag', async () => {
  const w = remotesWorld();
  expect(remoteItems('branch', branch(MAIN))).toEqual(['Push', 'Push to origin…']);
  expect(remoteItems('branch', branch(FEATURE))).toEqual(['Push to origin…']);
  expect(remoteItems('branch', branch(ORIGIN_MAIN))).toEqual([]);
  expect(remoteItems('tag', { tab: T, ref: TAG })).not.toContain('Push');
  await run('branch', branch(MAIN), 'Push');
  await waitFor(() => expect(w.posts('remote.push')).toEqual([{ branch: 'main' }]));
  await run('branch', branch(FEATURE), 'Push to origin…');
  expect(remoteDialogStore.get()).toEqual({ kind: 'push', tab: T, branch: 'feature', remote: 'origin' });
  trackingStore.set((m) => new Map(m).set('app', { ...m.get('app')!, data: { ...m.get('app')!.data!, remotes: ['origin', 'upstream'] } }));
  expect(remoteItems('branch', branch(FEATURE))).toEqual(['Push to remote › origin', 'Push to remote › upstream']);
  await run('branch', branch(FEATURE), 'Push to remote › upstream');
  expect(remoteDialogStore.get()).toMatchObject({ kind: 'push', branch: 'feature', remote: 'upstream' });
});

test('a remote: Fetch, Fetch (prune)…, Edit…, Remove…, Copy URL in that order; a legacy remote has no Edit or Remove', async () => {
  const w = remotesWorld({ remotes: [remote('origin'), remote('leg', { legacy: true, urls: [], displayUrl: null })] });
  expect(remoteItems('remote', remoteCtx('origin'))).toEqual(['Fetch origin', 'Fetch origin (prune)…', 'Edit…', 'Remove…', 'Copy URL']);
  expect(remoteItems('remote', remoteCtx('leg'))).toEqual(['Fetch leg', 'Fetch leg (prune)…']);
  await run('remote', remoteCtx('origin'), 'Fetch origin');
  await waitFor(() => expect(w.posts('remote.fetch')).toEqual([{ remote: 'origin' }]));
  void run('remote', remoteCtx('origin'), 'Fetch origin (prune)…');
  await waitFor(() => expect(confirmStore.get()).toBeTruthy());
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.fetch').at(-1)).toEqual({ remote: 'origin', prune: true }));
  await run('remote', remoteCtx('origin'), 'Edit…');
  expect(remoteDialogStore.get()).toEqual({ kind: 'edit', tab: T, remote: 'origin' });
});

test('Remove… confirms naming the tracking-ref count and the branches that lose their upstream; only Confirm removes', async () => {
  const w = remotesWorld();
  void run('remote', remoteCtx('origin'), 'Remove…');
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Remove remote'));
  const opts = confirmStore.get()!.opts;
  expect(opts.body).toContain('its 1 remote-tracking branch here');
  expect(opts.items).toEqual(['main', 'code-conductor/wt']);
  settleConfirm(false);
  await new Promise((r) => setTimeout(r, 0));
  expect(w.posts('remote.remove')).toEqual([]);
  void run('remote', remoteCtx('origin'), 'Remove…');
  await waitFor(() => expect(confirmStore.get()).toBeTruthy());
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.remove')).toEqual([{ name: 'origin' }]));
});

test('Copy URL copies the masked display url, never the stored one', async () => {
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s: string) => { written.push(s); } }, configurable: true });
  remotesWorld({ remotes: [remote('origin', { urls: ['https://u:secret@h/r.git'], displayUrl: 'https://u:***@h/r.git' })] });
  await run('remote', remoteCtx('origin'), 'Copy URL');
  expect(written).toEqual(['https://u:***@h/r.git']);
});
