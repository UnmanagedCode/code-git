import { useEffect } from 'react';
import { matchCombo, type Combo } from '@/shell/shortcuts';
import { dispatchTabs, tabsStore } from '@/state/tabs';
import { TAB_ACTIVATE, TAB_LAST } from './keys';

/** Ctrl/⌘+1…8 activate that tab, Ctrl/⌘+9 the last one. Only while focus is inside the plugin's frame. */
export function useTabShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const nth = matchCombo(e, TAB_ACTIVATE);
      const last = matchCombo(e, TAB_LAST);
      if (!nth && !last) return;
      const count = tabsStore.get().open.length;
      e.preventDefault();
      dispatchTabs({ type: 'activateIndex', index: last ? count - 1 : (TAB_ACTIVATE.combos as readonly Combo[]).indexOf(nth!) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
