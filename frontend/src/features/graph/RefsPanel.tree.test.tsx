import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { getPrefs, resetGraphPrefs, updatePrefs } from '@/state/graphPrefs';
import { loadSummary } from '@/state/useRepoSummary';
import { oid, ref } from '@/test/graphData';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { GraphPanel } from './GraphPanel';
import { RefsPanel } from './RefsPanel';

const TAB = { project: 'app', worktree: null };
const CC = 'refs/heads/code-conductor/';
const FEATURE = 'refs/remotes/origin/feature/';

function world() {
  const w = linearWorld(20);
  w.refs.refs.push(
    ref('refs/heads/code-conductor/a', oid(18)), ref('refs/heads/code-conductor/b', oid(17)), ref('refs/heads/backup/pre-rebase', oid(10)),
    ref('refs/heads/feature/ui/x', oid(15)), ref('refs/remotes/origin/feature/b', oid(16), { remote: 'origin' }), ref('refs/tags/release/1.0', oid(12)),
  );
  return w;
}
async function show() {
  stubGraph(world(), {
    'POST api/ops/branch.tracking': { ok: true, result: { remotes: ['origin'], branches: { [`${CC}a`]: { upstream: 'refs/remotes/origin/a', ahead: 2, behind: 0, gone: false } } } },
  });
  await loadSummary(TAB);
  const view = render(<><GraphPanel tab={TAB} /><RefsPanel tab={TAB} /></>);
  await screen.findByRole('navigation', { name: 'Refs' });
  return view;
}
const folder = (prefix: string) => document.querySelector(`[data-folder="${prefix}"]`) as HTMLElement;
const row = (name: string) => document.querySelector(`[data-ref="${name}"]`) as HTMLElement;
const list = (name: string) => within(screen.getByRole('list', { name }));
const keys = (name: string) => list(name).getAllByRole('listitem').map((li) => li.getAttribute('data-folder') ?? li.getAttribute('data-ref'));
const filter = () => screen.getByRole('textbox', { name: 'Filter refs' });
const folderButton = (prefix: string) => folder(prefix).querySelector('button[aria-expanded]') as HTMLButtonElement;
const collapse = (prefix: string) => fireEvent.click(folderButton(prefix));

// Invariant: each list is one flat <ul> of folder rows then refs, folders before refs, and the remote's folders live under the remote.
test('folders nest in Local, under a remote, and in Tags', async () => {
  await show();
  expect(keys('Local branches')).toEqual(['refs/heads/backup/', 'refs/heads/backup/pre-rebase', 'refs/heads/code-conductor/', `${CC}a`, `${CC}b`, 'refs/heads/feature/', 'refs/heads/feature/ui/', 'refs/heads/feature/ui/x', 'refs/heads/main']);
  expect(keys('Branches on origin')).toEqual([FEATURE, 'refs/remotes/origin/feature/b']);
  expect(keys('Tags')).toEqual(['refs/tags/release/', 'refs/tags/release/1.0']);
});

// Invariant: collapse is stored per repo in prefs and restored from storage; default is expanded.
test('collapsing a folder writes collapsedFolders, hides its rows, and survives a remount from storage', async () => {
  expect(getPrefs('app').collapsedFolders).toEqual([]);
  const first = await show();
  collapse(CC);
  expect(getPrefs('app').collapsedFolders).toEqual([CC]);
  expect(row(`${CC}a`)).toBeNull();
  expect(folderButton(CC).getAttribute('aria-expanded')).toBe('false');
  first.unmount();
  resetGraphPrefs();
  await show();
  expect(folder(CC)).not.toBeNull();
  expect(row(`${CC}a`)).toBeNull();
  expect(row('refs/heads/feature/ui/x')).not.toBeNull();
  fireEvent.click(folderButton(CC));
  expect(getPrefs('app').collapsedFolders).toEqual([]);
  expect(row(`${CC}a`)).not.toBeNull();
});

