import { hidePanel, showPanel } from '@/state/shownPanel';
import type { Tab } from '@/state/tabs';
import { loadMoreBlame, loadMoreHistory, loadMoreReflog, setFileView, startFileHistory, startReflog } from './state';

// The history feature's entry points: a file's history or blame, and a reflog, each in the graph's place.

export const HISTORY_PANEL_ID = 'history';
export const REFLOG_PANEL_ID = 'reflog';

/** Opens `path`'s history from commit `rev` (a full oid: the pages stay stable while refs move). */
export function openFileHistory(tab: Tab, { path, rev }: { path: string; rev: string }): void {
  startFileHistory(tab, path, rev, 'history');
  showPanel(tab, HISTORY_PANEL_ID);
  void loadMoreHistory(tab);
}

/** Opens `path`'s blame at `rev`, with its history one toggle away. */
export function openBlame(tab: Tab, { path, rev }: { path: string; rev: string }): void {
  startFileHistory(tab, path, rev, 'blame');
  showPanel(tab, HISTORY_PANEL_ID);
  void loadMoreBlame(tab);
  void loadMoreHistory(tab);
}

/** Switches the open file between History and Blame, loading the blame the first time. */
export function showFileView(tab: Tab, view: 'history' | 'blame'): void {
  setFileView(tab, view);
  if (view === 'blame') void loadMoreBlame(tab);
}

/** Opens the reflog of `ref` (HEAD, or a local branch's full name). */
export function openReflog(tab: Tab, ref = 'HEAD'): void {
  startReflog(tab, ref);
  showPanel(tab, REFLOG_PANEL_ID);
  void loadMoreReflog(tab);
}

export const closeHistoryPanel = (tab: Tab): void => hidePanel(tab);
