import { render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Toasts } from '@/shell/Toasts';
import { diffStore } from '@/state/diff';
import { json } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { DIFF_COMMANDS } from './commands';

const TAB = { project: 'app', worktree: null };
const pick = DIFF_COMMANDS.find((c) => c.id === 'diff.showCommit')!.pick!;
const params = (f: ReturnType<typeof stubFetch>) => f.calls.map((c) => (c.body as { params: unknown }).params);
const files = { files: [], pair: null, commit: null, mergeBase: null, series: null };

// Invariant: a typed revision is turned into a row as typed, listed as a commit diff first, and the diff opens on that list.
test('Show commit… lists the typed revision as a commit diff, then opens it preloaded', async () => {
  const f = stubFetch({ 'POST api/ops/diff.files': { ok: true, result: files } });
  const item = pick.typed!('HEAD~3')!;
  expect(item.id).toBe('HEAD~3');
  await pick.run(TAB, item);
  expect(params(f)).toEqual([expect.objectContaining({ source: { kind: 'commit', rev: 'HEAD~3' } })]);
  expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'commit', rev: 'HEAD~3' });
});

// Invariant: a refused revision opens no diff and surfaces the refusal as an error toast naming it.
test('Show commit… opens nothing when the revision is refused', async () => {
  render(<Toasts />);
  stubFetch({ 'POST api/ops/diff.files': json({ error: 'No such revision: nope', code: 'REV_UNKNOWN' }, 404) });
  await pick.run(TAB, pick.typed!('nope')!);
  await waitFor(() => expect(screen.getByRole('region', { name: /Notifications/ }).textContent).toContain('No such revision: nope'));
  expect(diffStore.get().get('app\0')).toBeUndefined();
});
