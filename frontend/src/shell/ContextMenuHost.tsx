import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { setCssPx } from '@/lib/cssVars';
import { createStore, useStore } from '@/state/store';
import { ActionMenuItems } from './ActionMenu';
import { actionsFor } from './menus';

// A context menu at the pointer (or a focused element) for any registered context. Each panel mounts one host under
// its own name, so a menu opened from inside a dialog renders inside that dialog.

export interface ContextMenuRequest { host: string; context: string; ctx: unknown; at: { x: number; y: number } }

export const contextMenuStore = createStore<(ContextMenuRequest & { seq: number }) | null>(null);
let seq = 0;

/** Pointers pressed and not yet released, tracked before any React handler sees them (window, capture phase). */
const pressed = new Set<number>();
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => pressed.add(e.pointerId), true);
  window.addEventListener('pointerup', (e) => pressed.delete(e.pointerId), true);
  window.addEventListener('pointercancel', (e) => pressed.delete(e.pointerId), true);
}

/**
 * A menu opened during a press (a right-press, a touch long-press) can be placed under that pointer, and a Radix menu
 * item activates on a pointerup whose pointerdown it did not see: the release would run the item. So the release that
 * ends each press held at opening — and a click it produces — is stopped before it reaches the menu. A menu opened
 * with no press held (keyboard, after a drop) keeps every later click.
 */
function swallowOpeningPress(): void {
  for (const id of pressed) {
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      e.stopPropagation();
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  }
}

/** Opens the context's menu at `at` in host `host`; nothing opens (and false is returned) when no action applies. */
export function openContextMenu(req: ContextMenuRequest): boolean {
  if (!actionsFor(req.context, req.ctx).length) return false;
  swallowOpeningPress();
  contextMenuStore.set({ ...req, seq: ++seq });
  return true;
}
export const closeContextMenu = (): void => contextMenuStore.set(null);

/** Where a keyboard-opened menu goes: below the element's start. */
export const anchorOf = (el: Element): { x: number; y: number } => {
  const r = el.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom };
};

export function ContextMenuHost({ host }: { host: string }) {
  const req = useStore(contextMenuStore);
  const anchor = useRef<HTMLSpanElement>(null);
  const mine = req?.host === host ? req : null;
  // The anchor moves first; the menu opens on the next render, so it is placed from the new position.
  const [shown, setShown] = useState<typeof mine>(null);
  useLayoutEffect(() => {
    if (mine && anchor.current) {
      setCssPx(anchor.current, '--menu-x', mine.at.x);
      setCssPx(anchor.current, '--menu-y', mine.at.y);
    }
    setShown(mine);
  }, [mine]);
  // An action that moves the focus out of the menu (to a summary box, say) loses it to the menu's focus trap and then to
  // the anchor on close: remember where it went, and give it back on close instead.
  const movedTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!shown) return;
    movedTo.current = null;
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t !== anchor.current && !t.closest('[data-slot=dropdown-menu-content]')) movedTo.current = t;
    };
    document.addEventListener('focusin', onFocus, true);
    return () => document.removeEventListener('focusin', onFocus, true);
  }, [shown]);
  return (
    <DropdownMenu open={!!shown} onOpenChange={(open) => { if (!open) closeContextMenu(); }}>
      <DropdownMenuTrigger asChild>
        <span ref={anchor} aria-hidden className="pointer-events-none fixed top-(--menu-y) left-(--menu-x) size-px" />
      </DropdownMenuTrigger>
      {shown && (
        <DropdownMenuContent
          key={shown.seq} align="start" sideOffset={0} data-context={shown.context}
          onCloseAutoFocus={(e) => {
            const t = movedTo.current;
            if (t?.isConnected) { e.preventDefault(); t.focus(); }
          }}
        >
          <ActionMenuItems context={shown.context} ctx={shown.ctx} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
