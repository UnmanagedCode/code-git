import { decodeBase64, downloadBytes } from '@/lib/download';
import type { Target } from '@/lib/endpoints';
import { setNotice } from '@/state/diff';
import { createPatch, type DiffFile, type DiffFilesResult, type DiffSource } from './api';

/**
 * The source to make a patch from: the commit or the run of commits itself (so the backend can write a mailbox
 * patch), else the pinned pair the list was made from.
 */
export function patchSource(source: DiffSource, r: DiffFilesResult): DiffSource {
  if (r.commit) return { kind: 'commit', rev: r.commit.oid, ...(source.kind === 'commit' && source.parent ? { parent: source.parent } : {}) };
  if (source.kind === 'commits') return source;
  return { kind: 'pair', ...r.pair };
}

/** Mirrors the backend's DIFF_LIMITS.maxPaths (src/git/diff/limits.js); a test pins them equal. */
export const PATCH_MAX_PATHS = 1000;

/**
 * The `paths` of a patch of `files`: a rename or copy brings its old path too, since git pairs a rename only when both
 * sides are in the pathspec (else the patch adds the new file and never deletes the old one).
 */
export const patchPaths = (files: DiffFile[]): string[] => files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]));

/** Runs a patch request; a failure is shown in the tab's diff header instead of being lost. */
async function withNotice(t: Target, paths: string[] | undefined, f: () => Promise<void>): Promise<void> {
  setNotice(t, null);
  if (paths && paths.length > PATCH_MAX_PATHS) {
    setNotice(t, `Too many files selected for a patch (max ${PATCH_MAX_PATHS} paths); use the whole-diff patch`);
    return;
  }
  try {
    await f();
  } catch (e) {
    setNotice(t, `Could not create the patch: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const downloadPatch = (t: Target, source: DiffSource, paths?: string[]): Promise<void> => withNotice(t, paths, async () => {
  const p = await createPatch(t, source, paths);
  downloadBytes(p.filename, decodeBase64(p.base64));
});

export const copyPatch = (t: Target, source: DiffSource, paths?: string[]): Promise<void> => withNotice(t, paths, async () => {
  const p = await createPatch(t, source, paths);
  await navigator.clipboard.writeText(new TextDecoder().decode(decodeBase64(p.base64)));
});
