import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { matchCombo, type Shortcut } from './shortcuts';

interface SplitterProps {
  orientation: 'horizontal' | 'vertical';
  label: string;
  /** The rendered size (px). */
  value: number;
  /** Finite: aria-valuemin / -valuemax, and the keys' bounds. */
  min: number;
  max: number;
  /** A size for a requested one: the bounds of the moment (drag and keys). */
  clamp: (px: number) => number;
  step: number;
  /** -1: moving toward the end (right, down) shrinks the value, as for a pane on the right. */
  sign: 1 | -1;
  /** combos[0] moves the edge toward the start (↑ / ←), combos[1] toward the end. */
  stepKey: Shortcut;
  /** combos[0] (Home) goes to `min`, combos[1] (End) to `max`. */
  boundKey: Shortcut;
  /** The live write during a drag, and the restore when one is cancelled. */
  preview: (px: number) => void;
  /** Stores a size: on release, and for a key. */
  commit: (px: number) => void;
  className?: string;
}

/**
 * A resize handle: drag, or the catalogue's keys. A drag captures the pointer, so its moves and its end reach this
 * element's own listeners, which unmount with it: an abandoned drag (pointercancel, a lost capture, an unmount) resizes
 * and stores nothing more. A drag previews the size and commits it once on release; a cancelled one previews the old
 * size again. A key commits only a size it actually moves to, so a clamped value keeps the user's stored choice.
 */
export function Splitter({ orientation, label, value, min, max, clamp, step, sign, stepKey, boundKey, preview, commit, className }: SplitterProps) {
  const vertical = orientation === 'vertical';
  // The live drag (its latest size read on release) and the same size as state, for aria-valuenow.
  const drag = useRef<{ pointerId: number; from: number; px: number } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const at = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);
  const end = (e: PointerEvent, save: boolean) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    const { px } = drag.current;
    drag.current = null;
    if (save && px !== value) commit(px);
    else preview(value);
    setDragged(null);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, from: at(e), px: value };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current.px = clamp(value + sign * (at(e) - drag.current.from));
    preview(drag.current.px);
    setDragged(drag.current.px);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const [stepped, bound] = [matchCombo(e, stepKey), matchCombo(e, boundKey)];
    if (!stepped && !bound) return;
    e.preventDefault();
    const next = stepped ? clamp(value + (stepped === stepKey.combos[0] ? -1 : 1) * step * sign) : bound === boundKey.combos[0] ? min : max;
    if (next !== value) commit(next);
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={dragged ?? value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cn(
        'group flex shrink-0 touch-none items-center justify-center outline-none hover:bg-ring/40 focus-visible:bg-ring/40',
        vertical ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onLostPointerCapture={(e) => end(e, false)}
      onKeyDown={onKeyDown}
    >
      <span className={cn('rounded-full bg-border group-hover:bg-ring group-focus-visible:bg-ring', vertical ? 'h-8 w-1' : 'h-1 w-8')} />
    </div>
  );
}
