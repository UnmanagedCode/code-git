import { ApiError } from '@/lib/api';
import { listDiffFiles, type DiffFilesResult } from '@/features/diff/api';
import {
  commitCreate, commitState, commitTemplate, headMessage, stageFiles, type CommitParams, type Draft,
} from '@/features/workdir/api';
import { diffStore, loadList } from './diff';
import { pruneClosedTabs } from './shownPanel';
import { createStore } from './store';
import { tabKey, tabsStore, type Tab } from './tabs';
import { loadSummary } from './useRepoSummary';

// The Changes panel's state per checkout: the unstaged and staged lists (diff.files), the commit draft, amend and
// skip-hooks, the template, the last op error, and the narrow-screen dialog. Every op the panel runs goes through runWorkdirOp.

export interface OpError { message: string; stderr: string | null }
export interface WorkdirState {
  unstaged: DiffFilesResult | null;
  staged: DiffFilesResult | null;
  merging: boolean;
  loading: boolean;
  error: string | null;
  /** An op is running: the panel's actions are disabled. */
  busy: boolean;
  opError: OpError | null;
  draft: Draft;
  /** The commit.template draft, null when there is none; the draft equal to it counts as unedited. */
  templateDraft: Draft | null;
  templateProblem: string | null;
  amend: { on: boolean; head: Draft | null; saved: Draft | null };
  noVerify: boolean;
  /** A focus request for the summary box of one instance (the slot or the narrow dialog), consumed by it. */
  focus: 'slot' | 'dialog' | null;
  dialogOpen: boolean;
}

export const EMPTY_DRAFT: Draft = { summary: '', description: '' };
const fresh = (): WorkdirState => ({
  unstaged: null, staged: null, merging: false, loading: false, error: null, busy: false, opError: null, draft: EMPTY_DRAFT,
  templateDraft: null, templateProblem: null, amend: { on: false, head: null, saved: null }, noVerify: false, focus: null, dialogOpen: false,
});

/** Per checkout, keyed by tabKey. */
export const workdirStore = createStore<ReadonlyMap<string, WorkdirState>>(new Map());
tabsStore.subscribe(() => pruneClosedTabs(workdirStore));
export const resetWorkdir = (): void => workdirStore.set(new Map());

export const workdirOf = (tab: Tab): WorkdirState => workdirStore.get().get(tabKey(tab)) ?? fresh();
const put = (tab: Tab, f: (s: WorkdirState) => WorkdirState) =>
  workdirStore.set((m) => new Map(m).set(tabKey(tab), f(m.get(tabKey(tab)) ?? fresh())));

export const sameDraft = (a: Draft, b: Draft | null): boolean => !!b && a.summary.trim() === b.summary.trim() && a.description.trimEnd() === b.description.trimEnd();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toOpError = (e: unknown): OpError => {
  const body = e instanceof ApiError ? (e.body as { stderr?: unknown } | undefined) : undefined;
  return { message: message(e), stderr: typeof body?.stderr === 'string' && body.stderr.trim() ? body.stderr : null };
};

/** Reloads both lists and the merge state. */
export async function refreshWorkdir(tab: Tab): Promise<void> {
  put(tab, (s) => ({ ...s, loading: true, error: null }));
  try {
    const [unstaged, staged, state] = await Promise.all([
      listDiffFiles(tab, { kind: 'unstaged' }, 'none'), listDiffFiles(tab, { kind: 'staged' }, 'none'), commitState(tab),
    ]);
    put(tab, (s) => ({ ...s, unstaged, staged, merging: state.merging, loading: false }));
  } catch (e) {
    put(tab, (s) => ({ ...s, loading: false, error: message(e) }));
  }
}

/** First show per tab: the lists, and the template once (it pre-fills an empty draft while amend is off). */
export async function ensureWorkdir(tab: Tab): Promise<void> {
  if (workdirStore.get().has(tabKey(tab))) return;
  put(tab, (s) => s);
  void refreshWorkdir(tab);
  try {
    const t = await commitTemplate(tab);
    put(tab, (s) => {
      const fill = !!t.draft && !s.amend.on && sameDraft(s.draft, EMPTY_DRAFT);
      return { ...s, templateDraft: t.draft, templateProblem: t.problem, draft: fill && t.draft ? t.draft : s.draft };
    });
  } catch {
    // No template is not an error worth showing: the box simply starts empty.
  }
}

