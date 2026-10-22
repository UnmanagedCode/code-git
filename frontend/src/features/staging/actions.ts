import type { FileDiff } from '@/features/diff/api';
import { discardLines, stageLines, unstageLines, type LineSelection } from '@/features/workdir/api';
import { confirm } from '@/lib/confirm';
import type { Target } from '@/lib/endpoints';
import { setNotice } from '@/state/diff';
import { clearLineSelection } from '@/state/lineSelection';
import { refreshAfterWrite } from '@/state/workdir';
import { previewLines } from './selection';

export type LineAction = 'stage' | 'unstage' | 'discard';
const OPS = { stage: stageLines, unstage: unstageLines, discard: discardLines };
const VERB = { stage: 'stage', unstage: 'unstage', discard: 'discard' };

/**
 * Stages, unstages or discards `req` (whole hunks or selected lines) of the viewed file. A discard asks first, showing
 * the lines it removes. A failure (STALE_DIFF, SELECTION_UNSUPPORTED, …) goes to the diff header's notice. The
 * selection is cleared and the lists, summary and diff are reloaded either way. Resolves whether it ran and succeeded.
 */
export async function applyLines(t: Target, action: LineAction, fd: FileDiff, context: number | 'full', req: LineSelection[]): Promise<boolean> {
  if (!req.length) return false;
  if (action === 'discard') {
    const n = req.reduce((k, h) => k + h.lines.length, 0);
    const ok = await confirm({
      title: `Discard ${n} ${n === 1 ? 'line' : 'lines'} of ${fd.path}?`,
      body: 'These changes are removed from the working tree.',
      preview: previewLines(fd, req),
      irreversible: true,
      confirmLabel: 'Discard lines',
    });
    if (!ok) return false;
  }
  setNotice(t, null);
  let ok = true;
  try {
    await OPS[action](t, { path: fd.path, context, hunks: req });
  } catch (e) {
    ok = false;
    setNotice(t, `Could not ${VERB[action]} the selection: ${e instanceof Error ? e.message : String(e)}`);
  }
  clearLineSelection(t);
  await refreshAfterWrite(t);
  return ok;
}
