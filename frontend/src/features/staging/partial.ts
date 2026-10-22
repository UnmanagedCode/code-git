import type { DiffFile, DiffSource, FileDiff } from '@/features/diff/api';
import type { DiffPrefs } from '@/state/diff';

/**
 * Whether the viewed file gets hunk and line staging: an unstaged or staged diff of a modified text file (not binary,
 * a submodule, conflicted or an LFS pointer), shown as a diff with every whitespace change. The backend refuses
 * every other file PARTIAL_UNSUPPORTED; this is the single UI rule mirroring it.
 */
export function canPartial(file: DiffFile, diff: FileDiff | null, prefs: DiffPrefs, source: DiffSource): boolean {
  if (source.kind !== 'unstaged' && source.kind !== 'staged') return false;
  if (file.status !== 'M' || file.binary || file.submodule) return false;
  if (!diff || diff.binary || diff.unmerged || diff.submodule || diff.lfs || !diff.hunks.length) return false;
  return prefs.whitespace === 'none' && prefs.view === 'diff';
}
