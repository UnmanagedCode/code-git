import { useState } from 'react';
import { FolderGit2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefDialogHost } from '@/features/branches/RefDialogHost';
import { RepoPicker } from '@/features/repos/RepoPicker';
import { StashDialogHost } from '@/features/stash/StashDialogHost';
import { RepoHeader } from '@/features/repo/RepoHeader';
import { TabBar } from '@/features/tabs/TabBar';
import { useTabShortcuts } from '@/features/tabs/useTabShortcuts';
import { hidePanel, useShownPanel } from '@/state/shownPanel';
import { activeTab, dispatchTabs, tabKey, useTabs, type Tab } from '@/state/tabs';
import { PanelBoundary } from './PanelBoundary';
import { panelsFor, type PanelSlot } from './panels';

function Slot({ slot, tab, className }: { slot: PanelSlot; tab: Tab | null; className?: string }) {
  const shown = useShownPanel(tab);
  const all = panelsFor(slot);
  const od = all.find((p) => p.onDemand && p.id === shown);
  const panels = od ? [od] : all.filter((p) => !p.onDemand);
  if (!panels.length) return null;
  return (
    <div className={className} data-slot-name={slot}>
      {panels.map(({ id, title, onDemand, component: C }) => (
        <PanelBoundary key={id} title={title} resetKey={tab ? tabKey(tab) : ''} onClose={onDemand && tab ? () => hidePanel(tab) : undefined}>
          <C tab={tab} />
        </PanelBoundary>
      ))}
    </div>
  );
}

/** The page: tabs, the active checkout's header, the panel slots, the picker. Full width: it caps no content. */
export function Shell() {
  const tabs = useTabs();
  const tab = activeTab(tabs);
  const [pickerOpen, setPickerOpen] = useState(false);
  useTabShortcuts();
  return (
    <div className="flex h-full flex-col">
      <TabBar onAdd={() => setPickerOpen(true)} />
      {tab ? (
        <>
          <RepoHeader key={tabKey(tab)} tab={tab} />
          <main className="flex min-h-0 flex-1">
            <Slot slot="left" tab={tab} className="hidden w-64 shrink-0 overflow-y-auto border-r lg:block" />
            <Slot slot="center" tab={tab} className="min-w-0 flex-1 overflow-auto" />
            <Slot slot="right" tab={tab} className="hidden w-80 shrink-0 overflow-y-auto border-l lg:block" />
          </main>
        </>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <FolderGit2Icon className="size-10" />
          <p className="text-sm">No repository open.</p>
          <Button onClick={() => setPickerOpen(true)}>Open a repository</Button>
        </main>
      )}
      <Slot slot="bottom" tab={tab} />
      <RepoPicker open={pickerOpen} onOpenChange={setPickerOpen} onOpen={(t) => dispatchTabs({ type: 'open', tab: t })} />
      <RefDialogHost />
      <StashDialogHost />
    </div>
  );
}
