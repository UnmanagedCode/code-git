import { useState } from 'react';
import { FolderGit2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefDialogHost } from '@/features/branches/RefDialogHost';
import { FlowHost } from '@/features/flow/FlowHost';
import { LfsHost } from '@/features/lfs/LfsHost';
import { RemotesHost } from '@/features/remotes/RemotesHost';
import { RepoPicker } from '@/features/repos/RepoPicker';
import { StashDialogHost } from '@/features/stash/StashDialogHost';
import { SequenceDialogHost } from '@/features/sequence/SequenceDialogHost';
import { SubmoduleDialogHost } from '@/features/submodules/SubmoduleDialogHost';
import { RepoHeader } from '@/features/repo/RepoHeader';
import { TabBar } from '@/features/tabs/TabBar';
import { useTabShortcuts } from '@/features/tabs/useTabShortcuts';
import { UNDO_SHELL_KEYS } from '@/features/undo/flows';
import { hidePanel, useShownPanel } from '@/state/shownPanel';
import { activeTab, dispatchTabs, tabKey, useTabs, type Tab } from '@/state/tabs';
import { CommandPalette } from './CommandPalette';
import { PaneHandle } from './PaneHandle';
import { PanelBoundary } from './PanelBoundary';
import { panelsFor, type PanelSlot } from './panels';
import { ShortcutSheet } from './ShortcutSheet';
import { usePaneLayout } from './usePaneLayout';
import { useShellKeys } from './useShellKeys';

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
  // A state ref: the layout hook re-observes when <main> mounts with the first tab.
  const [main, setMain] = useState<HTMLElement | null>(null);
  const panes = usePaneLayout(main);
  useTabShortcuts();
  useShellKeys(UNDO_SHELL_KEYS);
  return (
    <div className="flex h-full flex-col">
      <TabBar onAdd={() => setPickerOpen(true)} />
      {tab ? (
        <>
          <RepoHeader key={tabKey(tab)} tab={tab} />
          <main ref={setMain} className="flex min-h-0 flex-1">
            <Slot slot="left" tab={tab} className="hidden w-(--pane-left) shrink-0 overflow-y-auto border-r lg:block" />
            <PaneHandle side="left" main={main} layout={panes} />
            <Slot slot="center" tab={tab} className="min-w-0 flex-1 overflow-auto" />
            <PaneHandle side="right" main={main} layout={panes} />
            <Slot slot="right" tab={tab} className="hidden w-(--pane-right) shrink-0 overflow-y-auto border-l lg:block" />
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
      <RemotesHost />
      <SequenceDialogHost />
      <SubmoduleDialogHost />
      <FlowHost />
      <LfsHost />
      <CommandPalette />
      <ShortcutSheet />
    </div>
  );
}
