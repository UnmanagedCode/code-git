import type { MenuAction } from '@/shell/menus';
import type { Tab } from '@/state/tabs';
import type { DiffFile, DiffSource } from './api';
import { copyPatch, downloadPatch } from './patch';

/** A file-list menu: the files it acts on (the selection, or the row right-clicked outside it) and the patch source. */
export interface DiffFileCtx { tab: Tab; files: DiffFile[]; source: DiffSource }

const paths = (c: DiffFileCtx) => c.files.map((f) => f.path);

export const DIFF_FILE_ACTIONS: MenuAction<DiffFileCtx>[] = [
  { id: 'diff.copyPath', context: 'diff-file', label: 'Copy path', run: (c) => navigator.clipboard?.writeText(paths(c).join('\n')) },
  { id: 'diff.downloadPatch', context: 'diff-file', label: 'Create patch from selection (download)', run: (c) => downloadPatch(c.tab, c.source, paths(c)) },
  { id: 'diff.copyPatch', context: 'diff-file', label: 'Copy patch of selection', run: (c) => copyPatch(c.tab, c.source, paths(c)) },
];
