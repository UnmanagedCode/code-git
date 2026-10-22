import { memo } from 'react';
import { ROW_H } from './windowFor';
import type { Edge, GraphRow, LayoutRow } from './types';

/** Horizontal space per lane, px. */
export const LANE_W = 16;
const PAD = 6;
const MID = ROW_H / 2;
const x = (lane: number) => PAD + LANE_W / 2 + lane * LANE_W;
/** The width the lanes need, px. */
export const lanesWidth = (lanes: number) => PAD * 2 + Math.max(1, lanes) * LANE_W;

function path(e: Edge, y0: number, y1: number): string {
  const a = x(e.from);
  const b = x(e.to);
  if (a === b) return `M ${a} ${y0} L ${b} ${y1}`;
  const m = (y0 + y1) / 2;
  return `M ${a} ${y0} C ${a} ${m} ${b} ${m} ${b} ${y1}`;
}

function EdgePath({ e, half }: { e: Edge; half: 'top' | 'bottom' }) {
  return (
    <path
      d={half === 'top' ? path(e, 0, MID) : path(e, MID, ROW_H)}
      className={`lane-${e.color} fill-none stroke-(--lane)`}
      strokeWidth={2}
      strokeDasharray={e.dashed ? '3 3' : undefined}
      data-edge={half}
      data-from={e.from}
      data-to={e.to}
    />
  );
}

/** One row of the graph column: its edges and its node. Geometry is numeric attributes only. */
export const LaneSvg = memo(function LaneSvg({ row, layout, width, initials }: { row: GraphRow; layout: LayoutRow; width: number; initials: string }) {
  const cx = x(layout.col);
  const lane = `lane-${layout.color}`;
  const merge = row.kind === 'commit' && row.item.parents.length > 1;
  return (
    <svg width={width} height={ROW_H} viewBox={`0 0 ${width} ${ROW_H}`} className="block shrink-0 overflow-hidden" aria-hidden data-col={layout.col}>
      {layout.top.map((e, i) => <EdgePath key={`t${i}`} e={e} half="top" />)}
      {layout.bottom.map((e, i) => <EdgePath key={`b${i}`} e={e} half="bottom" />)}
      {row.kind === 'wip' && <circle cx={cx} cy={MID} r={6} className={`${lane} fill-card stroke-(--lane)`} strokeWidth={2} strokeDasharray="2 2" data-node="wip" />}
      {row.kind === 'stash' && <rect x={cx - 5} y={MID - 5} width={10} height={10} rx={2} className={`${lane} fill-card stroke-(--lane)`} strokeWidth={2} data-node="stash" />}
      {row.kind === 'commit' && merge && <circle cx={cx} cy={MID} r={4} className={`${lane} fill-(--lane)`} data-node="merge" />}
      {row.kind === 'commit' && !merge && (
        <g data-node="commit">
          <circle cx={cx} cy={MID} r={9} className={`${lane} fill-card stroke-(--lane)`} strokeWidth={2} />
          <text x={cx} y={MID} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={600} className="fill-foreground select-none">{initials}</text>
        </g>
      )}
    </svg>
  );
});
