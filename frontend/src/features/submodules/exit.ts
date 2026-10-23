import { toast } from 'sonner';
import { clip } from '@/lib/clip';
import { openSubmoduleDialog, submoduleDialogStore, type SubmoduleDialog } from '@/state/submoduleDialog';
import { parentTab, tabKey, tabsStore, type Tab } from '@/state/tabs';
import { listSubmodules } from './api';

// Leaving a submodule tab — by any way it closes (its ✕, Close, Close others, Back to the parent) — offers to commit the
// submodule's new pointer in its parent when its HEAD is not the commit the parent has committed. Offers that arrive
// while one is open wait their turn.

const queue: SubmoduleDialog[] = [];

function show(d: SubmoduleDialog): void {
  if (submoduleDialogStore.get()) queue.push(d); else openSubmoduleDialog(d);
}
submoduleDialogStore.subscribe(() => {
  if (!submoduleDialogStore.get() && queue.length) openSubmoduleDialog(queue.shift()!);
});
export const resetSubmoduleExit = (): void => { queue.length = 0; };

/** Opens the pointer dialog for the submodule tab `closed` when its parent's committed pointer differs from its HEAD. */
export async function offerPointerCommit(closed: Tab): Promise<void> {
  const parent = parentTab(closed);
  const path = closed.sub!.at(-1)!;
  let entry;
  try {
    entry = (await listSubmodules(parent)).submodules.find((e) => e.path === path);
  } catch (e) {
    toast.error(clip(`Could not check ${path}'s pointer in its parent`), { description: clip(e instanceof Error ? e.message : String(e)) });
    return;
  }
  if (!entry || entry.blocked || !entry.populated || !entry.head || entry.head === entry.committed) return;
  show({ kind: 'pointer', tab: parent, entry });
}

/** Watches the open tabs for submodule tabs that close; → the unsubscribe. Started by the dialog host while mounted. */
export function watchSubmoduleExits(): () => void {
  let prev = tabsStore.get().open;
  return tabsStore.subscribe(() => {
    const now = tabsStore.get().open;
    if (now === prev) return;
    const open = new Set(now.map(tabKey));
    for (const t of prev) if (t.sub && !open.has(tabKey(t))) void offerPointerCommit(t);
    prev = now;
  });
}
