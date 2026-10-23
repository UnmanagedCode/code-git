import { expect, test } from 'vitest';
import { oid, ref } from '@/test/graphData';
import type { Operation } from './api';
import { commitLabel, operationTitle, sideLabels } from './labels';

const A = oid('a1');
const B = oid('b2');
const C = oid('c3');
const refs = [ref('refs/remotes/origin/main', A), ref('refs/heads/main', A), ref('refs/remotes/origin/topic', B), ref('refs/tags/v1', C)];
const op = (kind: Operation['kind'], over: Partial<Operation> = {}): Operation => ({ kind, incoming: { oid: B, subject: 'Fix it' }, rebase: null, ...over });

test('a commit is named by its first local branch, else a remote branch, else its short oid (a tag does not count)', () => {
  expect(commitLabel(A, refs)).toBe('main');
  expect(commitLabel(B, refs)).toBe('origin/topic');
  expect(commitLabel(C, refs)).toBe(C.slice(0, 7));
});

test('Current / Incoming per kind: merge names both branches; rebase the onto side (rebased so far) and the replayed commit; cherry-pick and revert the commit', () => {
  expect(sideLabels(op('merge'), 'refs/heads/feature', refs)).toEqual({ current: 'feature', incoming: 'origin/topic' });
  expect(sideLabels(op('rebase', { rebase: { branch: 'refs/heads/feature', onto: A, step: 1, total: 2 } }), null, refs))
    .toEqual({ current: 'main (rebased so far)', incoming: `${B.slice(0, 7)} Fix it` });
  expect(sideLabels(op('cherry-pick'), 'refs/heads/feature', refs)).toEqual({ current: 'feature', incoming: `${B.slice(0, 7)} Fix it` });
  expect(sideLabels(op('revert'), 'refs/heads/feature', refs)).toEqual({ current: 'feature', incoming: `revert of ${B.slice(0, 7)}` });
  expect(sideLabels(null, 'refs/heads/feature', refs)).toEqual({ current: 'Current', incoming: 'Incoming' });
  expect(sideLabels(op('merge'), null, refs).current).toBe('HEAD');
});

test('titles: a rebase names its branch, onto and step; unknown parts are left out', () => {
  expect(operationTitle(op('rebase', { rebase: { branch: 'refs/heads/feature', onto: A, step: 2, total: 5 } }), null, refs)).toBe('Rebasing feature onto main (step 2 of 5)');
  expect(operationTitle(op('rebase', { rebase: { branch: null, onto: null, step: null, total: 5 } }), null, refs)).toBe('Rebasing HEAD');
  expect(operationTitle(op('merge'), 'refs/heads/main', refs)).toBe('Merging origin/topic into main');
  expect(operationTitle(op('cherry-pick', { incoming: null }), 'refs/heads/main', refs)).toBe('Cherry-picking the commit being applied');
});