// Invariant: a filter shows every surviving folder expanded and unclickable; clearing it restores the stored collapse.
test('the filter expands a collapsed folder, drops folders without a match and disables the folder button; clearing restores collapse', async () => {
  await show();
  collapse(CC);
  await userEvent.type(filter(), 'pre-rebase');
  expect(keys('Local branches')).toEqual(['refs/heads/backup/', 'refs/heads/backup/pre-rebase']);
  await userEvent.clear(filter());
  await userEvent.type(filter(), '/b');
  const cc = folderButton(CC);
  expect(cc.getAttribute('aria-expanded')).toBe('true');
  expect(cc.disabled).toBe(true);
  expect(row(`${CC}b`)).not.toBeNull();
  expect(folder('refs/heads/feature/')).toBeNull();
  await userEvent.clear(filter());
  expect(row(`${CC}a`)).toBeNull();
  expect(folderButton(CC).disabled).toBe(false);
  expect(getPrefs('app').collapsedFolders).toEqual([CC]);
});

// Invariant: a folder's hide / solo store its prefix and flip to the active labels with aria-pressed.
test('folder Hide and Solo write the prefix and flip to Show / Unsolo', async () => {
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Hide folder code-conductor' }));
  expect(getPrefs('app').hiddenFolders).toEqual([CC]);
  expect(screen.getByRole('button', { name: 'Show folder code-conductor' }).getAttribute('aria-pressed')).toBe('true');
  expect(folder(CC).className).toContain('opacity-50');
  fireEvent.click(screen.getByRole('button', { name: 'Solo folder code-conductor' }));
  expect(getPrefs('app').soloedFolders).toEqual([CC]);
  expect(screen.getByRole('button', { name: 'Unsolo folder code-conductor' }).getAttribute('aria-pressed')).toBe('true');
  expect(folder(CC).className).not.toContain('opacity-50');
  fireEvent.click(screen.getByRole('button', { name: 'Hide folder origin/feature' }));
  expect(getPrefs('app').hiddenFolders).toEqual([CC, FEATURE]);
  fireEvent.click(screen.getByRole('button', { name: 'Unsolo folder code-conductor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show folder code-conductor' }));
  expect(getPrefs('app').hiddenFolders).toEqual([FEATURE]);
  expect(getPrefs('app').soloedFolders).toEqual([]);
});

// Invariant: a folder hide is undone by the section's Show all, which appears for it.
test('Show all appears while a folder under the section is hidden and clears only that section\'s folders', async () => {
  await show();
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hide folder code-conductor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide folder origin/feature' }));
  const showAll = screen.getAllByRole('button', { name: 'Show all' });
  expect(showAll).toHaveLength(2);
  fireEvent.click(showAll[0]);
  expect(getPrefs('app').hiddenFolders).toEqual([FEATURE]);
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(getPrefs('app').hiddenFolders).toEqual([]);
});

// Invariant: a pin keeps the ref in reach: flat at the top of its list with its full path, even under a collapsed folder, once.
test('a pinned ref under a collapsed folder still renders at the top with its full path, once', async () => {
  updatePrefs('app', (p) => ({ ...p, pinned: [`${CC}b`], collapsedFolders: [CC] }));
  await show();
  expect(keys('Local branches')[0]).toBe(`${CC}b`);
  expect(document.querySelectorAll(`[data-ref="${CC}b"]`)).toHaveLength(1);
  expect(within(row(`${CC}b`)).getByRole('button', { name: 'code-conductor/b' })).toBeTruthy();
  expect(row(`${CC}a`)).toBeNull();
  await userEvent.type(filter(), 'cond');
  expect(keys('Local branches')[0]).toBe(`${CC}b`);
});

// Invariant: leaf rows are drag/drop targets, folder rows are not.
test('leaf rows carry data-drop-ref; folder rows do not', async () => {
  await show();
  expect(row(`${CC}a`).getAttribute('data-drop-ref')).toBe(`${CC}a`);
  expect(row('refs/remotes/origin/feature/b').getAttribute('data-drop-ref')).toBe('refs/remotes/origin/feature/b');
  expect(folder(CC).hasAttribute('data-drop-ref')).toBe(false);
  expect(folder(CC).hasAttribute('data-ref')).toBe(false);
});

