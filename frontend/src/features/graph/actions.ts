import { runOp } from '@/lib/endpoints';
import type { MenuAction } from '@/shell/menus';
import { getPrefs, toggled, updatePrefs, type GraphPrefs } from '@/state/graphPrefs';
import { dispatchSelection, toSelected } from '@/state/graphSelection';
import { getGraph } from '@/state/graph';
import { dispatchTabs } from '@/state/tabs';
import type { CommitCtx, CommitsCtx, FileCtx, RefCtx, RemoteCtx, StashCtx, WipCtx, WorktreeCtx } from './contexts';
import { openIn, selectionDiff } from './diffWiring';
import { requestDetails, requestJump } from './jump';
import { buildInputs } from './rows';
import type { CommitDetail } from './types';

// The graph's own menu actions: view (800), copy (900), visibility (950). Write actions come from later cards
// (docs/architecture.md → Extension points has the order convention).

const copy = (text: string) => navigator.clipboard?.writeText(text);
/** The whole message when it can be read, else the subject. */
async function copyMessage(tab: CommitCtx['tab'], oid: string, subject: string) {
  try {
    const d = await runOp<CommitDetail>('graph.commit', tab, { oid });
    await copy(d.body ? `${d.subject}\n\n${d.body}` : d.subject);
  } catch {
    await copy(subject);
  }
}
const prefs = (c: { tab: { project: string } }) => getPrefs(c.tab.project);
const set = (c: { tab: { project: string } }, f: (p: GraphPrefs) => GraphPrefs) => updatePrefs(c.tab.project, f);
const select = (c: CommitCtx, id: string) => {
  const g = getGraph(c.tab);
  const { rows } = buildInputs(g.commits, [], g.refs?.stashes ?? []);
  dispatchSelection(c.tab, { type: 'move', id, rows });
  requestDetails(c.tab);
};

type RefAction = MenuAction<RefCtx>;
const refActions = (context: 'branch' | 'tag'): RefAction[] => [
  { id: `graph.${context}.jump`, context, label: 'Jump to commit', group: 'view', order: 800, when: (c) => !!c.ref.oid, run: (c) => requestJump(c.tab, c.ref.oid!) },
  { id: `graph.${context}.copyName`, context, label: 'Copy name', group: 'copy', order: 900, run: (c) => copy(c.ref.short) },
  {
    id: `graph.${context}.hide`, context, group: 'visibility', order: 950,
    label: (c) => (prefs(c).hidden.includes(c.ref.name) ? 'Show' : 'Hide'),
    // The checked-out branch cannot be hidden.
    when: (c) => !c.ref.isHead,
    run: (c) => set(c, (p) => ({ ...p, hidden: toggled(p.hidden, c.ref.name, !p.hidden.includes(c.ref.name)) })),
  },
  {
    id: `graph.${context}.solo`, context, group: 'visibility', order: 951,
    label: (c) => (prefs(c).soloed.includes(c.ref.name) ? 'Unsolo' : 'Solo'),
    run: (c) => set(c, (p) => ({ ...p, soloed: toggled(p.soloed, c.ref.name, !p.soloed.includes(c.ref.name)) })),
  },
];

