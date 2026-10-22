import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { PanelDef, PanelSlot } from './panels';
import { hidePanel, showPanel } from '@/state/shownPanel';
import { dispatchTabs } from '@/state/tabs';
import { summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { Shell } from './Shell';

vi.mock('./panels', () => {
  const p = (id: string, slot: PanelSlot, over: Partial<PanelDef> = {}): PanelDef => ({
    id, slot, title: id, order: 0, component: () => <p>{`panel ${id}`}</p>, ...over,
  });
  const panels: PanelDef[] = [
    p('graph', 'center', { order: 100 }), p('extra', 'center', { order: 200 }), p('od', 'center', { onDemand: true }), p('side', 'left'),
  ];
  return { panelsFor: (slot: PanelSlot) => panels.filter((x) => x.slot === slot).sort((a, b) => a.order - b.order) };
});

const TAB = { project: 'app', worktree: null };

test('an on-demand panel is hidden by default, replaces its slot default panels while shown, and leaves other slots alone', () => {
  stubFetch({ 'POST api/ops/repo.summary': { ok: true, result: summary() } });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  const texts = () => ['graph', 'extra', 'od', 'side'].filter((id) => screen.queryByText(`panel ${id}`));
  expect(texts()).toEqual(['graph', 'extra', 'side']);
  act(() => showPanel(TAB, 'od'));
  expect(texts()).toEqual(['od', 'side']);
  act(() => showPanel(TAB, 'nope'));
  expect(texts()).toEqual(['graph', 'extra', 'side']);
  act(() => showPanel(TAB, 'od'));
  act(() => hidePanel(TAB));
  expect(texts()).toEqual(['graph', 'extra', 'side']);
});