const overlay = (el: Element) => el.querySelector('[data-row-overlay]');
const labelsIn = (el: Element | null) => [...(el?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'));

// Invariant: an inactive toggle lives in the row's hover overlay; an active one and the tracking badge sit in flow, outside it.
test('controls: inactive toggles are in the overlay, active ones and the tracking badge outside it, on ref, folder, remote and section rows', async () => {
  await show();
  const a = row(`${CC}a`);
  expect(labelsIn(overlay(a))).toEqual(['Pin code-conductor/a to left', 'Hide code-conductor/a', 'Solo code-conductor/a']);
  expect(await within(a).findByLabelText('2 ahead')).toBeTruthy();
  expect(overlay(a)!.contains(within(a).getByLabelText('2 ahead'))).toBe(false);
  fireEvent.click(within(a).getByRole('button', { name: 'Hide code-conductor/a' }));
  expect(labelsIn(overlay(a))).toEqual(['Pin code-conductor/a to left', 'Solo code-conductor/a']);
  const active = within(a).getByRole('button', { name: 'Show code-conductor/a' });
  expect(overlay(a)!.contains(active)).toBe(false);
  expect(a.contains(active)).toBe(true);
  fireEvent.click(active);
  expect(getPrefs('app').hidden).toEqual([]);

  const cc = folder(CC);
  fireEvent.click(within(cc).getByRole('button', { name: 'Solo folder code-conductor' }));
  expect(labelsIn(overlay(cc))).toEqual(['Hide folder code-conductor']);
  expect(overlay(cc)!.contains(within(cc).getByRole('button', { name: 'Unsolo folder code-conductor' }))).toBe(false);

  const remote = screen.getByRole('button', { name: 'origin', expanded: true }).parentElement!.parentElement!;
  expect(labelsIn(overlay(remote))).toEqual(['Hide remote origin', 'Solo remote origin']);
  fireEvent.click(within(remote).getByRole('button', { name: 'Hide remote origin' }));
  expect(overlay(remote)!.contains(within(remote).getByRole('button', { name: 'Show remote origin' }))).toBe(false);

  const tags = screen.getByRole('button', { name: /^Tags/ }).parentElement!.parentElement!;
  expect(labelsIn(overlay(tags))).toEqual(['Hide Tags', 'Solo Tags']);
  fireEvent.click(within(tags).getByRole('button', { name: 'Hide Tags' }));
  expect(within(tags).getByRole('button', { name: 'Show Tags' }).getAttribute('aria-pressed')).toBe('true');
  expect(overlay(tags)!.contains(within(tags).getByRole('button', { name: 'Show Tags' }))).toBe(false);
});

// Invariant: every toggle of a row stays reachable by Tab, after its name.
test('Tab from the filter reaches the row\'s name, then each of its toggles', async () => {
  await show();
  await userEvent.click(filter());
  let n = 0;
  while (document.activeElement?.getAttribute('title') !== `${CC}b` && n++ < 60) await userEvent.tab();
  expect(document.activeElement?.getAttribute('title')).toBe(`${CC}b`);
  const reached: (string | null)[] = [];
  for (let i = 0; i < 3; i++) { await userEvent.tab(); reached.push(document.activeElement!.getAttribute('aria-label')); }
  expect(reached).toEqual(['Pin code-conductor/b to left', 'Hide code-conductor/b', 'Solo code-conductor/b']);
});

// Invariant: a branch hidden before it was checked out can be shown again; an unhidden checked-out branch cannot be hidden.
test('the checked-out branch: Hide is disabled, but Show is enabled when it was hidden earlier', async () => {
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/main'] }));
  await show();
  expect((screen.getByRole('button', { name: 'Show main' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Show main' }));
  expect(getPrefs('app').hidden).toEqual([]);
  expect((screen.getByRole('button', { name: 'Hide main' }) as HTMLButtonElement).disabled).toBe(true);
});

// Invariant: a collapsed folder holding the checked-out branch keeps the HEAD emphasis on its name.
test('a collapsed folder that holds the checked-out branch renders its name semibold', async () => {
  const w = world();
  w.refs.head.branch = 'refs/heads/feature/ui/x';
  w.refs.refs = w.refs.refs.map((r) => ({ ...r, isHead: r.name === 'refs/heads/feature/ui/x' }));
  stubGraph(w);
  await loadSummary(TAB);
  updatePrefs('app', (p) => ({ ...p, collapsedFolders: ['refs/heads/feature/'] }));
  render(<><GraphPanel tab={TAB} /><RefsPanel tab={TAB} /></>);
  await screen.findByRole('navigation', { name: 'Refs' });
  expect(within(folder('refs/heads/feature/')).getByText('feature').className).toContain('font-semibold');
  expect(within(folder(CC)).getByText('code-conductor').className).not.toContain('font-semibold');
});