/** Everything that may have changed after a write: the lists, the header summary, and an open unstaged/staged diff. */
export async function refreshAfterWrite(tab: Tab): Promise<void> {
  const kind = diffStore.get().get(tabKey(tab))?.source.kind;
  await Promise.all([refreshWorkdir(tab), loadSummary(tab), ...(kind === 'unstaged' || kind === 'staged' ? [loadList(tab)] : [])]);
}

/**
 * Runs one write for the panel: busy while it runs, its failure kept as `opError` (with git's stderr: hook output), and
 * the lists, summary and open diff refreshed after it either way. Resolves whether it succeeded.
 */
export async function runWorkdirOp(tab: Tab, f: () => Promise<unknown>): Promise<boolean> {
  put(tab, (s) => ({ ...s, busy: true, opError: null }));
  let ok = true;
  try {
    await f();
  } catch (e) {
    ok = false;
    put(tab, (s) => ({ ...s, opError: toOpError(e) }));
  }
  put(tab, (s) => ({ ...s, busy: false }));
  await refreshAfterWrite(tab);
  return ok;
}

export const setDraft = (tab: Tab, d: Partial<Draft>): void => put(tab, (s) => ({ ...s, draft: { ...s.draft, ...d } }));
export const setNoVerify = (tab: Tab, on: boolean): void => put(tab, (s) => ({ ...s, noVerify: on }));
export const setDialogOpen = (tab: Tab, open: boolean): void => put(tab, (s) => ({ ...s, dialogOpen: open }));
export const requestFocus = (tab: Tab, where: 'slot' | 'dialog'): void => put(tab, (s) => ({ ...s, focus: where }));
export const consumeFocus = (tab: Tab): void => put(tab, (s) => ({ ...s, focus: null }));
export const clearOpError = (tab: Tab): void => put(tab, (s) => ({ ...s, opError: null }));

/** Ticking Amend loads HEAD's message into the fields and keeps the draft aside; unticking puts the draft back. */
export async function setAmend(tab: Tab, on: boolean): Promise<void> {
  const cur = workdirOf(tab);
  if (on === cur.amend.on) return;
  if (!on) {
    put(tab, (s) => ({ ...s, draft: s.amend.saved ?? EMPTY_DRAFT, amend: { on: false, head: null, saved: null } }));
    return;
  }
  put(tab, (s) => ({ ...s, amend: { on: true, head: null, saved: s.draft }, opError: null }));
  try {
    const h = await headMessage(tab);
    const head = { summary: h.summary, description: h.description };
    put(tab, (s) => (s.amend.on ? { ...s, draft: head, amend: { ...s.amend, head } } : s));
  } catch (e) {
    put(tab, (s) => ({ ...s, draft: s.amend.saved ?? s.draft, amend: { on: false, head: null, saved: null }, opError: toOpError(e) }));
  }
}

export type CommitMode = 'commit' | 'amend' | 'message';

/** Commits the draft. Success: the draft goes back to the template (or empty) and amend is unticked. */
export async function commitDraft(tab: Tab, mode: CommitMode, opts: { stageAll?: boolean } = {}): Promise<boolean> {
  const s = workdirOf(tab);
  const params: CommitParams = {
    ...s.draft, ...(mode !== 'commit' ? { amend: true } : {}), ...(mode === 'message' ? { messageOnly: true } : {}), ...(s.noVerify ? { noVerify: true } : {}),
  };
  const ok = await runWorkdirOp(tab, async () => {
    if (opts.stageAll) await stageFiles(tab, { all: true });
    await commitCreate(tab, params);
  });
  if (ok) put(tab, (x) => ({ ...x, draft: x.templateDraft ?? EMPTY_DRAFT, amend: { on: false, head: null, saved: null } }));
  return ok;
}
