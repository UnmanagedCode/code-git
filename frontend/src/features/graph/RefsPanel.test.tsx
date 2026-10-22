import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { loadNextPage } from '@/state/graph';
import { getPrefs } from '@/state/graphPrefs';
import { getSelection } from '@/state/graphSelection';
import { loadSummary } from '@/state/useRepoSummary';
import { oid, ref, stash } from '@/test/graphData';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { GraphPanel } from './GraphPanel';
import { REFS_SHOWN, RefsPanel } from './RefsPanel';

const TAB = { project: 'app', worktree: null };

function world() {
  const w = linearWorld(800);
  w.refs.refs.push(
    ref('refs/heads/feat', oid(790)), ref('refs/heads/old', oid(100)),
    ref('refs/remotes/origin/main', oid(800)), ref('refs/remotes/origin/feat', oid(790)), ref('refs/remotes/up/x', oid(780), { remote: 'up' }),
    ref('refs/tags/v1', oid(795)),
  );
  w.refs.stashes = [stash('e'.repeat(40), oid(800), 0)];
  w.refs.worktrees = [
    { path: '/p/app', head: oid(800), branch: 'refs/heads/main', detached: false, bare: false, locked: false },
    { path: '/p/.wt/wt', head: oid(790), branch: 'refs/heads/feat', detached: false, bare: false, locked: true },
  ];
  return w;
}
async function show(w = world()) {
  stubGraph(w);
  await loadSummary(TAB);
  render(<><GraphPanel tab={TAB} /><RefsPanel tab={TAB} /></>);
  return screen.findByRole('navigation', { name: 'Refs' });
}
const names = (list: string) => within(screen.getByRole('list', { name: list })).getAllByRole('listitem').map((li) => li.getAttribute('data-ref') ?? li.getAttribute('data-worktree') ?? li.textContent);

test('sections: local, remotes grouped per remote, tags, stashes and worktrees with their cc name and badges', async () => {
  await show();
  expect(names('Local branches')).toEqual(['refs/heads/main', 'refs/heads/feat', 'refs/heads/old']);
  expect(names('Branches on origin')).toEqual(['refs/remotes/origin/main', 'refs/remotes/origin/feat']);
  expect(names('Branches on up')).toEqual(['refs/remotes/up/x']);
  expect(names('Tags')).toEqual(['refs/tags/v1']);
  expect(within(screen.getByRole('list', { name: 'Stashes' })).getByText('stash@{0}')).toBeTruthy();
  const wts = within(screen.getByRole('list', { name: 'Worktrees' }));
  expect(wts.getByText('wt')).toBeTruthy();
  expect(wts.getByText('locked')).toBeTruthy();
});

test('the filter keeps refs whose short name contains it, case-insensitively', async () => {
  await show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Filter refs' }), 'FEA');
  expect(names('Local branches')).toEqual(['refs/heads/feat']);
  expect(names('Branches on origin')).toEqual(['refs/remotes/origin/feat']);
  expect(screen.queryByRole('list', { name: 'Branches on up' })).toBeNull();
});

