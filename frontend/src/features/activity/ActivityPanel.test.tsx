import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { FakeEventSource } from '@/test/fakeEventSource';
import { entry } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ActivityPanel } from './ActivityPanel';

const XSS = '<img src=x onerror=alert(1)>';

test('a running cancellable entry shows Cancel, which posts JSON to its cancel route', async () => {
  let entries = [entry({ id: 7, status: 'running', exitCode: null, durationMs: null, cancellable: true })];
  const fetch = stubFetch({
    'GET api/activity': () => ({ entries }),
    'POST api/activity/7/cancel': () => { entries = [{ ...entries[0], status: 'cancelled' }]; return { ok: true }; },
  });
  render(<ActivityPanel tab={null} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  const call = fetch.calls.find((c) => c.method === 'POST')!;
  expect(call.url.pathname).toBe('/api/activity/7/cancel');
  expect(call.headers['content-type']).toBe('application/json');
  await waitFor(() => expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull());
});

test('no Cancel on a running non-cancellable entry or on a finished one', async () => {
  stubFetch({
    'GET api/activity': {
      entries: [
        entry({ id: 1, status: 'running', cancellable: false, exitCode: null, durationMs: null }),
        entry({ id: 2, status: 'ok', cancellable: true }),
        entry({ id: 3, status: 'failed', cancellable: true, exitCode: 1, code: 'GIT_FAILED' }),
      ],
    },
  });
  render(<ActivityPanel tab={null} />);
  await screen.findByText('GIT_FAILED');
  expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
});

test('an SSE event triggers a refetch; the data comes from the refetch, not the event', async () => {
  let entries = [entry({ id: 1 })];
  const fetch = stubFetch({ 'GET api/activity': () => ({ entries }) });
  render(<ActivityPanel tab={null} />);
  await screen.findByText('exit 0');
  const before = fetch.count('GET api/activity');
  entries = [entry({ id: 1 }), entry({ id: 2, op: 'repo.fromRefetch' })];
  act(() => FakeEventSource.last!.emit({ id: 99, op: 'event.payload' }));
  await screen.findByText('repo.fromRefetch');
  expect(fetch.count('GET api/activity')).toBe(before + 1);
  expect(screen.queryByText('event.payload')).toBeNull();
});

test('entries show newest first with op, target, exit, duration and argv; stderr expands', async () => {
  stubFetch({
    'GET api/activity': {
      entries: [
        entry({ id: 1, op: 'repo.summary', durationMs: 1500 }),
        entry({ id: 2, op: 'repo.second', target: { project: 'app', worktree: 'feat' }, exitCode: 128, stderr: 'fatal: boom', status: 'failed', code: 'GIT_FAILED' }),
      ],
    },
  });
  render(<ActivityPanel tab={null} />);
  const items = await screen.findAllByRole('listitem');
  expect(items[0].textContent).toContain('repo.second');
  expect(within(items[0]).getByText('app/feat')).toBeTruthy();
  expect(within(items[0]).getByText('exit 128')).toBeTruthy();
  expect(within(items[1]).getByText('1.5 s')).toBeTruthy();
  expect(within(items[1]).getByText('git --no-pager status --porcelain=v2')).toBeTruthy();
  expect(screen.queryByText('fatal: boom')).toBeNull();
  await userEvent.click(within(items[0]).getByRole('button', { name: 'Show output' }));
  expect(screen.getByText('fatal: boom')).toBeTruthy();
});

test('the This tab filter shows only the active checkout', async () => {
  stubFetch({
    'GET api/activity': { entries: [entry({ id: 1, op: 'on.main' }), entry({ id: 2, op: 'on.feat', target: { project: 'app', worktree: 'feat' } })] },
  });
  render(<ActivityPanel tab={{ project: 'app', worktree: 'feat' }} />);
  await screen.findByText('on.main');
  await userEvent.click(screen.getByRole('button', { name: 'This tab' }));
  expect(screen.queryByText('on.main')).toBeNull();
  expect(screen.getByText('on.feat')).toBeTruthy();
});

test('XSS: argv, stderr and project names render as literal text, never markup', async () => {
  stubFetch({
    'GET api/activity': {
      entries: [entry({ id: 1, op: XSS, argv: ['git', XSS], stderr: XSS, status: 'failed', target: { project: XSS, worktree: XSS } })],
    },
  });
  const { container } = render(<ActivityPanel tab={null} />);
  const item = await screen.findByRole('listitem');
  await userEvent.click(within(item).getByRole('button', { name: 'Show output' }));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelectorAll('[onerror]').length).toBe(0);
  expect(item.textContent).toContain(`git ${XSS}`);
  expect(item.textContent).toContain(`${XSS}/${XSS}`);
  expect(within(item).getByText(XSS, { selector: 'pre' })).toBeTruthy();
});

test('the panel collapses', async () => {
  stubFetch({ 'GET api/activity': { entries: [entry({ id: 1, op: 'visible.op' })] } });
  render(<ActivityPanel tab={null} />);
  await screen.findByText('visible.op');
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(screen.queryByText('visible.op')).toBeNull();
});

test('a reconnect refetches (events may have been missed); unmounting closes the stream', async () => {
  const fetch = stubFetch({ 'GET api/activity': { entries: [entry({ id: 1 })] } });
  const { unmount } = render(<ActivityPanel tab={null} />);
  await screen.findByText('exit 0');
  const before = fetch.count('GET api/activity');
  const source = FakeEventSource.last!;
  act(() => source.reopen());
  await waitFor(() => expect(fetch.count('GET api/activity')).toBe(before + 1));
  unmount();
  expect(source.closed).toBe(true);
});

test('losing the cancel race (NOT_RUNNING) is silent; any other cancel failure is shown', async () => {
  let answer = { status: 409, code: 'NOT_RUNNING' };
  stubFetch({
    'GET api/activity': { entries: [entry({ id: 7, status: 'running', exitCode: null, durationMs: null })] },
    'POST api/activity/7/cancel': () => new Response(JSON.stringify({ error: `refused ${answer.code}`, code: answer.code }), { status: answer.status }),
  });
  render(<ActivityPanel tab={null} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
  expect(screen.queryByText(/Cancel failed/)).toBeNull();
  answer = { status: 503, code: 'CONDUCTOR_UNAVAILABLE' };
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText(/Cancel failed: refused CONDUCTOR_UNAVAILABLE/)).toBeTruthy();
});
