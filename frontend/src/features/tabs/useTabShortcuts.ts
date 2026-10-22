import { useEffect } from 'react';
import { dispatchTabs, tabsStore } from '@/state/tabs';

/** Ctrl/⌘+1…8 activate that tab, Ctrl/⌘+9 the last one. Only while focus is inside the plugin's frame. */
export function useTabShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.length !== 1 || e.key < '1' || e.key > '9') return;
      const count = tabsStore.get().open.length;
      e.preventDefault();
      dispatchTabs({ type: 'activateIndex', index: e.key === '9' ? count - 1 : Number(e.key) - 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
