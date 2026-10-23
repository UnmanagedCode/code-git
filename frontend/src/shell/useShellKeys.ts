import { useEffect } from 'react';
import { isTextEntry } from '@/lib/textEntry';
import { anyModalOpen } from '@/lib/modalFocus';
import { PALETTE_KEY, SHEET_KEY } from './keys';
import { openPalette, openShortcutSheet } from './overlays';
import { matches, type Shortcut } from './shortcuts';

const NONE: readonly (readonly [Shortcut, () => void])[] = [];

/**
 * The shell's global keys and any others a feature passes (`extra`: [shortcut, action]): ignored while focus is in a
 * text field (its own Ctrl/⌘+Z wins) or a modal dialog is open.
 */
export function useShellKeys(extra: readonly (readonly [Shortcut, () => void])[] = NONE): void {
  useEffect(() => {
    const bindings: (readonly [Shortcut, () => void])[] = [[PALETTE_KEY, openPalette], [SHEET_KEY, openShortcutSheet], ...extra];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextEntry(document.activeElement) || anyModalOpen()) return;
      const hit = bindings.find(([s]) => matches(e, s));
      if (!hit) return;
      e.preventDefault();
      hit[1]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [extra]);
}
