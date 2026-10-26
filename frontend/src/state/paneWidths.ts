import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

export type PaneSide = 'left' | 'right';
export interface PaneWidths { left: number; right: number }

/**
 * The side panes (px): each one's default, floor and ceiling; the room the centre always keeps; the resize handle's own
 * width (its `w-2` class in `Splitter.tsx`) and the arrow-key step. The right floor is the Changes pane's design width
 * (its commit box and section-header floors assume it). At `lg`, where the panes show, `left.min + right.min + 2 × handle
 * + centerMin` and the defaults' sum both fit, so the centre never has to give way.
 */
export const PANE = {
  left: { default: 256, min: 192, max: 480 },
  right: { default: 320, min: 320, max: 640 },
  centerMin: 400,
  handle: 8,
  step: 16,
} as const;

const KEY = 'shell:paneWidths';

const side = (v: unknown, s: PaneSide): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(PANE[s].min, Math.min(PANE[s].max, v))) : PANE[s].default;

/** Stored widths: each side on its own, a missing or non-finite one is its default, a number is clamped to its bounds. */
export function parsePaneWidths(raw: string | null): PaneWidths {
  let o: Partial<Record<PaneSide, unknown>> = {};
  try {
    const j: unknown = raw === null ? null : JSON.parse(raw);
    if (j && typeof j === 'object') o = j;
  } catch { /* corrupt: the defaults */ }
  return { left: side(o.left, 'left'), right: side(o.right, 'right') };
}

/** What the two panes can share in a `<main>` `available` px wide, after the centre's minimum and both handles. */
const budgetOf = (available: number): number => available - PANE.centerMin - 2 * PANE.handle;

/**
 * The widths rendered for the chosen ones: when they overflow the room, the left pane gives way first (down to its
 * floor), then the right. Unmeasured (0), the choice as it is.
 */
export function fitPanes(choice: PaneWidths, available: number): PaneWidths {
  if (!(available > 0)) return choice;
  let over = choice.left + choice.right - budgetOf(available);
  const left = choice.left - Math.max(0, Math.min(over, choice.left - PANE.left.min));
  over -= choice.left - left;
  const right = choice.right - Math.max(0, Math.min(over, choice.right - PANE.right.min));
  return { left, right };
}

/** The widest a pane may be dragged or keyed to while the other one renders `otherRendered`; its own ceiling while unmeasured. */
export function paneMax(s: PaneSide, available: number, otherRendered: number): number {
  if (!(available > 0)) return PANE[s].max;
  return Math.min(PANE[s].max, Math.max(PANE[s].min, budgetOf(available) - otherRendered));
}

/**
 * Global (one pair for every tab), persisted as `code-git:shell:paneWidths`: the widths the user chose. A window too
 * narrow for them renders fitted widths and keeps these, so the choice comes back when the window grows.
 */
export const paneWidthsStore = createStore<PaneWidths>(parsePaneWidths(getItem(KEY)));
paneWidthsStore.subscribe(() => setItem(KEY, JSON.stringify(paneWidthsStore.get())));

export const setPaneWidth = (s: PaneSide, px: number): void => paneWidthsStore.set((w) => ({ ...w, [s]: side(px, s) }));
export const usePaneWidths = (): PaneWidths => useStore(paneWidthsStore);
export const resetPaneWidths = (): void => paneWidthsStore.set({ left: PANE.left.default, right: PANE.right.default });
