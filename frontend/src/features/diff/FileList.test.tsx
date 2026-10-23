import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FILE_RENDER_CAP } from '@/lib/clip';
import { fileViewStore, setFileView } from '@/state/fileView';
import { FileList, FileViewToggle, type ListFile } from './FileList';

const TAB = { project: 'app', worktree: null };
const lf = (path: string, over: Partial<ListFile> = {}): ListFile => (
  { path, oldPath: null, status: 'M', added: 1, deleted: 2, binary: false, submodule: false, ...over }
);
const FILES = [lf('src/b.ts'), lf('README.md'), lf('src/a/x.ts'), lf('docs/z.md', { status: 'A', added: 4, deleted: 0 })];
const option = (path: string) => document.querySelector<HTMLElement>(`li[role="option"][data-path="${CSS.escape(path)}"]`)!;
const paths = () => [...document.querySelectorAll('li[role="option"]')].map((li) => li.getAttribute('data-path'));

test('Path lists every file label in input order; a rename reads old → new', () => {
  render(<FileList label="Changed files" files={[...FILES, lf('new.ts', { status: 'R', oldPath: 'old.ts' })]} onSelect={() => {}} />);
  const list = screen.getByRole('listbox', { name: 'Changed files' });
  expect(within(list).getAllByRole('option')).toHaveLength(5);
  expect(paths()).toEqual(['src/b.ts', 'README.md', 'src/a/x.ts', 'docs/z.md', 'new.ts']);
  expect(option('new.ts').textContent).toContain('old.ts → new.ts');
  expect(option('src/a/x.ts').textContent).toContain('src/a/x.ts');
});

test('Tree nests files under directory groups; the toggle switches every mounted list and persists the choice', () => {
  render(
    <>
      <FileViewToggle />
      <FileList label="One" files={FILES} onSelect={() => {}} />
      <FileList label="Two" files={FILES} onSelect={() => {}} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('code-git:graph:fileView')).toBe('tree');
  for (const name of ['One', 'Two']) {
    const list = screen.getByRole('listbox', { name });
    const src = within(list).getByRole('group', { name: 'src' });
    expect(within(src).getByRole('group', { name: 'src/a' })).toBeTruthy();
    expect(within(src).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['src/a/x.ts', 'src/b.ts']);
  }
  // In Tree a file row shows its own name, not its directories.
  expect(within(option('src/a/x.ts')).queryByText('src/a/x.ts')).toBeNull();
  expect(within(option('src/a/x.ts')).getByText('x.ts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Path' }));
  expect(fileViewStore.get()).toBe('path');
  expect(screen.queryByRole('group', { name: 'src' })).toBeNull();
});

test('counts: +added −deleted for text; "binary" and "submodule" instead of numbers; none for untracked and conflicted', () => {
  render(
    <FileList
      label="Changed files"
      files={[
        lf('t.txt', { added: 12, deleted: 3 }),
        lf('b.bin', { binary: true, added: null, deleted: null }),
        lf('vendor/lib', { submodule: true, added: 1, deleted: 1 }),
        lf('new.txt', { status: '?', added: null, deleted: null }),
        lf('c.txt', { status: 'U', added: 5, deleted: 5 }),
        lf('mv.txt', { status: 'R', oldPath: 'was.txt', added: 0, deleted: 0 }),
      ]}
      onSelect={() => {}}
    />,
  );
  expect(within(option('t.txt')).getByText('+12')).toBeTruthy();
  expect(within(option('t.txt')).getByText('−3')).toBeTruthy();
  expect(within(option('t.txt')).getByLabelText('12 added, 3 deleted')).toBeTruthy();
  expect(within(option('b.bin')).getByText('binary')).toBeTruthy();
  expect(option('b.bin').textContent).not.toMatch(/[+−]\d/);
  expect(within(option('vendor/lib')).getByText('submodule')).toBeTruthy();
  expect(option('vendor/lib').textContent).not.toMatch(/[+−]\d/);
  expect(option('new.txt').textContent).not.toMatch(/[+−]\d|binary/);
  expect(option('c.txt').textContent).not.toMatch(/[+−]\d|binary/);
  expect(within(option('mv.txt')).getByLabelText('0 added, 0 deleted')).toBeTruthy();
});

test('multi: a click selects one (plain), Ctrl/⌘-click toggles, Shift-click extends over the displayed (Tree) order (not plain)', () => {
  setFileView('tree');
  const onSelect = vi.fn();
  const { rerender } = render(<FileList label="L" files={FILES} multi selected={[]} onSelect={onSelect} />);
  // Tree order: docs/z.md, src/a/x.ts, src/b.ts, README.md.
  fireEvent.click(option('docs/z.md'));
  expect(onSelect).toHaveBeenLastCalledWith(['docs/z.md'], FILES[3], true);
  rerender(<FileList label="L" files={FILES} multi selected={['docs/z.md']} viewed="docs/z.md" onSelect={onSelect} />);
  fireEvent.click(option('src/b.ts'), { ctrlKey: true });
  expect(onSelect).toHaveBeenLastCalledWith(['docs/z.md', 'src/b.ts'], FILES[0], false);
  rerender(<FileList label="L" files={FILES} multi selected={['docs/z.md', 'src/b.ts']} viewed="src/b.ts" onSelect={onSelect} />);
  fireEvent.click(option('docs/z.md'), { metaKey: true });
  expect(onSelect).toHaveBeenLastCalledWith(['src/b.ts'], FILES[3], false);
  // The anchor is the last plain or toggled row (docs/z.md); Shift extends to README.md over the tree order.
  fireEvent.click(option('README.md'), { shiftKey: true });
  expect(onSelect).toHaveBeenLastCalledWith(['docs/z.md', 'src/a/x.ts', 'src/b.ts', 'README.md'], FILES[1], false);
});

