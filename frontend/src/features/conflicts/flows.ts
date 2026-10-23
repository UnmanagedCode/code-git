import { conflictSave, conflictTake } from '@/features/sequence/api';
import { runSequenceOp } from '@/features/sequence/flows';
import { stageFiles } from '@/features/workdir/api';
import { confirm } from '@/lib/confirm';
import type { Tab } from '@/state/tabs';
import { workdirOf } from '@/state/workdir';
import { closeConflict, labelsFor, openConflict } from './open';
import { hasMarkers, unresolved } from './output';
import { toolOf, updateFile } from './state';

// What the conflict tool and the Changes rows run (docs/merge.md → The conflict tool): save the Output to the worktree,
// mark a file resolved (stage.files), take one side for several files. Each refreshes the Changes panel (runSequenceOp).

const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const SIDE_WORD = { ours: 'current', theirs: 'incoming' } as const;

/** UTF-8 text → base64. */
function toB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Writes the tool's Output to the worktree file (only the worktree: the stages stay until Mark resolved). A file whose
 * worktree text had no conflict marker when read was edited outside the tool: asks before overwriting it. Resolves
 * whether it saved.
 */
export async function saveConflict(tab: Tab): Promise<boolean> {
  const t = toolOf(tab);
  if (t?.status !== 'ready') return false;
  const f = t.file;
  if (f.worktreeText !== null && !hasMarkers(f.worktreeText)) {
    const ok = await confirm({
      title: `Overwrite ${f.path}?`, body: 'It was changed outside the merge tool (it has no conflict markers); saving replaces that version with the Output.',
      confirmLabel: 'Overwrite',
    });
    if (!ok) return false;
  }
  updateFile(tab, (x) => ({ ...x, busy: true, error: null }));
  const r = await runSequenceOp(tab, { running: `Saving ${f.path}…`, done: () => `Saved ${f.path}` }, () => conflictSave(tab, { path: f.path, contentB64: toB64(f.out.text), expect: f.expect }));
  updateFile(tab, (x) => (r.ok
    // The file is now the tool's own: no "changed outside" question on the next save.
    ? { ...x, busy: false, dirty: false, expect: r.result.oid, worktreeText: null }
    : { ...x, busy: false, error: r.error.message }));
  return r.ok;
}

/** Stages `path` as resolved (stage.files: the file, or its deletion). From the tool: saves first, asks when markers remain. */
export async function markResolved(tab: Tab, path: string): Promise<boolean> {
  const t = toolOf(tab);
  const inTool = t?.status === 'ready' && t.file.path === path ? t.file : null;
  if (inTool && !inTool.notText && (hasMarkers(inTool.out.text) || unresolved(inTool.out.blocks).length)) {
    const ok = await confirm({
      title: `Mark ${path} resolved with conflicts left?`, body: 'The Output still has conflict markers or conflicts not picked; they are committed as they are.',
      confirmLabel: 'Mark resolved',
    });
    if (!ok) return false;
  }
  if (inTool?.dirty && !(await saveConflict(tab))) return false;
  const r = await runSequenceOp(tab, { running: `Marking ${path} resolved…`, done: () => `Marked ${path} resolved` }, () => stageFiles(tab, { paths: [path] }));
  if (r.ok && inTool) await nextOrClose(tab, path);
  return r.ok;
}

/** After `path` is resolved in the tool: the next conflicted file, or close. */
async function nextOrClose(tab: Tab, path: string): Promise<void> {
  const next = workdirOf(tab).conflicts.find((c) => c.path !== path);
  if (next) await openConflict(tab, next.path);
  else closeConflict(tab);
}

/**
 * Takes one side for `paths`, after asking: each becomes that side's version and is staged; a file that side deleted is
 * deleted (named in the confirmation).
 */
export async function takeSide(tab: Tab, paths: string[], side: 'ours' | 'theirs'): Promise<boolean> {
  const conflicts = workdirOf(tab).conflicts;
  const deleted = paths.filter((p) => { const c = conflicts.find((x) => x.path === p); return !!c && !c[side]; });
  const label = labelsFor(tab)[side === 'ours' ? 'current' : 'incoming'];
  const ok = await confirm({
    title: `Take ${SIDE_WORD[side]} (${label}) for ${plural(paths.length)}?`,
    body: `Each file becomes the ${SIDE_WORD[side]} version and is staged; the other side's changes to it, and any resolution made, are discarded.${deleted.length ? ` ${plural(deleted.length)} that side deleted ${deleted.length === 1 ? 'is' : 'are'} deleted.` : ''}`,
    items: paths.map((p) => (deleted.includes(p) ? `${p} (deleted)` : p)),
    confirmLabel: `Take ${SIDE_WORD[side]}`,
  });
  if (!ok) return false;
  const r = await runSequenceOp(tab, {
    running: `Taking ${SIDE_WORD[side]}…`, done: (x) => `Took ${SIDE_WORD[side]} for ${plural(x.resolved.length + x.deleted.length)}`,
  }, () => conflictTake(tab, paths, side));
  const t = toolOf(tab);
  if (r.ok && t?.status === 'ready' && paths.includes(t.file.path)) await nextOrClose(tab, t.file.path);
  return r.ok;
}

/** Closes the tool, asking first when the Output has unsaved changes. */
export async function closeTool(tab: Tab): Promise<void> {
  const t = toolOf(tab);
  if (t?.status === 'ready' && t.file.dirty) {
    const ok = await confirm({ title: 'Discard the unsaved resolution?', body: 'The Output has changes not saved to the file.', confirmLabel: 'Discard' });
    if (!ok) return;
  }
  closeConflict(tab);
}
