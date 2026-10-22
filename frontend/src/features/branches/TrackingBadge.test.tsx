import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { trackingStore } from '@/state/branchTracking';
import { TrackingBadge } from './TrackingBadge';

const T = { project: 'app', worktree: null };
const seed = (branches: Record<string, object>) => trackingStore.set(new Map([['app', { loading: false, data: { remotes: ['origin'], branches: branches as never } }]]));
const t = (over: object) => ({ upstream: 'refs/remotes/origin/x', ahead: 0, behind: 0, gone: false, ...over });

test('the badge shows ↑ahead and ↓behind, "gone" for a missing upstream, and nothing in sync or without upstream', () => {
  seed({ 'refs/heads/both': t({ ahead: 3, behind: 2 }), 'refs/heads/ahead': t({ ahead: 1 }), 'refs/heads/gone': t({ gone: true }), 'refs/heads/sync': t({}), 'refs/heads/none': t({ upstream: null }) });
  const { container, rerender } = render(<TrackingBadge tab={T} ref="refs/heads/both" />);
  expect(screen.getByLabelText('3 ahead, 2 behind').textContent).toBe('↑3 ↓2');
  rerender(<TrackingBadge tab={T} ref="refs/heads/ahead" />);
  expect(screen.getByLabelText('1 ahead').textContent).toBe('↑1');
  rerender(<TrackingBadge tab={T} ref="refs/heads/gone" />);
  expect(container.textContent).toBe('gone');
  for (const r of ['refs/heads/sync', 'refs/heads/none', 'refs/heads/unknown']) {
    rerender(<TrackingBadge tab={T} ref={r} />);
    expect(container.textContent, r).toBe('');
  }
});
