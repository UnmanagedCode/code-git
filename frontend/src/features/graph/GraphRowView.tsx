import { memo, type MouseEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CELL_CLASS, type ColumnId } from './columns';
import type { Label } from './labels';
import { LaneSvg } from './LaneSvg';
import { RefChip, type ChipHandlers } from './RefChip';
import { initials } from './initials';
import { formatTime } from './time';
import type { Through } from './layout';
import type { GraphRow, LayoutRow, Stat } from './types';

/** Chips shown before the rest collapse into "+N". */
export const CHIPS_SHOWN = 2;

export interface RowViewProps {
  row: GraphRow;
  layout: LayoutRow;
  /** Lines passing through this row (passThroughs). */
  through: Through[];
  labels: Label[];
  columns: ColumnId[];
  graphWidth: number;
  selected: boolean;
  focused: boolean;
  matched: boolean;
  dimmed: boolean;
  stat: Stat | null | undefined;
  chips: ChipHandlers;
  onClick: (e: MouseEvent, row: GraphRow) => void;
  onContextMenu: (e: MouseEvent, row: GraphRow) => void;
}

function Changes({ stat }: { stat: Stat | null | undefined }) {
  if (stat === undefined) return null;
  if (stat === null) return <span className="text-xs text-muted-foreground" title="A merge: no stat">merge</span>;
  const total = stat.insertions + stat.deletions;
  const w = 48;
  const ins = total ? Math.round((stat.insertions / total) * w) : 0;
  return (
    <span className="flex items-center gap-1.5 text-xs" title={`${stat.files} files, +${stat.insertions} −${stat.deletions}`}>
      <span className="tabular-nums">{stat.files}</span>
      <svg width={w} height={6} viewBox={`0 0 ${w} 6`} aria-hidden className="shrink-0">
        <rect x={0} y={0} width={ins} height={6} className="fill-success" />
        <rect x={ins} y={0} width={total ? w - ins : 0} height={6} className="fill-destructive" />
      </svg>
    </span>
  );
}

function Chips({ labels, color, chips }: { labels: Label[]; color: number; chips: ChipHandlers }) {
  const shown = labels.slice(0, CHIPS_SHOWN);
  const rest = labels.slice(CHIPS_SHOWN);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((l, i) => <RefChip key={i} label={l} color={color} handlers={chips} />)}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="shrink-0 rounded border px-1 text-xs text-muted-foreground hover:bg-accent" aria-label={`${rest.length} more refs`}
              onClick={(e) => e.stopPropagation()}>
              +{rest.length}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {rest.map((l, i) => (
              <DropdownMenuItem key={i} onContextMenu={(e) => chips.onContextMenu?.(e, l)} onSelect={() => chips.onClick?.(l)}>
                <RefChip label={l} color={color} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}

function Message({ row }: { row: GraphRow }) {
  if (row.kind === 'wip') {
    const c = row.checkout;
    const n = c.counts;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono whitespace-nowrap text-muted-foreground">// WIP</span>
        <span className="max-w-48 shrink-0 truncate font-medium">{c.name}</span>
        {n && (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {n.staged > 0 && <Badge variant="success">{n.staged} staged</Badge>}
            {n.unstaged > 0 && <Badge variant="info">{n.unstaged} unstaged</Badge>}
            {n.untracked > 0 && <Badge variant="secondary">{n.untracked} untracked</Badge>}
            {n.conflicted > 0 && <Badge variant="destructive">{n.conflicted} conflicted</Badge>}
          </span>
        )}
      </span>
    );
  }
  if (row.kind === 'stash') {
    return (
      <span className="truncate italic" title={row.stash.subject}>{row.stash.subject}</span>
    );
  }
  return <span className="truncate" title={row.item.subject}>{row.item.subject}</span>;
}

/** One row of the graph list. Every untrusted string is a React text child or a `title`. */
export const GraphRowView = memo(function GraphRowView(p: RowViewProps) {
  const { row, layout } = p;
  const item = row.kind === 'commit' ? row.item : null;
  const cell = (id: ColumnId) => {
    switch (id) {
      case 'refs': return <Chips labels={p.labels} color={layout.color} chips={p.chips} />;
      case 'graph': return <LaneSvg row={row} layout={layout} through={p.through} width={p.graphWidth} initials={item ? initials(item.author.name, item.author.email) : ''} />;
      case 'message': return <Message row={row} />;
      case 'author':
        return item && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`lane-${layout.color} flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-(--lane) text-xs font-semibold`}>
              {initials(item.author.name, item.author.email)}
            </span>
            <span className="truncate" title={item.author.email}>{item.author.name}</span>
          </span>
        );
      case 'date': return item && <span className="truncate text-muted-foreground">{formatTime(item.time)}</span>;
      case 'sha': return item && <span className="font-mono text-muted-foreground">{item.oid.slice(0, 7)}</span>;
      case 'changes': return item && <Changes stat={p.stat} />;
    }
  };
  return (
    <div
      role="option"
      aria-selected={p.selected}
      data-row-id={row.id}
      data-col={layout.col}
      data-kind={row.kind}
      data-match={p.matched ? '' : undefined}
      data-dimmed={p.dimmed ? '' : undefined}
      data-focused={p.focused ? '' : undefined}
      className={cn(
        'flex h-7 cursor-default items-center text-sm select-none',
        p.selected ? 'bg-accent text-accent-foreground' : p.matched ? 'bg-primary/10' : 'hover:bg-muted/60',
        p.focused && 'outline outline-1 -outline-offset-1 outline-ring',
        p.dimmed && 'opacity-40',
      )}
      onClick={(e) => p.onClick(e, row)}
      onContextMenu={(e) => p.onContextMenu(e, row)}
    >
      {p.columns.map((id) => (
        <div key={id} className={cn('flex h-full shrink-0 items-center overflow-hidden', id !== 'graph' && 'px-2', CELL_CLASS[id])} data-cell={id}>
          {cell(id)}
        </div>
      ))}
    </div>
  );
});
