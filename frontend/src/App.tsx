import { useEffect } from 'react';
import { followLink } from '@/features/links/inbound';
import { cancelMenuTarget, openMenuTarget } from '@/features/links/menu';
import { consumeLink, consumeMenuTarget, readRoute, writeRoute } from '@/lib/route';
import { Shell } from '@/shell/Shell';
import { loadIntegrations } from '@/state/integrations';
import { activeTab, dispatchTabs, loadTabs, tabsStore } from '@/state/tabs';
import { loadRepos } from '@/state/useRepos';

/**
 * Restores the tabs (storage, then the URL's tab on top), keeps the URL on the active tab, and follows Back/cc navigation.
 * A link's one-shot keys are stripped before the tab opens: the tab store's writeRoute would otherwise push the strip.
 * A cc row target is replaced by the active tab's route before it is validated, and its tab opens once cc's listing
 * confirms it. The cleanup cancels neither a link's wait nor a pending target (StrictMode's double mount).
 */
export function App() {
  useEffect(() => {
    tabsStore.set(loadTabs());
    const menu = consumeMenuTarget(activeTab(tabsStore.get()));
    const link = menu ? null : consumeLink();
    const fromUrl = menu ? null : readRoute();
    if (fromUrl) dispatchTabs({ type: 'open', tab: fromUrl });
    if (fromUrl && link) followLink(activeTab(tabsStore.get())!, link);
    writeRoute(activeTab(tabsStore.get()));
    const unsubscribe = tabsStore.subscribe(() => writeRoute(activeTab(tabsStore.get())));
    const onPop = () => {
      const popMenu = consumeMenuTarget(activeTab(tabsStore.get()));
      if (popMenu) { void openMenuTarget(popMenu); return; }
      // A Back/Forward to a tab route supersedes a pending menu target.
      cancelMenuTarget();
      const popLink = consumeLink();
      const t = readRoute();
      if (!t) return;
      dispatchTabs({ type: 'open', tab: t });
      if (popLink) followLink(activeTab(tabsStore.get())!, popLink);
    };
    window.addEventListener('popstate', onPop);
    if (menu) void openMenuTarget(menu);
    // The header's System badge needs the project rows.
    void loadRepos();
    void loadIntegrations();
    return () => { unsubscribe(); window.removeEventListener('popstate', onPop); };
  }, []);
  return <Shell />;
}