test('eye, solo and pin update the project prefs; the checked-out branch cannot be hidden', async () => {
  await show();
  expect((screen.getByRole('button', { name: 'Hide main' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide feat' }));
  expect(getPrefs('app').hidden).toEqual(['refs/heads/feat']);
  expect(screen.getByRole('button', { name: 'Show feat' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Solo old' }));
  expect(getPrefs('app').soloed).toEqual(['refs/heads/old']);
  fireEvent.click(screen.getByRole('button', { name: 'Pin feat to left' }));
  expect(getPrefs('app').pinned).toEqual(['refs/heads/feat']);
  expect(names('Local branches')[0]).toBe('refs/heads/feat');
  fireEvent.click(screen.getByRole('button', { name: 'Hide remote up' }));
  expect(getPrefs('app').hiddenRemotes).toEqual(['up']);
  fireEvent.click(screen.getByRole('button', { name: 'Solo Tags' }));
  expect(getPrefs('app').soloedSections).toEqual(['tags']);
});

test('"Show all" appears only while something in the section is hidden, and clears it', async () => {
  await show();
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hide v1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(getPrefs('app').hidden).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Hide Remotes' }));
  expect(getPrefs('app').hiddenSections).toEqual(['remote']);
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(getPrefs('app').hiddenSections).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
});

test('clicking a ref whose commit is not loaded pages until it is and selects it', async () => {
  await show();
  fireEvent.click(within(screen.getByRole('list', { name: 'Local branches' })).getByRole('button', { name: 'old' }));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(100)]));
});

test('a worktrees failure (old git) shows a notice in the Worktrees section', async () => {
  const w = world();
  w.refs.worktrees = null;
  w.refs.worktreesError = "error: unknown switch `z'";
  await show(w);
  expect(screen.getByRole('note').textContent).toContain("unknown switch `z'");
});

test('a graph that never opened (not a repo) leaves the refs panel empty', () => {
  stubGraph(world());
  const { container } = render(<RefsPanel tab={TAB} />);
  expect(container.textContent).toBe('');
});

test('clicking a ref while the scroll prefetch is loading still jumps to it', async () => {
  const w = world();
  const held: (() => void)[] = [];
  const answer = (p: { skip: number; limit: number }) => ({ ok: true, result: { items: w.commits.slice(p.skip, p.skip + p.limit), nextCursor: p.skip + p.limit < w.commits.length ? p.skip + p.limit : null } });
  w.page = (p) => (p.skip === 0 ? answer(p) : new Promise((r) => held.push(() => r(answer(p)))));
  await show(w);
  await act(async () => { void loadNextPage(TAB); });
  await waitFor(() => expect(held).toHaveLength(1));
  fireEvent.click(within(screen.getByRole('list', { name: 'Local branches' })).getByRole('button', { name: 'old' }));
  await act(async () => { held.shift()!(); });
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(100)]));
  expect(screen.queryByText('Not in the visible graph.')).toBeNull();
});

test('a stash whose base is not loaded: Show details pages to the base and selects the stash row', async () => {
  const w = world();
  const far = stash('f'.repeat(40), oid(100), 1);
  w.refs.stashes = [...w.refs.stashes, far];
  await show(w);
  fireEvent.contextMenu(within(screen.getByRole('list', { name: 'Stashes' })).getByText('stash@{1}'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Show details' }));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([`stash:${far.oid}`]));
});

test('a pinned remote branch floats to the top of its remote and is marked like a local pin', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Pin origin/feat to left' }));
  expect(getPrefs('app').pinned).toEqual(['refs/remotes/origin/feat']);
  expect(names('Branches on origin')).toEqual(['refs/remotes/origin/feat', 'refs/remotes/origin/main']);
  expect(screen.getByRole('button', { name: 'Jump to pinned origin/feat' })).toBeTruthy();
});

test('hiding a remote shows the Remotes "Show all", which shows it again', async () => {
  await show();
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hide remote up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(getPrefs('app').hiddenRemotes).toEqual([]);
});

test('a long list shows REFS_SHOWN rows and a Show more button for the rest', async () => {
  const w = world();
  w.refs.refs.push(...Array.from({ length: REFS_SHOWN + 30 }, (_, i) => ref(`refs/heads/many/${String(i).padStart(3, '0')}`, oid(800))));
  await show(w);
  const local = () => within(screen.getByRole('list', { name: 'Local branches' }));
  expect(local().getAllByRole('listitem').filter((li) => li.hasAttribute('data-ref'))).toHaveLength(REFS_SHOWN);
  fireEvent.click(local().getByRole('button', { name: 'Show 33 more of 33' }));
  expect(local().getAllByRole('listitem')).toHaveLength(REFS_SHOWN + 33);
});

test('with the Stashes section hidden, clicking a stash pages to its base and selects that commit', async () => {
  const w = world();
  const far = stash('f'.repeat(40), oid(100), 1);
  w.refs.stashes = [...w.refs.stashes, far];
  await show(w);
  fireEvent.click(screen.getByRole('button', { name: 'Hide Stashes' }));
  fireEvent.click(within(screen.getByRole('list', { name: 'Stashes' })).getByText('stash@{1}'));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(100)]));
  // The jump is done: a later stash shown again does not take the selection.
  fireEvent.click(screen.getByRole('button', { name: 'Show Stashes' }));
  await waitFor(() => expect(document.querySelector(`[data-row-id="stash:${far.oid}"]`)).not.toBeNull());
  expect(getSelection(TAB).ids).toEqual([oid(100)]);
});
