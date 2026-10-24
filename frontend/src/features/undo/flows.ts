import type { ApiError } from '@/lib/api';
import { confirm, type ConfirmOptions } from '@/lib/confirm';
import { runRefOp } from '@/features/branches/run';
import { refreshTracking } from '@/state/branchTracking';
import { refreshRemotes } from '@/state/remotes';
import { refreshUndo, undoOf } from '@/state/undo';
import { activeTab, tabsStore, type Tab } from '@/state/tabs';
import { workdirOf } from '@/state/workdir';
import { runUndo, type UndoConfirm, type UndoDir, type UndoSlot } from './api';
import { REDO_KEY, UNDO_KEY } from './keys';

// Undo and redo from any surface (the header buttons, the keys, the palette, a toast's counter-action).

const VERB: Record<UndoDir, string> = { undo: 'Undo', redo: 'Redo' };
const PAST: Record<UndoDir, string> = { undo: 'Undid', redo: 'Redid' };
const OTHER: Record<UndoDir, UndoDir> = { undo: 'redo', redo: 'undo' };
const short = (ref: string) => ref.replace(/^refs\/(?:heads|tags|remotes)\//, '');
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Why undo and redo are off for `tab` right now, or null: an operation or conflicts in progress. */
export function blockedReason(tab: Tab): string | null {
  const w = workdirOf(tab);
  if (w.operation) return `A ${w.operation.kind} is in progress: continue or abort it first`;
  if (w.conflicts.length) return 'The index has conflicts: resolve them first';
  return null;
}

/** The confirmation text for `c`, structured from what the backend says the step does. */
export function confirmOptions(dir: UndoDir, slot: UndoSlot, c: UndoConfirm): ConfirmOptions {
  const title = `${VERB[dir]} ${slot.label}?`;
  const confirmLabel = VERB[dir];
  if (c.kind === 'deletesRefs') return { title, body: `This deletes ${c.refs.length === 1 ? 'this ref' : 'these refs'}:`, items: c.refs.map(short), count: c.refs.length, confirmLabel };
  if (c.kind === 'discards') return { title, body: 'This discards the changes in these files again:', items: c.paths, count: c.paths.length, confirmLabel };
  if (c.kind === 'dropsStashes') return { title, body: `This drops ${plural(c.messages.length, 'this stash', 'these stashes')}:`, items: c.messages, count: c.messages.length, confirmLabel };
  if (c.kind === 'deletesRemote') {
    if (!c.refs.length) return { title, body: `This removes the remote ${c.name}.`, confirmLabel };
    return { title, body: `This removes the remote ${c.name} and deletes ${plural(c.refs.length, 'its tracking ref', 'its tracking refs')}:`, items: c.refs.map(short), count: c.refs.length, confirmLabel };
  }
  return { title, body: 'This runs a hard reset: the index and the tracked files are replaced. Untracked files are kept.', confirmLabel };
}

/** The code-conductor/* branches a CC_OWNED_BRANCH refusal names, or null for any other error. */
function ccBranches(e: ApiError): string[] | null {
  if (e.code !== 'CC_OWNED_BRANCH') return null;
  const b = (e.body as { branches?: unknown } | undefined)?.branches;
  return Array.isArray(b) ? b.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Runs `tab`'s undo (redo) slot: its confirmation first when it has one (Cancel sends nothing), then the op through
 * runRefOp (toast, graph and Changes refresh; a `remote.*` entry also refetches the remotes and the tracking, which a
 * config-only change leaves the graph unaware of). Done: "Undid …" with the counter-action. A code-conductor/* refusal
 * offers Review…, which asks and retries with the acknowledgement.
 */
export async function undoFlow(tab: Tab, dir: UndoDir = 'undo'): Promise<void> {
  const slot = undoOf(tab).data?.[dir];
  if (!slot || blockedReason(tab)) return;
  if (slot.confirm && !(await confirm(confirmOptions(dir, slot, slot.confirm)))) return;
  const go = async (ccOwned?: true): Promise<void> => {
    await runRefOp(tab, {
      running: `${dir === 'undo' ? 'Undoing' : 'Redoing'} ${slot.label}…`,
      done: (r) => ({
        title: `${PAST[dir]} ${slot.label}`,
        ...(r.warnings.length ? { tone: 'warning' as const, description: r.warnings.join('\n') } : {}),
        action: { label: VERB[OTHER[dir]], onClick: () => void undoFlow(tab, OTHER[dir]) },
      }),
      failed: (e) => {
        const branches = ccBranches(e);
        if (branches === null) return undefined;
        return {
          title: `${branches.join(', ') || 'This branch'} is code-conductor's`,
          action: {
            label: 'Review…',
            onClick: () => void confirm({
              title: `${VERB[dir]} ${slot.label}?`, confirmLabel: `${VERB[dir]} anyway`,
              body: `It moves or deletes ${branches.join(', ') || "a code-conductor branch"}, which code-conductor tracks for one of its worktrees.`,
            }).then((ok) => (ok ? go(true) : undefined)),
          },
        };
      },
    }, () => runUndo(tab, dir, slot.id, ccOwned));
    if (slot.op.startsWith('remote.')) {
      void refreshRemotes(tab);
      void refreshTracking(tab);
    }
    await refreshUndo(tab);
  };
  await go();
}

export const redoFlow = (tab: Tab): Promise<void> => undoFlow(tab, 'redo');

/** Ctrl/⌘+Z and Ctrl/⌘+Shift+Z / Ctrl/⌘+Y on the active tab, for the shell's global keys (useShellKeys). */
const onActive = (f: (t: Tab) => unknown) => () => { const t = activeTab(tabsStore.get()); if (t) void f(t); };
export const UNDO_SHELL_KEYS = [[UNDO_KEY, onActive(undoFlow)], [REDO_KEY, onActive(redoFlow)]] as const;
