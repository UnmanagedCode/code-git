import type { InteractiveRequest, PlanCommit, RowAction } from '@/features/sequence/api';
import type { Draft } from '@/features/workdir/api';

// The interactive-rebase editor's rows (docs/merge.md → Interactive rebase). Pure. The backend checks the same rules
// (src/git/rebase/todo.js); here they decide what the editor offers and says.

export const ACTIONS: RowAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
export const ACTION_LABEL: Record<RowAction, string> = { pick: 'Pick', reword: 'Reword', edit: 'Edit', squash: 'Squash', fixup: 'Fixup', drop: 'Drop' };
/** The single-key shortcut of each action on a focused row. */
export const ACTION_KEY: Record<string, RowAction> = { p: 'pick', r: 'reword', e: 'edit', s: 'squash', f: 'fixup', d: 'drop' };

/** `rebase`: a branch's own commits; `squash`: the preset that melds a selected run into one; `pick`: cherry-pick N. */
export type EditorMode = 'rebase' | 'squash' | 'pick';
/** `message`: the new message a reword or a squash chain's head was given (null: none yet). */
export interface EditorRow { oid: string; action: RowAction; message: Draft | null }
export interface RebaseSession {
  mode: EditorMode;
  base: string;
  onto: string;
  /** How onto and HEAD's branch are named in the header and the toasts. */
  ontoLabel: string;
  branch: string;
  expect: string;
  commits: Record<string, PlanCommit>;
  rows: EditorRow[];
  original: EditorRow[];
}

const KEEP: ReadonlySet<RowAction> = new Set(['pick', 'reword', 'edit']);

export const setAction = (rows: EditorRow[], i: number, action: RowAction): EditorRow[] => rows.map((r, j) => (j === i ? { ...r, action } : r));
export const setMessage = (rows: EditorRow[], i: number, message: Draft | null): EditorRow[] => rows.map((r, j) => (j === i ? { ...r, message } : r));

/** `rows` with the row at `from` moved to `to` (both clamped). */
export function move(rows: EditorRow[], from: number, to: number): EditorRow[] {
  const t = Math.max(0, Math.min(rows.length - 1, to));
  if (from === t || from < 0 || from >= rows.length) return rows;
  const next = [...rows];
  const [r] = next.splice(from, 1);
  next.splice(t, 0, r);
  return next;
}

export const reset = (s: RebaseSession): RebaseSession => ({ ...s, rows: s.original });
export const edited = (s: RebaseSession): boolean => JSON.stringify(s.rows) !== JSON.stringify(s.original);
export const droppedCount = (rows: EditorRow[]): number => rows.filter((r) => r.action === 'drop').length;

export interface Chain { head: number; members: number[]; squash: boolean; needsMessage: boolean }

/**
 * Each kept row (pick, reword, edit) with the squash / fixup rows below it — drops do not break a chain, git melds into
 * the last kept commit. `orphans`: squash / fixup rows with no kept row above them.
 */
export function chains(rows: EditorRow[]): { chains: Chain[]; orphans: number[] } {
  const out: Chain[] = [];
  const orphans: number[] = [];
  let cur: Chain | null = null;
  rows.forEach((r, i) => {
    if (KEEP.has(r.action)) { cur = { head: i, members: [], squash: false, needsMessage: r.action === 'reword' }; out.push(cur); return; }
    if (r.action !== 'squash' && r.action !== 'fixup') return;
    if (!cur) { orphans.push(i); return; }
    cur.members.push(i);
    if (r.action === 'squash') { cur.squash = true; cur.needsMessage = true; }
  });
  return { chains: out, orphans };
}

const fullMessage = (c: PlanCommit) => (c.description ? `${c.summary}\n\n${c.description}` : c.summary);

/** A squash chain's default message: the head's message, then each squashed commit's (not a fixup's), blank-line separated. */
export function defaultSquashMessage(rows: EditorRow[], commits: Record<string, PlanCommit>, chain: Chain): Draft {
  const head = commits[rows[chain.head].oid];
  const squashed = chain.members.filter((i) => rows[i].action === 'squash').map((i) => fullMessage(commits[rows[i].oid]));
  return { summary: head.summary, description: [head.description, ...squashed].filter(Boolean).join('\n\n') };
}

/** The message row `i` will be committed with when it takes one: its own, else a squash chain's default; null otherwise. */
export function messageOf(s: RebaseSession, i: number): Draft | null {
  const chain = chains(s.rows).chains.find((c) => c.head === i);
  if (!chain?.needsMessage) return null;
  return s.rows[i].message ?? (chain.squash ? defaultSquashMessage(s.rows, s.commits, chain) : null);
}

/** What stops Start, as sentences (row numbers 1-based); [] when the rows can run. */
export function validate(s: RebaseSession): string[] {
  if (!s.rows.length) return ['Nothing to rebase.'];
  if (s.rows.every((r) => r.action === 'drop')) return ['Every commit is dropped: use Reset to move the branch instead.'];
  const { chains: cs, orphans } = chains(s.rows);
  const errors = orphans.map((i) => `Row ${i + 1}: a ${s.rows[i].action} needs a kept commit above it.`);
  for (const c of cs) {
    if (!c.needsMessage) continue;
    const m = messageOf(s, c.head);
    if (!m) errors.push(`Row ${c.head + 1}: give the reworded commit a message.`);
    else if (!m.summary.trim() || /[\r\n]/.test(m.summary)) errors.push(`Row ${c.head + 1}: the message needs a one-line summary.`);
  }
  return errors;
}

/** The rebase.interactive request: squash runs as a rebase; a message only on a row that takes one. */
export function toRequest(s: RebaseSession): InteractiveRequest {
  return {
    mode: s.mode === 'pick' ? 'pick' : 'rebase', base: s.base, onto: s.onto, expect: s.expect,
    rows: s.rows.map((r, i) => {
      const m = messageOf(s, i);
      return { oid: r.oid, action: r.action, ...(m ? { message: { summary: m.summary, description: m.description } } : {}) };
    }),
  };
}

/** The editor's rows for `commits` (oldest first): all pick; the squash preset melds the `selected` run (oldest kept). */
export function presetRows(mode: EditorMode, commits: PlanCommit[], selected: readonly string[] = []): EditorRow[] {
  const sel = new Set(selected);
  const oldest = commits.find((c) => sel.has(c.oid))?.oid;
  return commits.map((c) => ({
    oid: c.oid, message: null,
    action: mode === 'squash' && sel.has(c.oid) && c.oid !== oldest ? 'squash' : 'pick',
  }));
}
