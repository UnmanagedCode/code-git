import { runOp, type Target } from '@/lib/endpoints';

// The undo ops' wire shapes (docs/protocol.md → Undo ops) and thin runOp wrappers.

/** What an undo or redo asks before it runs (D4): refs it deletes, files it discards again, a hard reset, stashes it drops, a remote it removes. */
export type UndoConfirm =
  | { kind: 'deletesRefs'; refs: string[] }
  | { kind: 'discards'; paths: string[] }
  | { kind: 'resetHard' }
  | { kind: 'dropsStashes'; messages: string[] }
  | { kind: 'deletesRemote'; name: string; refs: string[] };
/** One journal slot: its entry's id (sent back to run it), the op that recorded it, its label, its confirmation. */
export interface UndoSlot { id: number; op: string; label: string; confirm: UndoConfirm | null }
export interface UndoState { undo: UndoSlot | null; redo: UndoSlot | null }
export type UndoDir = 'undo' | 'redo';
export interface UndoResult { entry: UndoSlot; warnings: string[] }

export const loadUndoState = (t: Target) => runOp<UndoState>('undo.state', t);
export const runUndo = (t: Target, dir: UndoDir, id: number, ccOwned?: boolean) =>
  runOp<UndoResult>(dir === 'undo' ? 'undo.undo' : 'undo.redo', t, { id, ...(ccOwned ? { ccOwned: true } : {}) });
