import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { getPrefs } from '@/state/graphPrefs';
import { getSelection } from '@/state/graphSelection';
import { loadSummary } from '@/state/useRepoSummary';
import { oid, ref, stash } from '@/test/graphData';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { GraphPanel } from './GraphPanel';
import { RefsPanel } from './RefsPanel';

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
