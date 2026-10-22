import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setCssPx } from '@/lib/cssVars';
import { cn } from '@/lib/utils';
import { toggled, updatePrefs, type GraphPrefs } from '@/state/graphPrefs';
import { CELL_CLASS, clampWidth, COLUMNS, OPTIONAL_COLUMNS, type ColumnId, type OptionalColumnId } from './columns';

/** Columns shown, in order. */
export const shownColumns = (p: GraphPrefs): ColumnId[] => p.columns.order.filter((id) => !COLUMNS[id].optional || p.columns.visible.includes(id as OptionalColumnId));

/** Moves column `id` by `by` places among the shown columns (persisted). */
export function moveColumn(project: string, id: ColumnId, by: number): void {
  updatePrefs(project, (p) => {
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
export const toggleColumn = (project: string, id: OptionalColumnId, on: boolean): void =>
  updatePrefs(project, (p) => ({ ...p, columns: { ...p.columns, visible: toggled(p.columns.visible, id, on) } }));

/** The column checkboxes, for the header menu and the toolbar gear. */
export function ColumnToggles({ project, prefs }: { project: string; prefs: GraphPrefs }) {
  return (
    <>
      {OPTIONAL_COLUMNS.map((id) => (
        <DropdownMenuCheckboxItem key={id} checked={prefs.columns.visible.includes(id)} onSelect={(e) => e.preventDefault()}
          onCheckedChange={(on) => toggleColumn(project, id, on === true)}>
          {COLUMNS[id].label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

/**
 * The column header: drag a cell onto another to reorder, drag its right edge to resize (live through `--col-<id>` on
 * `root`, persisted on release); right-click for Move left / Move right and the column toggles.
 */
export function GraphHeader({ project, prefs, root }: { project: string; prefs: GraphPrefs; root: () => HTMLElement | null }) {
  const shown = shownColumns(prefs);
  const [menu, setMenu] = useState<ColumnId | null>(null);
  const [dragging, setDragging] = useState<ColumnId | null>(null);

  const startResize = (e: ReactPointerEvent, id: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    const el = root();
    const start = prefs.columns.widths[id] ?? COLUMNS[id].width;
    const x0 = e.clientX;
    let w = start;
    const move = (ev: PointerEvent) => {
      w = clampWidth(id, start + ev.clientX - x0);
      if (el) setCssPx(el, `--col-${id}`, w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (w !== start) updatePrefs(project, (p) => ({ ...p, columns: { ...p.columns, widths: { ...p.columns.widths, [id]: w } } }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
      if (to !== -1 && to !== from) moveColumn(project, id, to - from);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-7 shrink-0 items-center border-b bg-muted/40 text-xs font-medium text-muted-foreground" role="row" aria-label="Columns">
      {shown.map((id, i) => (
        <DropdownMenu key={id} open={menu === id} onOpenChange={(o) => setMenu(o ? id : null)}>
          <DropdownMenuTrigger asChild>
            <div
              role="columnheader"
              tabIndex={0}
              data-header-col={id}
              className={cn('relative flex h-full shrink-0 items-center px-2 select-none', CELL_CLASS[id], dragging === id && 'opacity-50')}
              onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); startReorder(e, id); } }}
              onContextMenu={(e) => { e.preventDefault(); setMenu(id); }}
              onKeyDown={(e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setMenu(id); } }}
            >
              <span className="truncate">{COLUMNS[id].label}</span>
              {COLUMNS[id].resizable && (
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${COLUMNS[id].label}`}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-ring/40"
                  onPointerDown={(e) => startResize(e, id)}
                />
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={i === 0} onSelect={() => moveColumn(project, id, -1)}>Move left</DropdownMenuItem>
            <DropdownMenuItem disabled={i === shown.length - 1} onSelect={() => moveColumn(project, id, 1)}>Move right</DropdownMenuItem>
            <DropdownMenuSeparator />
            <ColumnToggles project={project} prefs={prefs} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