test('without multi, modified clicks are plain clicks', () => {
  const onSelect = vi.fn();
  render(<FileList label="L" files={FILES} selected={['src/b.ts']} viewed="src/b.ts" onSelect={onSelect} />);
  fireEvent.click(option('README.md'), { ctrlKey: true });
  expect(onSelect).toHaveBeenLastCalledWith(['README.md'], FILES[1], true);
  fireEvent.click(option('docs/z.md'), { shiftKey: true });
  expect(onSelect).toHaveBeenLastCalledWith(['docs/z.md'], FILES[3], true);
  expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBeNull();
});

test('↑/↓ move the focus over file rows in displayed order, skipping directories; followFocus also selects (not plain); Enter selects the focused row (plain)', () => {
  setFileView('tree');
  const onSelect = vi.fn();
  const { rerender } = render(<FileList label="L" files={FILES} onSelect={onSelect} />);
  option('docs/z.md').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(option('src/a/x.ts'));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(option('src/b.ts'));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(option('src/a/x.ts'));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  expect(onSelect).toHaveBeenLastCalledWith(['src/a/x.ts'], FILES[2], true);
  rerender(<FileList label="L" files={FILES} followFocus onSelect={onSelect} />);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(option('src/b.ts'));
  expect(onSelect).toHaveBeenLastCalledWith(['src/b.ts'], FILES[0], false);
  // Clamped at the ends.
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(option('README.md'));
});

test('extra row keys reach onRowKeyDown with the focused file; the viewed row is aria-current and the selection aria-selected', () => {
  const onRowKeyDown = vi.fn();
  render(<FileList label="L" files={FILES} viewed="README.md" selected={['README.md', 'docs/z.md']} onSelect={() => {}} onRowKeyDown={onRowKeyDown} />);
  option('src/b.ts').focus();
  fireEvent.keyDown(option('src/b.ts'), { key: 's' });
  expect(onRowKeyDown).toHaveBeenCalledTimes(1);
  expect(onRowKeyDown.mock.calls[0][1]).toBe(FILES[0]);
  expect(option('README.md').getAttribute('aria-current')).toBe('true');
  expect(option('src/b.ts').getAttribute('aria-current')).toBeNull();
  expect(FILES.map((f) => option(f.path).getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'true']);
});

test('row actions render per file, directory actions per directory with the files beneath it', () => {
  setFileView('tree');
  const dirActions = vi.fn((files: ListFile[], dir: string) => <button type="button">Dir {dir} ({files.length})</button>);
  render(<FileList label="L" files={FILES} onSelect={() => {}} actions={(f) => <button type="button">Do {f.path}</button>} dirActions={dirActions} />);
  expect(within(option('src/b.ts')).getByRole('button', { name: 'Do src/b.ts' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dir src (2)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dir src/a (1)' })).toBeTruthy();
  expect(dirActions.mock.calls.find(([, d]) => d === 'src')![0].map((f) => f.path).sort()).toEqual(['src/a/x.ts', 'src/b.ts']);
});

test('over FILE_RENDER_CAP: the first rows and "Show all N"; a viewed file past the cap expands the list', () => {
  const many = Array.from({ length: FILE_RENDER_CAP + 3 }, (_, i) => lf(`f${i}.txt`));
  const { rerender } = render(<FileList label="L" files={many} onSelect={() => {}} />);
  expect(document.querySelectorAll('li[role="option"]')).toHaveLength(FILE_RENDER_CAP);
  fireEvent.click(screen.getByRole('button', { name: `Show all ${many.length}` }));
  expect(document.querySelectorAll('li[role="option"]')).toHaveLength(many.length);
  rerender(<FileList key="fresh" label="L" files={many} viewed={`f${FILE_RENDER_CAP + 1}.txt`} onSelect={() => {}} />);
  expect(document.querySelectorAll('li[role="option"]')).toHaveLength(many.length);
  expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
});

test('⋮ and right-click open the row menu: it acts on the selection when the row is in it, else on the row alone', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const source = { kind: 'unstaged' } as const;
  const menu = (_f: ListFile, targets: ListFile[]) => ({ context: 'diff-file', ctx: { tab: TAB, files: targets, source } });
  const onSelect = vi.fn();
  render(<FileList label="L" files={FILES} multi selected={['src/b.ts', 'docs/z.md']} onSelect={onSelect} menu={menu} />);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for docs/z.md' }));
  expect(await screen.findByRole('menuitem', { name: 'Copy patch of selection' })).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
  expect(writeText).toHaveBeenLastCalledWith('src/b.ts\ndocs/z.md');
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.contextMenu(option('README.md'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }));
  expect(writeText).toHaveBeenLastCalledWith('README.md');
  expect(onSelect).not.toHaveBeenCalled();
});

test('a hostile path renders as text', () => {
  render(<FileList label="L" files={[lf('<img src=x onerror=alert(1)>')]} onSelect={() => {}} />);
  act(() => setFileView('tree'));
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByRole('option').textContent).toContain('<img src=x onerror=alert(1)>');
});
