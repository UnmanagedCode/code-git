import { createElement, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { openContextMenu } from '@/shell/ContextMenuHost';
import { createStore, useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { CONTEXT, type BranchDropCtx, type DragRef } from './contexts';
import type { Ref } from './types';
import { matches } from '@/shell/shortcuts';
import { DRAG_CANCEL_KEY } from './keys';

// Dragging a branch chip onto another opens the 'branch-drop' menu (Merge, Rebase, … registered by later cards).
// Pointer events, not HTML5 drag and drop: only this app's chips can be dragged, no foreign data can be dropped.

/** Movement before a press becomes a drag, in px. */
export const DRAG_THRESHOLD = 4;

export const toDragRef = (r: Ref): DragRef | null =>
  r.kind === 'tag' ? null : { name: r.name, kind: r.kind, short: r.short, remote: r.remote, oid: r.oid };

export interface DragState { source: DragRef; x: number; y: number; over: DragRef | null }
export const dragStore = createStore<DragState | null>(null);

/** Every drop on a target, observable by tests and later cards; the menu opens from it. */
export interface BranchDropEvent extends BranchDropCtx { seq: number; at: { x: number; y: number } }
export const branchDropStore = createStore<BranchDropEvent | null>(null);
let seq = 0;

export function resetDrag(): void {
  dragStore.set(null);
  branchDropStore.set(null);
}

/**
 * Called from a branch chip's pointerdown. `resolve` maps a hovered chip's `data-drop-ref` (a full refname) to its
 * branch; `host` is the ContextMenuHost the drop menu opens in.
 */
export function startBranchDrag(
  e: { button: number; clientX: number; clientY: number },
  { tab, source, host, resolve }: { tab: Tab; source: DragRef; host: string; resolve: (name: string) => DragRef | null },
): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('keydown', key, true);
    dragStore.set(null);
  };
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
    dragging = true;
    const el = ev.target instanceof Element ? ev.target.closest('[data-drop-ref]') : null;
    const ref = el ? resolve(el.getAttribute('data-drop-ref') ?? '') : null;
    dragStore.set({ source, x: ev.clientX, y: ev.clientY, over: ref && ref.name !== source.name ? ref : null });
  };
  const up = (ev: PointerEvent) => {
    const over = dragging ? dragStore.get()?.over ?? null : null;
    end();
    if (!dragging) return;
    // The release would also click the chip under it.
    const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (!over) return;
    const at = { x: ev.clientX, y: ev.clientY };
    branchDropStore.set({ seq: ++seq, tab, source, target: over, at });
    openContextMenu({ host, context: CONTEXT.branchDrop, ctx: { tab, source, target: over } satisfies BranchDropCtx, at });
  };
  const key = (ev: KeyboardEvent) => {
    if (!matches(ev, DRAG_CANCEL_KEY)) return;
    ev.stopPropagation();
    end();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', end);
  window.addEventListener('keydown', key, true);
}

/** Whether the chip of `name` is the current drop target (re-renders only when that changes). */
export function useDropActive(name: string): boolean {
  return useSyncExternalStore(dragStore.subscribe, () => dragStore.get()?.over?.name === name);
}

/** The chip following the pointer while dragging. */
export function DragGhost() {
  const drag = useStore(dragStore);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (drag && el.current) {
      setCssPx(el.current, '--drag-x', drag.x + 12);
      setCssPx(el.current, '--drag-y', drag.y + 8);
    }
  }, [drag]);
  if (!drag) return null;
  return createElement('div', {
    ref: el, 'data-drag-ghost': '', 'aria-hidden': true,
    className: 'pointer-events-none fixed top-(--drag-y) left-(--drag-x) z-50 rounded border bg-popover px-1.5 py-0.5 font-mono text-xs shadow-md',
  }, drag.source.short);
}
