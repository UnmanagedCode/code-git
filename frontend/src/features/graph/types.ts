import type { RepoSummary, Target } from '@/lib/endpoints';

// The graph ops' shapes (docs/protocol.md → Graph ops) and the UI's row and layout model (docs/graph.md).

export interface Ref {
  /** Full refname, e.g. refs/heads/main. */
  name: string;
  kind: 'local' | 'remote' | 'tag';
  short: string;
  remote: string | null;
  /** The commit it names; null when it does not reach a commit. */
  oid: string | null;
  isHead: boolean;
}
export interface Stash { oid: string; parents: string[]; selector: string; time: number; subject: string }
export interface GitWorktree { path: string; head: string | null; branch: string | null; detached: boolean; bare: boolean; locked: boolean }
export interface GraphHead { oid: string | null; branch: string | null; detached: boolean; unborn: boolean }
export interface RefsResult { head: GraphHead; refs: Ref[]; stashes: Stash[]; worktrees: GitWorktree[] | null; worktreesError: string | null }

export interface CommitItem { oid: string; parents: string[]; author: { name: string; email: string }; time: number; subject: string }
export interface PageResult { items: CommitItem[]; nextCursor: number | null }
export interface Stat { files: number; insertions: number; deletions: number }
export interface SearchResult { matches: string[]; truncated: boolean }
export interface CommitFile { status: string; path: string; oldPath: string | null }
export interface Ident { name: string; email: string; time: number }
export interface CommitDetail {
  oid: string;
  parents: string[];
  author: Ident;
  committer: Ident;
  subject: string;
  body: string;
  coAuthors: { name: string; email: string }[];
  signature: { status: string; signer: string | null; key: string | null };
  files: CommitFile[] | null;
  filesError: { code: string; message: string; limitBytes?: number } | null;
}

export type Counts = RepoSummary['counts'];

/** A cc checkout of the project (main or worktree) with what its repo.summary says about HEAD. */
export interface Checkout {
  target: Target;
  /** The project name for the main checkout, else the worktree name. */
  name: string;
  isOwn: boolean;
  /** Full refname of its branch, null when detached or unknown. */
  branch: string | null;
  headOid: string | null;
  counts: Counts | null;
}

/** A commit oid, `wip:<worktree or ''>` or `stash:<oid>`. */
export type RowId = string;
export type GraphRow =
  | { kind: 'commit'; id: RowId; item: CommitItem }
  | { kind: 'wip'; id: RowId; checkout: Checkout }
  | { kind: 'stash'; id: RowId; stash: Stash };

export interface LayoutInput { id: RowId; parents: string[]; dashed: boolean }
/** A line in one half of a row: lane `from` at the half's top to lane `to` at its bottom. */
export interface Edge { from: number; to: number; color: number; dashed: boolean }
export interface LayoutRow { col: number; color: number; top: Edge[]; bottom: Edge[] }
export interface Lane { expect: string; color: number; dashed: boolean }
export interface LayoutState {
  lanes: (Lane | null)[];
  nextColor: number;
  /** Pinned tip oids by lane index; '' once that tip's row has been laid out. */
  reserved: string[];
  /** The widest the layout has been, in lanes. */
  width: number;
}
