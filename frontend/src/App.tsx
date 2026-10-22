import { useEffect } from 'react';
import { readRoute, writeRoute } from '@/lib/route';
import { Shell } from '@/shell/Shell';
import { activeTab, dispatchTabs, loadTabs, tabsStore } from '@/state/tabs';
import { loadRepos } from '@/state/useRepos';

/** Restores the tabs (storage, then the URL's tab on top), keeps the URL on the active tab, and follows Back/cc navigation. */
export function App() {
  useEffect(() => {
    tabsStore.set(loadTabs());
    const fromUrl = readRoute();
    if (fromUrl) dispatchTabs({ type: 'open', tab: fromUrl });
    writeRoute(activeTab(tabsStore.get()));
    const unsubscribe = tabsStore.subscribe(() => writeRoute(activeTab(tabsStore.get())));
    const onPop = () => {
      const t = readRoute();
      if (t) dispatchTabs({ type: 'open', tab: t });
    };
    window.addEventListener('popstate', onPop);
    // The header's System badge needs the project rows.
    void loadRepos();
    return () => { unsubscribe(); window.removeEventListener('popstate', onPop); };
  }, []);
  return <Shell />;
}
