import { rebasePlan, type PlanSpec } from '@/features/sequence/api';
import { hidePanel, showPanel } from '@/state/shownPanel';
import type { Tab } from '@/state/tabs';
import { presetRows, type EditorMode } from './model';
import { clearEditor, setEditor } from './state';

export const REBASE_PANEL_ID = 'rebase';

/** What an editor is opened for: the mode, the rebase's base / onto / HEAD, how they are named, and which commits it lists. */
export interface EditorSpec {
  mode: EditorMode; base: string; onto: string; ontoLabel: string; branch: string; expect: string; plan: PlanSpec;
  /** The squash preset's selected run. */
  selected?: string[];
}

/** Opens the interactive-rebase editor for `tab` in the graph's place, loading its commits (rebase.plan) first. */
export async function openRebaseEditor(tab: Tab, spec: EditorSpec): Promise<void> {
  setEditor(tab, { status: 'loading' });
  showPanel(tab, REBASE_PANEL_ID);
  try {
    const { commits } = await rebasePlan(tab, spec.plan);
    const rows = presetRows(spec.mode, commits, spec.selected);
    setEditor(tab, {
      status: 'ready',
      session: {
        mode: spec.mode, base: spec.base, onto: spec.onto, ontoLabel: spec.ontoLabel, branch: spec.branch, expect: spec.expect,
        commits: Object.fromEntries(commits.map((c) => [c.oid, c])), rows, original: rows,
      },
    });
  } catch (e) {
    setEditor(tab, { status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

/** Closes the editor: the graph comes back. */
export function closeRebaseEditor(tab: Tab): void {
  clearEditor(tab);
  hidePanel(tab);
}
