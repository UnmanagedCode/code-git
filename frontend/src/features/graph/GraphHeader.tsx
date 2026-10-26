import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setCssPx } from '@/lib/cssVars';
import { cn } from '@/lib/utils';
import { toggled, updatePrefs, type GraphPrefs } from '@/state/graphPrefs';
import { CELL_CLASS, clampWidth, COLUMN_RESIZE_STEP, COLUMNS, OPTIONAL_COLUMNS, type ColumnId, type OptionalColumnId } from './columns';
import { matches } from '@/shell/shortcuts';
import { Splitter } from '@/shell/Splitter';
import { COLUMN_MENU_KEY, GRAPH_COLUMN_WIDTH_BOUND_KEY, GRAPH_COLUMN_WIDTH_STEP_KEY } from './keys';

/** Columns shown, in order. */
export const shownColumns = (p: GraphPrefs): ColumnId[] => p.columns.order.filter((id) => !COLUMNS[id].optional || p.columns.visible.includes(id as OptionalColumnId));

/** A column's rendered width: the stored one, else its default (the Graph column fits its lanes: `graphWidth`). */
export const columnWidth = (p: GraphPrefs, id: ColumnId, graphWidth: number): number =>
  id === 'graph' ? graphWidth : p.columns.widths[id] ?? COLUMNS[id].width;

/** Moves column `id` by `by` places among the shown columns (persisted). */
export function moveColumn(prefsKey: string, id: ColumnId, by: number): void {
  updatePrefs(prefsKey, (p) => {
    const shown = shownColumns(p);
    const at = shown.indexOf(id);
    const to = at + by;
    if (at === -1 || to < 0 || to >= shown.length) return p;
    const target = shown[to];
    const order = p.columns.order.filter((x) => x !== id);
    order.splice(order.indexOf(target) + (by > 0 ? 1 : 0), 0, id);
    return { ...p, columns: { ...p.columns, order } };
  });
}
export const toggleColumn = (prefsKey: string, id: OptionalColumnId, on: boolean): void =>
  updatePrefs(prefsKey, (p) => ({ ...p, columns: { ...p.columns, visible: toggled(p.columns.visible, id, on) } }));

/** The column checkboxes, for the header menu and the toolbar gear. */
export function ColumnToggles({ prefsKey, prefs }: { prefsKey: string; prefs: GraphPrefs }) {
  return (
    <>
      {OPTIONAL_COLUMNS.map((id) => (
        <DropdownMenuCheckboxItem key={id} checked={prefs.columns.visible.includes(id)} onSelect={(e) => e.preventDefault()}
          onCheckedChange={(on) => toggleColumn(prefsKey, id, on === true)}>
          {COLUMNS[id].label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

/**
 * The column header: drag a cell onto another to reorder; right-click for Move left / Move right and the column toggles.
 * Each resizable column's right edge is a `Splitter` (drag, or ←/→ Home/End when focused; live through `--col-<id>` on
 * `root`, persisted on release). The handle is a sibling of the menu trigger, never inside it: its pointer and key events
 * must not reach the trigger's reorder, menu keys or Radix's open keys (stopping propagation would also starve the shell's
 * window-level shortcuts).
 */
export function GraphHeader({ prefsKey, prefs, root, graphWidth }: { prefsKey: string; prefs: GraphPrefs; root: () => HTMLElement | null; graphWidth: number }) {
  const shown = shownColumns(prefs);
  const [menu, setMenu] = useState<ColumnId | null>(null);
  const [dragging, setDragging] = useState<ColumnId | null>(null);

  const startReorder = (e: ReactPointerEvent, id: ColumnId) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientX - x0) >= 4) { active = true; setDragging(id); }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      if (!active) return;
      const over = ev.target instanceof Element ? ev.target.closest('[data-header-col]')?.getAttribute('data-header-col') : null;
      const to = over ? shown.indexOf(over as ColumnId) : -1;
      const from = shown.indexOf(id);
      if (to !== -1 && to !== from) moveColumn(prefsKey, id, to - from);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-7 shrink-0 items-center border-b bg-muted/40 text-xs font-medium text-muted-foreground" role="row" aria-label="Columns">
      {shown.map((id, i) => (
        <DropdownMenu key={id} open={menu === id} onOpenChange={(o) => setMenu(o ? id : null)}>
          <div
            role="columnheader"
            data-header-col={id}
            className={cn('relative flex h-full shrink-0', CELL_CLASS[id], dragging === id && 'opacity-50')}
            onContextMenu={(e) => { e.preventDefault(); setMenu(id); }}
          >
            <DropdownMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                className="flex h-full min-w-0 flex-1 items-center px-2 select-none"
                onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); startReorder(e, id); } }}
                onKeyDown={(e) => { if (matches(e, COLUMN_MENU_KEY)) { e.preventDefault(); setMenu(id); } }}
              >
                <span className="truncate">{COLUMNS[id].label}</span>
              </div>
            </DropdownMenuTrigger>
            {COLUMNS[id].resizable && (
              <Splitter
                orientation="vertical"
                label={`Resize ${COLUMNS[id].label}`}
                value={columnWidth(prefs, id, graphWidth)}
                min={COLUMNS[id].min}
                max={COLUMNS[id].max}
                clamp={(px) => clampWidth(id, px)}
                step={COLUMN_RESIZE_STEP}
                sign={1}
                stepKey={GRAPH_COLUMN_WIDTH_STEP_KEY}
                boundKey={GRAPH_COLUMN_WIDTH_BOUND_KEY}
                preview={(px) => { const el = root(); if (el) setCssPx(el, `--col-${id}`, px); }}
                commit={(px) => updatePrefs(prefsKey, (p) => ({ ...p, columns: { ...p.columns, widths: { ...p.columns.widths, [id]: px } } }))}
                grip={false}
                className="absolute top-0 right-0 h-full"
              />
            )}
          </div>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={i === 0} onSelect={() => moveColumn(prefsKey, id, -1)}>Move left</DropdownMenuItem>
            <DropdownMenuItem disabled={i === shown.length - 1} onSelect={() => moveColumn(prefsKey, id, 1)}>Move right</DropdownMenuItem>
            <DropdownMenuSeparator />
            <ColumnToggles prefsKey={prefsKey} prefs={prefs} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