export const GRAPH_ACTIONS: MenuAction<never>[] = [
  { id: 'graph.commit.details', context: 'commit', label: 'Show details', group: 'view', order: 800, run: (c: CommitCtx) => select(c, c.commit.oid) },
  {
    id: 'graph.commit.viewChanges', context: 'commit', label: 'View changes', group: 'view', order: 801,
    run: (c: CommitCtx) => openIn(c.tab, c.tab, { kind: 'commit', rev: c.commit.oid }),
  },
  {
    id: 'graph.commit.compareWorktree', context: 'commit', label: 'Compare with working directory', group: 'view', order: 802,
    run: (c: CommitCtx) => openIn(c.tab, c.tab, { kind: 'worktree', rev: c.commit.oid }),
  },
  {
    id: 'graph.commits.viewDiff', context: 'commits', label: 'View combined diff', group: 'view', order: 800,
    when: (c: CommitsCtx) => !!selectionDiff(c.tab, c.rows.map(toSelected), getGraph(c.tab).checkouts),
    run: (c: CommitsCtx) => {
      const d = selectionDiff(c.tab, c.rows.map(toSelected), getGraph(c.tab).checkouts);
      if (d) openIn(c.tab, d.target, d.source);
    },
  },
  { id: 'graph.commit.copySha', context: 'commit', label: 'Copy SHA', group: 'copy', order: 900, run: (c: CommitCtx) => copy(c.commit.oid) },
  { id: 'graph.commit.copyMessage', context: 'commit', label: 'Copy message', group: 'copy', order: 901, run: (c: CommitCtx) => copyMessage(c.tab, c.commit.oid, c.commit.subject) },
  {
    id: 'graph.commits.copyShas', context: 'commits', label: (c: CommitsCtx) => `Copy ${c.rows.length} SHAs`, group: 'copy', order: 900,
    run: (c: CommitsCtx) => copy(c.rows.map((r) => (r.kind === 'commit' ? r.item.oid : r.kind === 'stash' ? r.stash.oid : null)).filter(Boolean).join('\n')),
  },
  ...refActions('branch'),
  {
    id: 'graph.branch.pin', context: 'branch', group: 'visibility', order: 952,
    label: (c: RefCtx) => (prefs(c).pinned.includes(c.ref.name) ? 'Unpin' : 'Pin to left'),
    run: (c: RefCtx) => set(c, (p) => ({ ...p, pinned: toggled(p.pinned, c.ref.name, !p.pinned.includes(c.ref.name)) })),
  },
  ...refActions('tag'),
  {
    id: 'graph.remote.hide', context: 'remote', group: 'visibility', order: 950,
    label: (c: RemoteCtx) => (prefs(c).hiddenRemotes.includes(c.remote) ? 'Show remote' : 'Hide remote'),
    run: (c: RemoteCtx) => set(c, (p) => ({ ...p, hiddenRemotes: toggled(p.hiddenRemotes, c.remote, !p.hiddenRemotes.includes(c.remote)) })),
  },
  {
    id: 'graph.remote.solo', context: 'remote', group: 'visibility', order: 951,
    label: (c: RemoteCtx) => (prefs(c).soloedRemotes.includes(c.remote) ? 'Unsolo remote' : 'Solo remote'),
    run: (c: RemoteCtx) => set(c, (p) => ({ ...p, soloedRemotes: toggled(p.soloedRemotes, c.remote, !p.soloedRemotes.includes(c.remote)) })),
  },
  {
    id: 'graph.remote.showAll', context: 'remote', label: 'Show all', group: 'visibility', order: 952,
    when: (c: RemoteCtx) => prefs(c).hiddenRemotes.includes(c.remote) || prefs(c).hidden.some((n) => n.startsWith(`refs/remotes/${c.remote}/`)),
    run: (c: RemoteCtx) => set(c, (p) => ({
      ...p, hiddenRemotes: p.hiddenRemotes.filter((r) => r !== c.remote), hidden: p.hidden.filter((n) => !n.startsWith(`refs/remotes/${c.remote}/`)),
    })),
  },
  {
    id: 'graph.stash.details', context: 'stash', label: 'Show details', group: 'view', order: 800,
    // A hidden Stashes section has no stash rows to select.
    when: (c: StashCtx) => !prefs(c).hiddenSections.includes('stashes'),
    // From the refs panel the stash's base may not be loaded yet: jump (page to it), then select the stash row.
    run: (c: StashCtx) => {
      if (c.stash.parents[0]) requestJump(c.tab, c.stash.parents[0], `stash:${c.stash.oid}`);
      requestDetails(c.tab);
    },
  },
  {
    id: 'graph.stash.viewChanges', context: 'stash', label: 'View changes', group: 'view', order: 801,
    run: (c: StashCtx) => openIn(c.tab, c.tab, { kind: 'commit', rev: c.stash.oid }),
  },
  { id: 'graph.stash.copyMessage', context: 'stash', label: 'Copy message', group: 'copy', order: 900, run: (c: StashCtx) => copy(c.stash.subject) },
  {
    id: 'graph.stash.hide', context: 'stash', label: 'Hide stashes', group: 'visibility', order: 950,
    run: (c: StashCtx) => set(c, (p) => ({ ...p, hiddenSections: toggled(p.hiddenSections, 'stashes', true) })),
  },
  {
    id: 'graph.wip.unstaged', context: 'wip', label: 'View unstaged changes', group: 'view', order: 790,
    run: (c: WipCtx) => openIn(c.tab, c.checkout, { kind: 'unstaged' }),
  },
  {
    id: 'graph.wip.staged', context: 'wip', label: 'View staged changes', group: 'view', order: 791,
    run: (c: WipCtx) => openIn(c.tab, c.checkout, { kind: 'staged' }),
  },
  {
    id: 'graph.wip.open', context: 'wip', label: (c: WipCtx) => `Open ${c.name} in a tab`, group: 'view', order: 800,
    when: (c: WipCtx) => !c.isOwn, run: (c: WipCtx) => dispatchTabs({ type: 'open', tab: c.checkout }),
  },
  {
    id: 'graph.worktree.open', context: 'worktree', label: 'Open in a tab', group: 'view', order: 800,
    when: (c: WorktreeCtx) => c.ccCheckout !== null, run: (c: WorktreeCtx) => dispatchTabs({ type: 'open', tab: c.ccCheckout! }),
  },
  { id: 'graph.worktree.copyPath', context: 'worktree', label: 'Copy path', group: 'copy', order: 900, run: (c: WorktreeCtx) => copy(c.worktree.path) },
  { id: 'graph.file.copyPath', context: 'file', label: 'Copy path', group: 'copy', order: 900, run: (c: FileCtx) => copy(c.file.path) },
] as MenuAction<never>[];
