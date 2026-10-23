import type { Command, PickItem } from '@/shell/commands';
import { headOf } from '@/features/branches/refInfo';
import type { Tab } from '@/state/tabs';
import { loadPaths } from './api';
import { openBlame, openFileHistory, openReflog } from './open';

// The palette's history commands (shell/commands.ts): pick a file of HEAD (or type one), or open the reflog.

/** HEAD's files; a list over its cap (OUTPUT_TOO_LARGE) leaves only the typed path. */
async function headPaths(tab: Tab): Promise<PickItem[]> {
  const head = headOf(tab).oid;
  if (!head) return [];
  try {
    return (await loadPaths(tab, head)).paths.map((p) => ({ id: p, label: p }));
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'OUTPUT_TOO_LARGE') return [];
    throw e;
  }
}
const typed = (text: string): PickItem => ({ id: text, label: text, detail: 'typed path' });
const born = (tab: Tab) => headOf(tab).oid !== null;

export const HISTORY_COMMANDS: Command[] = [
  {
    id: 'history.file', title: 'File history…', group: 'History', when: born,
    pick: { placeholder: 'File (at HEAD)', items: headPaths, typed, run: (tab, item) => { const rev = headOf(tab).oid; if (rev) openFileHistory(tab, { path: item.id, rev }); } },
  },
  {
    id: 'history.blame', title: 'Blame…', group: 'History', when: born,
    pick: { placeholder: 'File (at HEAD)', items: headPaths, typed, run: (tab, item) => { const rev = headOf(tab).oid; if (rev) openBlame(tab, { path: item.id, rev }); } },
  },
  { id: 'history.reflog', title: 'Reflog', group: 'History', run: (tab) => openReflog(tab) },
];
