import type { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import type { ToastText } from '@/lib/opToast';
import type { MenuAction } from '@/shell/menus';
import { openSubmoduleDialog } from '@/state/submoduleDialog';
import { dispatchTabs, type Tab } from '@/state/tabs';
import { initSubmodules, removeSubmodule, syncSubmodules, updateSubmodules, type SubmoduleEntry } from './api';
import { runSubmoduleOp } from './run';

// The Submodules panel's row menu (docs/features.md → Submodules), context 'submodule'. Remove asks first; a refusal over
// work the server found (SUBMODULE_DIRTY, SUBMODULE_COMMITS_AT_RISK) offers a second, irreversible confirmation from
// its toast, which retries with the discard flag.

export const SUBMODULE_CONTEXT = 'submodule';
export interface SubmoduleCtx { tab: Tab; entry: SubmoduleEntry }

/** The submodule's own repo as a tab of its own (opened, or activated when open). */
export const subTab = (tab: Tab, entry: SubmoduleEntry): Tab => ({ project: tab.project, worktree: tab.worktree, sub: [...(tab.sub ?? []), entry.path] });
export const openSubmodule = (tab: Tab, entry: SubmoduleEntry): void => dispatchTabs({ type: 'open', tab: subTab(tab, entry) });

const pathsLabel = (paths: string[]) => (paths.length === 1 ? paths[0] : `${paths.length} submodules`);
const numbered = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The refusal's body fields. */
const bodyOf = <T>(e: ApiError) => (e.body ?? {}) as Partial<T>;

/** A SUBMODULE_COMMITS_AT_RISK refusal: the toast offers the confirmation that updates anyway. */
const atRiskRetry = (tab: Tab, paths: string[]) => (e: ApiError): Partial<ToastText> => {
  if (e.code !== 'SUBMODULE_COMMITS_AT_RISK') return {};
  const at = bodyOf<{ paths: { path: string; count: number }[] }>(e).paths ?? [];
  return {
    title: `Updating ${pathsLabel(paths)} would leave commits on no branch`,
    description: undefined,
    action: {
      label: 'Review…',
      onClick: () => void (async () => {
        const ok = await confirm({
          title: 'Leave these commits behind?', irreversible: true, confirmLabel: 'Update anyway',
          body: 'The checkout moves each submodule to the commit its parent records. These commits are on no branch: only the submodule\'s reflog will keep them.',
          items: at.map((x) => `${x.path}: ${numbered(x.count, 'commit')}`),
        });
        if (ok) await update(tab, paths, true);
      })(),
    },
  };
};

/** Initializes, clones and checks out `paths` at the recorded commits (recursive). */
export const update = (tab: Tab, paths: string[], discardCommits = false) => runSubmoduleOp(tab, {
  running: `Updating ${pathsLabel(paths)}…`, elapsed: true, done: () => `Updated ${pathsLabel(paths)}`, failed: atRiskRetry(tab, paths),
}, () => updateSubmodules(tab, paths, discardCommits));

export const initialize = (tab: Tab, entry: SubmoduleEntry) => runSubmoduleOp(tab, {
  running: `Initializing ${entry.path}…`,
  done: (r): ToastText => {
    const problem = r.submodules[0]?.urlProblem;
    return {
      tone: problem ? 'warning' : 'success',
      title: `Initialized ${entry.path}`,
      description: problem ? `Its url is refused: ${problem}` : 'Update clones it and checks out the recorded commit.',
      action: problem ? undefined : { label: 'Update', onClick: () => void update(tab, [entry.path]) },
    };
  },
}, () => initSubmodules(tab, [entry.path]));

export const sync = (tab: Tab, entry: SubmoduleEntry) => runSubmoduleOp(tab, {
  running: `Syncing ${entry.path}…`, done: () => `Synced ${entry.path}'s url`,
}, () => syncSubmodules(tab, [entry.path]));

/** The facts of a SUBMODULE_DIRTY refusal, as lines. */
function dirtyFacts(e: ApiError): string[] {
  const b = bodyOf<{ modified: boolean; untracked: boolean; orphaned: number; staged: boolean; gitmodules: boolean }>(e);
  return [
    b.modified && 'Changed files in the submodule',
    b.untracked && 'Untracked files in the submodule',
    b.orphaned ? `${numbered(b.orphaned, 'commit')} on no branch` : null,
    b.staged && 'A staged pointer change in this repository',
    b.gitmodules && 'Unstaged changes to .gitmodules',
  ].filter((x): x is string => !!x);
}

function removeAttempt(tab: Tab, entry: SubmoduleEntry, discard: boolean): Promise<unknown> {
  return runSubmoduleOp(tab, {
    running: `Removing ${entry.path}…`, done: () => ({ title: `Removed ${entry.path}`, description: 'Commit the change to .gitmodules and the removed gitlink in the Changes panel.' }),
    failed: (e): Partial<ToastText> => (e.code !== 'SUBMODULE_DIRTY' ? {} : {
      title: `${entry.path} has work removing it would throw away`,
      description: dirtyFacts(e).join(' · '),
      action: {
        label: 'Review…',
        onClick: () => void (async () => {
          const ok = await confirm({
            title: `Discard the work in ${entry.path}?`, irreversible: true, confirmLabel: 'Discard and remove',
            body: `Removing it deletes its working tree with what is listed.${bodyOf<{ gitmodules: boolean }>(e).gitmodules
              ? ' .gitmodules will be staged with the removal, its unstaged changes included.' : ''}`,
            items: dirtyFacts(e),
          });
          if (ok) await removeAttempt(tab, entry, true);
        })(),
      },
    }),
  }, () => removeSubmodule(tab, entry.path, discard));
}

export async function remove(tab: Tab, entry: SubmoduleEntry): Promise<void> {
  const ok = await confirm({
    title: `Remove the submodule ${entry.path}?`, confirmLabel: 'Remove submodule',
    body: 'Its directory, gitlink and .gitmodules entry are removed, staged for you to commit. Kept:',
    items: [`.git/modules/${entry.name} (its repository: adding the same name again is refused)`],
  });
  if (ok) await removeAttempt(tab, entry, false);
}

const usable = (c: SubmoduleCtx) => !c.entry.blocked;
export const SUBMODULE_ACTIONS: MenuAction<SubmoduleCtx>[] = [
  {
    id: 'submodule.open', context: SUBMODULE_CONTEXT, label: 'Open', order: 100, primary: true,
    when: (c) => usable(c) && c.entry.populated, run: (c) => openSubmodule(c.tab, c.entry),
  },
  { id: 'submodule.init', context: SUBMODULE_CONTEXT, label: 'Initialize', order: 200, when: (c) => usable(c) && !c.entry.initialized, run: (c) => void initialize(c.tab, c.entry) },
  { id: 'submodule.update', context: SUBMODULE_CONTEXT, label: 'Update', order: 210, when: usable, run: (c) => void update(c.tab, [c.entry.path]) },
  { id: 'submodule.sync', context: SUBMODULE_CONTEXT, label: 'Sync', order: 220, when: (c) => usable(c) && c.entry.initialized, run: (c) => void sync(c.tab, c.entry) },
  { id: 'submodule.editUrl', context: SUBMODULE_CONTEXT, label: 'Edit URL…', order: 300, group: 'edit', when: usable, run: (c) => openSubmoduleDialog({ kind: 'editUrl', tab: c.tab, entry: c.entry }) },
  { id: 'submodule.remove', context: SUBMODULE_CONTEXT, label: 'Remove…', order: 310, group: 'edit', destructive: true, when: usable, run: (c) => remove(c.tab, c.entry) },
];
