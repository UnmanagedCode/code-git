import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

/**
 * The details panel's commit-information header (px): its default height, its floor (the subject and one person row),
 * the room the file section always keeps below it (its "N files" row and about three file rows), the resize handle's own
 * height (its `h-2` class in `HeaderSplitter.tsx`) and the arrow-key step.
 */
export const DETAILS_HEADER = { default: 224, min: 96, filesMin: 112, handle: 8, step: 16 } as const;

const KEY = 'graph:detailsHeader';

/** A stored height: a finite number at or above the floor, else the default. */
export function parseHeaderHeight(raw: string | null): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= DETAILS_HEADER.min ? Math.round(n) : DETAILS_HEADER.default;
}

/** The tallest header that leaves the files their room in a panel `available` px tall; unbounded while unmeasured (0). */
export function headerMax(available: number): number {
  return available > 0 ? Math.max(DETAILS_HEADER.min, available - DETAILS_HEADER.handle - DETAILS_HEADER.filesMin) : Infinity;
}

/** The height rendered for a chosen one: never below the floor, never crushing the files. */
export function clampHeader(px: number, available: number): number {
  return Math.round(Math.max(DETAILS_HEADER.min, Math.min(headerMax(available), px)));
}

/**
 * Global, persisted as `code-git:graph:detailsHeader`: the height the user chose. A panel too short for it renders the
 * clamped height and keeps this one, so the choice comes back when the panel grows.
 */
export const detailsHeaderStore = createStore<number>(parseHeaderHeight(getItem(KEY)));
detailsHeaderStore.subscribe(() => setItem(KEY, String(detailsHeaderStore.get())));

export const setDetailsHeader = (px: number): void => detailsHeaderStore.set(Math.round(px));
export const useDetailsHeader = (): number => useStore(detailsHeaderStore);
export const resetDetailsHeader = (): void => detailsHeaderStore.set(DETAILS_HEADER.default);
