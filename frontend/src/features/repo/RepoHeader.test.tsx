import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { RepoSummary } from '@/lib/endpoints';
import { reposStore } from '@/state/useRepos';
import { repo, summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { RepoHeader } from './RepoHeader';

const TAB = { project: 'app', worktree: null };

function show(s: RepoSummary | Response) {
  const fetch = stubFetch({ 'POST api/ops/repo.summary': s instanceof Response ? s : { ok: true, result: s } });
  render(<RepoHeader tab={TAB} />);
  return fetch;
}

test('asks the backend for repo.summary on the tab target', async () => {
  const fetch = show(summary());
  await screen.findByText('main');
  expect(fetch.calls[0].body).toEqual({ target: { project: 'app' } });
});

test('a branch with its upstream, ahead/behind and the change counts', async () => {
  show(summary({ upstream: 'origin/main', ahead: 2, behind: 1, counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 4 } }));
  expect(await screen.findByText('main')).toBeTruthy();
  expect(screen.getByText('origin/main')).toBeTruthy();
  expect(screen.getByLabelText('2 ahead').textContent).toBe('2');
  expect(screen.getByLabelText('1 behind').textContent).toBe('1');
  for (const t of ['1 staged', '2 unstaged', '3 untracked', '4 conflicted']) expect(screen.getByText(t)).toBeTruthy();
});

test('no upstream says so', async () => {
  show(summary());
  expect(await screen.findByText('no upstream')).toBeTruthy();
});

test('detached HEAD shows a detached badge and the short oid', async () => {
  show(summary({ head: { oid: '0123456789abcdef', branch: null, unborn: false } }));
  expect(await screen.findByText('detached')).toBeTruthy();
  expect(screen.getByText('0123456789')).toBeTruthy();
});

test('an unborn HEAD shows its branch and a no-commits badge', async () => {
  show(summary({ head: { oid: null, branch: 'main', unborn: true } }));
  expect(await screen.findByText('no commits yet')).toBeTruthy();
  expect(screen.getByText('main')).toBeTruthy();
});

test('NOT_A_REPO shows git stderr as text', async () => {
  const detail = 'fatal: not a git repository <script>x</script>';
  show(new Response(JSON.stringify({ error: 'not a git repository', code: 'NOT_A_REPO', detail }), { status: 409 }));
  expect(await screen.findByText('Not a git repository')).toBeTruthy();
  expect(screen.getByText(detail, { selector: 'pre' })).toBeTruthy();
  expect(document.querySelector('pre script')).toBeNull();
});

test('a remote-System project shows its System badge; Refresh reloads the summary', async () => {
  reposStore.set({ repos: [repo({ project: 'app', system: 'docker', remoteId: 'cc-box' })], error: null, loading: false });
  const fetch = show(summary());
  expect(await screen.findByText('docker · cc-box')).toBeTruthy();
  await screen.findByText('main');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(fetch.count('POST api/ops/repo.summary')).toBe(2));
});

test('a cancelled refresh keeps the previous summary and shows no error', async () => {
  let n = 0;
  stubFetch({
    'POST api/ops/repo.summary': () => (n++ === 0 ? { ok: true, result: summary() }
      : new Response(JSON.stringify({ error: 'cancelled', code: 'CANCELLED' }), { status: 409 })),
  });
  render(<RepoHeader tab={TAB} />);
  await screen.findByText('main');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
  expect(n).toBe(2);
  expect(screen.getByText('main')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a failed refresh other than a cancel is shown as an error', async () => {
  stubFetch({ 'POST api/ops/repo.summary': new Response(JSON.stringify({ error: 'the System of app is unreachable', code: 'SYSTEM_UNREACHABLE' }), { status: 502 }) });
  render(<RepoHeader tab={TAB} />);
  expect((await screen.findByRole('alert')).textContent).toContain('the System of app is unreachable');
});
