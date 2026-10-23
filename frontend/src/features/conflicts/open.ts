import { headOf } from '@/features/branches/refInfo';
import { conflictRead, type ConflictRead } from '@/features/sequence/api';
import { sideLabels, type SideLabels } from '@/features/sequence/labels';
import { getGraph } from '@/state/graph';
import { hidePanel, showPanel } from '@/state/shownPanel';
import type { Tab } from '@/state/tabs';
import { workdirOf } from '@/state/workdir';
import { merge3 } from './diff3';
import { initialOutput } from './output';
import { clearTool, setTool, type NotText, type ToolFile } from './state';

export const CONFLICT_PANEL_ID = 'conflicts';

/** The Current / Incoming names for this checkout now (what is in progress, HEAD's branch, the graph's refs). */
export const labelsFor = (tab: Tab): SideLabels => sideLabels(workdirOf(tab).operation, headOf(tab).branch, getGraph(tab).refs?.refs ?? []);

const fatal = new TextDecoder('utf-8', { fatal: true });
/** base64 → text, or null when the bytes are not UTF-8. */
function utf8(b64: string | null): string | null {
  if (b64 === null) return '';
  try {
    return fatal.decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The tool's model of a conflict.read answer: the sides as text, the merge regions and the initial output. */
function fileOf(read: ConflictRead, labels: SideLabels): ToolFile {
  const blank = { sides: null, regions: null, out: { text: '', blocks: [] } };
  const base: Omit<ToolFile, 'sides' | 'regions' | 'out' | 'notText'> = {
    path: read.path, read, expect: read.worktree?.oid ?? null, worktreeText: read.worktree ? utf8(read.worktree.b64) : null,
    dirty: false, busy: false, error: null, current: 0,
  };
  if (read.content !== 'text') return { ...base, ...blank, notText: read.content as NotText };
  const sides = { base: utf8(read.base?.b64 ?? null), ours: utf8(read.ours?.b64 ?? null), theirs: utf8(read.theirs?.b64 ?? null) };
  if (sides.base === null || sides.ours === null || sides.theirs === null) return { ...base, ...blank, notText: 'notUtf8' };
  const regions = merge3(sides.base, sides.ours, sides.theirs);
  if (!regions) return { ...base, ...blank, sides: sides as ToolFile['sides'], notText: 'tooDifferent' };
  return { ...base, sides: sides as ToolFile['sides'], regions, out: initialOutput(regions, labels), notText: null };
}

/** Opens the conflict tool on `path` in the graph's place, reading the conflict first. */
export async function openConflict(tab: Tab, path: string): Promise<void> {
  setTool(tab, { status: 'loading', path });
  showPanel(tab, CONFLICT_PANEL_ID);
  try {
    setTool(tab, { status: 'ready', file: fileOf(await conflictRead(tab, path), labelsFor(tab)) });
  } catch (e) {
    setTool(tab, { status: 'error', path, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Closes the tool: the graph comes back. */
export function closeConflict(tab: Tab): void {
  clearTool(tab);
  hidePanel(tab);
}
