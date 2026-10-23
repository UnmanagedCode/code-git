import { createStore, useStore } from '@/state/store';

// Which of the shell's own overlays is open: the command palette or the shortcut sheet (one at a time).

export type Overlay = 'palette' | 'sheet' | null;
export const overlayStore = createStore<Overlay>(null);
export const openPalette = (): void => overlayStore.set('palette');
export const openShortcutSheet = (): void => overlayStore.set('sheet');
export const closeOverlay = (): void => overlayStore.set(null);
export const resetOverlays = closeOverlay;
export const useOverlay = (): Overlay => useStore(overlayStore);
