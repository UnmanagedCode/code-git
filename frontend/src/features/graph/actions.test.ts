import { expect, test, vi } from 'vitest';
import { labelOf, resolveActions, type MenuAction } from '@/shell/menus';
import { getPrefs, updatePrefs } from '@/state/graphPrefs';
import { tabsStore } from '@/state/tabs';
import { commit, oid, ref, stash, worktree } from '@/test/graphData';
import { GRAPH_ACTIONS } from './actions';
import { jumpStore } from './jump';

const TAB = { project: 'app', worktree: null };
const all = GRAPH_ACTIONS as MenuAction<unknown>[];
const menu = (context: string, ctx: unknown) => resolveActions(all, context, ctx).map((a) => labelOf(a, ctx));
const run = async (context: string, ctx: unknown, label: string) => {
  const a = resolveActions(all, context, ctx).find((x) => labelOf(x, ctx) === label);
  if (!a) throw new Error(`no ${label} in ${context}`);
  await a.run!(ctx);
};

test('commit, commits and stash menus: view, copy, visibility in that order', () => {
  expect(menu('commit', { tab: TAB, commit: commit(oid(1)), refs: [], selection: [] })).toEqual(['Show details', 'Copy SHA', 'Copy message']);
  expect(menu('commits', { tab: TAB, rows: [] })).toEqual(['Copy 0 SHAs']);
  expect(menu('stash', { tab: TAB, stash: stash(oid(2), oid(1)) })).toEqual(['Show details', 'Copy message', 'Hide stashes']);
});

test('branch menu: jump, copy, hide/solo/pin toggles that update prefs; no Hide on the checked-out branch', async () => {
  const feat = { tab: TAB, ref: ref('refs/heads/feat', oid(3)) };
  expect(menu('branch', feat)).toEqual(['Jump to commit', 'Copy name', 'Hide', 'Solo', 'Pin to left']);
  await run('branch', feat, 'Hide');
  await run('branch', feat, 'Solo');
  await run('branch', feat, 'Pin to left');
  expect(getPrefs('app')).toMatchObject({ hidden: ['refs/heads/feat'], soloed: ['refs/heads/feat'], pinned: ['refs/heads/feat'] });
  expect(menu('branch', feat)).toEqual(['Jump to commit', 'Copy name', 'Show', 'Unsolo', 'Unpin']);
  expect(menu('branch', { tab: TAB, ref: ref('refs/heads/main', oid(4), { isHead: true }) })).not.toContain('Hide');
  await run('branch', feat, 'Jump to commit');
  expect(jumpStore.get()).toMatchObject({ oid: oid(3) });
  expect(menu('tag', { tab: TAB, ref: ref('refs/tags/v1', null) })).toEqual(['Copy name', 'Hide', 'Solo']);
});

test('remote menu: hide, solo, and Show all only while something on it is hidden', async () => {
  const c = { tab: TAB, remote: 'origin' };
  expect(menu('remote', c)).toEqual(['Hide remote', 'Solo remote']);
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/remotes/origin/x', 'refs/heads/y'] }));
  expect(menu('remote', c)).toEqual(['Hide remote', 'Solo remote', 'Show all']);
  await run('remote', c, 'Hide remote');
  await run('remote', c, 'Show all');
  expect(getPrefs('app')).toMatchObject({ hidden: ['refs/heads/y'], hiddenRemotes: [] });
});

test('copy actions write to the clipboard; Copy message reads the whole message', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { subject: 'S', body: 'B' } }), { status: 200 })));
  await run('commit', { tab: TAB, commit: commit(oid(1)), refs: [], selection: [] }, 'Copy SHA');
  await run('commit', { tab: TAB, commit: commit(oid(1)), refs: [], selection: [] }, 'Copy message');
  await run('commits', { tab: TAB, rows: [{ kind: 'commit', id: oid(1), item: commit(oid(1)) }, { kind: 'stash', id: 's', stash: stash(oid(2), oid(1)) }] }, 'Copy 2 SHAs');
  await run('worktree', { tab: TAB, worktree: worktree('/p/wt', null, null), ccCheckout: null }, 'Copy path');
  await run('file', { tab: TAB, commit: oid(1), parent: null, file: { status: 'M', path: 'a/b.ts', oldPath: null } }, 'Copy path');
  expect(writeText.mock.calls.map((c) => (c as unknown[])[0])).toEqual([oid(1), 'S\n\nB', `${oid(1)}\n${oid(2)}`, '/p/wt', 'a/b.ts']);
});

test('WIP and worktree menus open another checkout in a tab; the own WIP and an unknown worktree offer no Open', async () => {
  const wt = { project: 'app', worktree: 'wt' };
  expect(menu('wip', { tab: TAB, checkout: TAB, name: 'app', isOwn: true })).toEqual([]);
  await run('wip', { tab: TAB, checkout: wt, name: 'wt', isOwn: false }, 'Open wt in a tab');
  expect(tabsStore.get().open).toEqual([wt]);
  expect(menu('worktree', { tab: TAB, worktree: worktree('/x', null, null), ccCheckout: null })).toEqual(['Copy path']);
  await run('worktree', { tab: TAB, worktree: worktree('/x', null, null), ccCheckout: TAB }, 'Open in a tab');
  expect(tabsStore.get().open).toEqual([wt, TAB]);
});
