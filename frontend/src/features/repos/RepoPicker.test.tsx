import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { repo } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { RepoPicker } from './RepoPicker';

const REPOS = [
  repo({ project: 'app', workspace: 'Dev' }),
  repo({ project: 'box', workspace: null, system: 'docker', remoteId: 'cc-box' }),
  repo({ project: 'plain', workspace: 'Dev', isGitRepo: false }),
  repo({ project: 'gone', workspace: 'Dev', isGitRepo: undefined, systemUnreachable: 'system docker/x is unreachable' }),
  repo({ project: 'owned', workspace: 'Ops', isGitRepo: undefined, gitRefusal: 'detected dubious ownership <b>x</b>' }),
  repo({ project: 'broken', workspace: 'Ops', isGitRepo: undefined, degraded: 'unreadable project record' }),
  repo({ project: 'fresh', workspace: 'Ops', unbornHead: true }),
];

function setup() {
  const fetch = stubFetch({
    'GET api/repos': { repos: REPOS },
    'GET api/repos/app/worktrees': { worktrees: [{ worktreeName: 'feat', branch: 'code-conductor/feat', baseBranch: 'main' }] },
  });
  const onOpen = vi.fn();
  const onOpenChange = vi.fn();
  render(<RepoPicker open onOpenChange={onOpenChange} onOpen={onOpen} />);
  return { fetch, onOpen, onOpenChange };
}
const projectButton = (name: string) => screen.getByRole('button', { name });

test('every project is listed, grouped by workspace, with no filtering of unopenable ones', async () => {
  setup();
  await screen.findByRole('button', { name: 'app' });
  for (const r of REPOS) expect(projectButton(r.project)).toBeTruthy();
  const dev = screen.getByRole('region', { name: 'Dev' });
  expect(within(dev).getByRole('button', { name: 'plain' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'No workspace' })).getByRole('button', { name: 'box' })).toBeTruthy();
});

test('a remote-System project shows its System badge', async () => {
  setup();
  await screen.findByRole('button', { name: 'box' });
  expect(screen.getByText('docker · cc-box')).toBeTruthy();
  expect(screen.getByText('no commits')).toBeTruthy();
});

test('non-git, unreachable, refused and degraded rows are disabled with their reason as text', async () => {
  setup();
  await screen.findByRole('button', { name: 'app' });
  for (const [name, reason] of [['plain', 'not a git repo'], ['gone', 'system docker/x is unreachable'],
    ['owned', 'detected dubious ownership <b>x</b>'], ['broken', 'unreadable project record']]) {
    expect((projectButton(name) as HTMLButtonElement).disabled, name).toBe(true);
    expect((screen.getByRole('button', { name: `Show worktrees of ${name}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  }
  expect(document.querySelector('b')).toBeNull();
  for (const name of ['app', 'box', 'fresh']) expect((projectButton(name) as HTMLButtonElement).disabled, name).toBe(false);
});

test('picking a project opens its main checkout and closes the dialog', async () => {
  const { onOpen, onOpenChange } = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'app' }));
  expect(onOpen).toHaveBeenCalledWith({ project: 'app', worktree: null });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('expanding a project loads its worktrees; picking one opens that worktree', async () => {
  const { onOpen, fetch } = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Show worktrees of app' }));
  const list = await screen.findByRole('list', { name: 'Checkouts of app' });
  expect(fetch.count('GET api/repos/app/worktrees')).toBe(1);
  expect(within(list).getByRole('button', { name: '(main checkout)' })).toBeTruthy();
  await userEvent.click(within(list).getByRole('button', { name: /feat/ }));
  expect(onOpen).toHaveBeenCalledWith({ project: 'app', worktree: 'feat' });
});

test('the filter narrows by project name or workspace', async () => {
  setup();
  await screen.findByRole('button', { name: 'app' });
  await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'ops');
  expect(screen.queryByRole('button', { name: 'app' })).toBeNull();
  expect(projectButton('owned')).toBeTruthy();
  await userEvent.clear(screen.getByRole('textbox', { name: 'Filter projects' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'BO');
  expect(projectButton('box')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'fresh' })).toBeNull();
});

test('a failed listing shows the error with a retry', async () => {
  stubFetch({ 'GET api/repos': new Response(JSON.stringify({ error: 'CONDUCTOR_URL is not set', code: 'CONDUCTOR_UNAVAILABLE' }), { status: 503 }) });
  render(<RepoPicker open onOpenChange={() => {}} onOpen={() => {}} />);
  expect(await screen.findByText('CONDUCTOR_URL is not set')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});
