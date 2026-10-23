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

/**
 * A menu opened during a press (a right-press, a touch long-press) can be placed under that pointer, and a Radix menu
 * item activates on a pointerup whose pointerdown it did not see: the release would run the item. So the release that
 * ends each press held at opening — and the click it may produce — is stopped (window, capture phase) before it reaches
 * the menu. A menu opened with no press held (keyboard, after a drop) keeps every later click.
 *
 * Disarming never waits on a timer: a release lost outside the window, a release that produces no click, or a
 * compatibility click queued late (touch) must not eat a later, real click. A new press, a key, the window losing
 * focus or the page being hidden ends whatever is armed.
 */
/** Pointers pressed and not yet released. */
const pressed = new Set<number>();
/** Pointers whose next release is swallowed: pressed when a menu opened. */
const armedReleases = new Set<number>();
/** A swallowed release armed this: the click it may produce is swallowed too. */
let armedClick = false;

function disarm(): void {
  armedReleases.clear();
  armedClick = false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    // A new press: any release still armed was lost, and its click will not come.
    disarm();
    pressed.add(e.pointerId);
  }, true);
  window.addEventListener('pointerup', (e) => {
    pressed.delete(e.pointerId);
    if (!armedReleases.delete(e.pointerId)) return;
    e.stopPropagation();
    armedClick = true;
  }, true);
  window.addEventListener('pointercancel', (e) => {
    pressed.delete(e.pointerId);
    armedReleases.delete(e.pointerId);
  }, true);
  window.addEventListener('click', (e) => {
    if (!armedClick) return;
    armedClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  // Enter or Space on an item clicks it: a key always means the user's own choice.
  window.addEventListener('keydown', () => { armedClick = false; }, true);
  const lost = () => { pressed.clear(); disarm(); };
  window.addEventListener('blur', lost);
  document.addEventListener('visibilitychange', lost);
}

/** Arms the swallow for every press held now (see above). */
function swallowOpeningPress(): void {
  for (const id of pressed) armedReleases.add(id);
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
