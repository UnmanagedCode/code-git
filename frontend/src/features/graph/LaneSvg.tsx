import { memo } from 'react';
import { ROW_H } from './windowFor';
import { drawnLane, LANE_CAP, type Through } from './layout';
import type { Edge, GraphRow, LayoutRow } from './types';

/** Horizontal space per lane, px. */
export const LANE_W = 16;
const PAD = 6;
const MID = ROW_H / 2;
/** A lane's centre; every lane past LANE_CAP is drawn in the gutter at LANE_CAP. */
export const laneX = (lane: number) => PAD + LANE_W / 2 + drawnLane(lane) * LANE_W;
const x = laneX;
/** The width the lanes need, px: at most LANE_CAP lanes plus the gutter. */
export const lanesWidth = (lanes: number) => PAD * 2 + Math.min(Math.max(1, lanes), LANE_CAP + 1) * LANE_W;

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

/**
 * One row of the graph column: its node's edges, the lines passing through it and its node. Geometry is numeric
 * attributes only; at most LANE_CAP + 1 drawn lanes, so the paths per row are bounded whatever the number of refs.
 */
export const LaneSvg = memo(function LaneSvg({ row, layout, through, width, initials }: {
  row: GraphRow; layout: LayoutRow; through: Through[]; width: number; initials: string;
}) {
  const cx = x(layout.col);
  const lane = `lane-${layout.color}`;
  const merge = row.kind === 'commit' && row.item.parents.length > 1;
  return (
    <svg width={width} height={ROW_H} viewBox={`0 0 ${width} ${ROW_H}`} className="block shrink-0 overflow-hidden" aria-hidden data-col={layout.col}
      data-overflow={layout.col >= LANE_CAP ? '' : undefined}>
      {through.map((t) => (
        <path key={`p${t.lane}`} d={`M ${x(t.lane)} 0 L ${x(t.lane)} ${ROW_H}`} className={`lane-${t.color} fill-none stroke-(--lane)`} strokeWidth={2}
          strokeDasharray={t.dashed ? '3 3' : undefined} data-edge="through" data-from={t.lane} data-to={t.lane} />
      ))}
      {layout.in.map((e, i) => <EdgePath key={`t${i}`} e={e} half="top" />)}
      {layout.out.map((e, i) => <EdgePath key={`b${i}`} e={e} half="bottom" />)}
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
