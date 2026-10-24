import { runOp, type Target } from '@/lib/endpoints';

// The LFS ops' wire shapes (docs/protocol.md → LFS ops, docs/lfs.md) and runOp wrappers.

export interface LfsStatus {
  available: boolean;
  version: string | null;
  supported: boolean;
  /** Whether the System configures the LFS filter (`filter.lfs.process`); null when git-lfs is unusable. */
  filters: boolean | null;
  /** Whether the root .gitattributes could be read: a symlink, directory, binary or oversized one is `unsupported`. */
  attributes: 'ok' | 'unsupported' | null;
  patterns: string[] | null;
}
export interface LfsFile { path: string; size: number | null; oid: string | null; downloaded: boolean | null }

export const lfsStatus = (t: Target) => runOp<LfsStatus>('lfs.status', t, {});
export const lfsFiles = (t: Target) => runOp<{ files: LfsFile[] }>('lfs.files', t, {});
export const lfsTrack = (t: Target, pattern: string) => runOp<{ pattern: string }>('lfs.track', t, { pattern });
export const lfsUntrack = (t: Target, pattern: string) => runOp<{ pattern: string; removed: boolean }>('lfs.untrack', t, { pattern });
export const lfsPull = (t: Target) => runOp<Record<string, never>>('lfs.pull', t, {});
export const lfsPrune = (t: Target) => runOp<Record<string, never>>('lfs.prune', t, {});
