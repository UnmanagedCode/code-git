import { runOp, type Target } from '@/lib/endpoints';

// The staging, commit, ignore, restore and patch ops' wire shapes (docs/protocol.md → Staging ops) and runOp wrappers.

export type PathsOrAll = { paths: string[] } | { all: true };
export interface LineSelection { header: string; lines: { index: number; text: string }[] }
export interface SelectionRequest { path: string; context: number | 'full'; hunks: LineSelection[] }
export interface Draft { summary: string; description: string }
export interface CommitParams extends Draft { amend?: boolean; messageOnly?: boolean; noVerify?: boolean }
export interface TemplateResult { path: string | null; draft: Draft | null; problem: string | null }
export type IgnoreKind = 'path' | 'ext' | 'dir';
export type ApplyTarget = 'worktree' | 'index';
export interface PatchFile { path: string; oldPath: string | null; added: number | null; deleted: number | null }

/** Mirrors the backend's STAGE_LIMITS.applyPatchMaxBytes (src/git/stage/limits.js); a test pins them equal. */
export const APPLY_PATCH_MAX_BYTES = 512 * 1024;

export const stageFiles = (t: Target, p: PathsOrAll) => runOp<{ paths: string[] | null }>('stage.files', t, p);
export const unstageFiles = (t: Target, p: PathsOrAll) => runOp<{ paths: string[] | null }>('stage.unstageFiles', t, p);
export const discardFiles = (t: Target, p: { tracked: string[]; untracked: string[] }) =>
  runOp<{ tracked: string[]; untracked: string[] }>('stage.discardFiles', t, p);

export const stageLines = (t: Target, r: SelectionRequest) => runOp<{ path: string }>('stage.stageLines', t, r);
export const unstageLines = (t: Target, r: SelectionRequest) => runOp<{ path: string }>('stage.unstageLines', t, r);
export const discardLines = (t: Target, r: SelectionRequest) => runOp<{ path: string; patchB64: string }>('stage.discardLines', t, r);

export const commitCreate = (t: Target, p: CommitParams) => runOp<{ oid: string }>('commit.create', t, p);
export const commitState = (t: Target) => runOp<{ merging: boolean }>('commit.state', t);
export const headMessage = (t: Target) => runOp<Draft & { oid: string }>('commit.headMessage', t);
export const commitTemplate = (t: Target) => runOp<TemplateResult>('commit.template', t);

export const ignoreAdd = (t: Target, p: { kind: IgnoreKind; value: string; stopTracking?: boolean }) =>
  runOp<{ pattern: string; added: boolean; untracked: string[] }>('ignore.add', t, p);
export const restoreFileOp = (t: Target, oid: string, path: string) => runOp<{ oid: string; path: string }>('files.restore', t, { oid, path });
export const patchCheck = (t: Target, patchB64: string, apply: ApplyTarget) => runOp<{ files: PatchFile[] }>('patch.check', t, { patchB64, apply });
export const patchApply = (t: Target, patchB64: string, apply: ApplyTarget) => runOp<{ apply: ApplyTarget; bytes: number }>('patch.apply', t, { patchB64, apply });
