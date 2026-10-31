import { expect, test } from 'vitest';
import type { Worktree } from '@/lib/endpoints';
import { repo } from '@/test/fixtures';
import { resolveMenuProject, resolveMenuWorktree } from './menu';

const wt = (worktreeName: string): Worktree => ({ worktreeName, branch: null, baseBranch: null, locked: false });

// Invariant: a listed, openable project resolves to the listing's own string, local or on a remote System.
test('resolveMenuProject accepts a listed project, local or remote', () => {
  const list = [repo({ project: 'app' }), repo({ project: 'box', system: 'docker', remoteId: 'cc-box' })];
  expect(resolveMenuProject(list, { project: 'app', worktree: null })).toEqual({ ok: true, project: 'app' });
  expect(resolveMenuProject(list, { project: 'box', worktree: 'w' })).toEqual({ ok: true, project: 'box' });
});

// Invariant: an unlisted or missing name is refused, quoting the name.
test.each([
  ['an unknown name', 'ghost', 'ghost'],
  ['no project', null, 'no project'],
])('resolveMenuProject refuses %s', (_n, project, needle) => {
  const r = resolveMenuProject([repo({ project: 'app' })], { project, worktree: null });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain(needle);
});

// Invariant: a project the picker disables (disabledReason) is refused with that reason and its name.
test.each([
  ['an unreachable System', { systemUnreachable: 'cc-box is offline' }, 'cc-box is offline'],
  ['not a git repo', { isGitRepo: false }, 'not a git repo'],
  ['a degraded record', { degraded: 'project record unreadable' }, 'project record unreadable'],
  ['a git refusal', { gitRefusal: 'dubious ownership' }, 'dubious ownership'],
])('resolveMenuProject refuses a project with %s, giving the reason', (_n, over, reason) => {
  const r = resolveMenuProject([repo({ project: 'app', ...over })], { project: 'app', worktree: null });
  expect(r.ok).toBe(false);
  if (!r.ok) { expect(r.message).toContain('app'); expect(r.message).toContain(reason); }
});

// Invariant: a listed worktree resolves to the listing's worktreeName; any other is refused, quoting both names.
test('resolveMenuWorktree accepts a listed worktree and refuses another, quoting both names', () => {
  const list = [wt('feat'), wt('other')];
  expect(resolveMenuWorktree('app', list, 'feat')).toEqual({ ok: true, worktree: 'feat' });
  const r = resolveMenuWorktree('app', list, 'ghost');
  expect(r.ok).toBe(false);
  if (!r.ok) { expect(r.message).toContain('app'); expect(r.message).toContain('ghost'); }
});
