import { useEffect } from 'react';
import { cancelLink, followLink } from '@/features/links/inbound';
import { consumeLink, readRoute, writeRoute } from '@/lib/route';
import { Shell } from '@/shell/Shell';
import { loadIntegrations } from '@/state/integrations';
import { activeTab, dispatchTabs, loadTabs, tabsStore } from '@/state/tabs';
import { loadRepos } from '@/state/useRepos';

/**
 * Restores the tabs (storage, then the URL's tab on top), keeps the URL on the active tab, and follows Back/cc navigation.
 * A link's one-shot keys are stripped before the tab opens: the tab store's writeRoute would otherwise push the strip.
 */
export function App() {
  useEffect(() => {
    tabsStore.set(loadTabs());
    const link = consumeLink();
    const fromUrl = readRoute();
    if (fromUrl) dispatchTabs({ type: 'open', tab: fromUrl });
    if (fromUrl && link) followLink(activeTab(tabsStore.get())!, link);
    writeRoute(activeTab(tabsStore.get()));
    const unsubscribe = tabsStore.subscribe(() => writeRoute(activeTab(tabsStore.get())));
    const onPop = () => {
      const popLink = consumeLink();
      const t = readRoute();
      if (!t) return;
      dispatchTabs({ type: 'open', tab: t });
      if (popLink) followLink(activeTab(tabsStore.get())!, popLink);
    };
    window.addEventListener('popstate', onPop);
    // The header's System badge needs the project rows.
    void loadRepos();
    void loadIntegrations();
    return () => { unsubscribe(); window.removeEventListener('popstate', onPop); cancelLink(); };
  }, []);
  return <Shell />;
}
