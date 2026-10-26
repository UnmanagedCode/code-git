import { dateMs, MAX_DATE_MS } from './time';
import type { GraphRow, RowId } from './types';

const DAY_S = 86400;
const YEAR_S = 365 * DAY_S;
/** Rungs below a year, by rank (1-based): a rolling age in seconds, or the calendar `yesterday` (before local midnight today). */
const RUNGS: readonly { label: string; seconds: number | 'midnight' }[] = [
  { label: '1 hour ago', seconds: 3600 },
  { label: '3 hours ago', seconds: 3 * 3600 },
  { label: 'yesterday', seconds: 'midnight' },
  { label: 'last week', seconds: 7 * DAY_S },
  { label: 'last month', seconds: 30 * DAY_S },
  { label: '3 months ago', seconds: 90 * DAY_S },
];
/** The rank of `1 year ago`; each further year is one rank more. */
const YEAR_RANK = RUNGS.length + 1;

/** The highest rank a commit time has crossed (0 when none): every rung's crossed set is "all times below a cutoff", so this never rises with t. */
function level(t: number, nowS: number, midnightS: number): number {
  const age = nowS - t;
  const years = Math.floor(age / YEAR_S);
  if (years >= 1) return YEAR_RANK - 1 + years;
  for (let rank = RUNGS.length; rank >= 1; rank--) {
    const { seconds } = RUNGS[rank - 1];
    if (seconds === 'midnight' ? t < midnightS : age >= seconds) return rank;
  }
  return 0;
}

const label = (rank: number): string => {
  if (rank <= RUNGS.length) return RUNGS[rank - 1].label;
  const years = rank - YEAR_RANK + 1;
  return years === 1 ? '1 year ago' : `${years} years ago`;
};

/**
 * The age markers of a graph list, top-down: a commit row maps to the label of the oldest rung its committer time has
 * crossed that no earlier row crossed (several rungs crossed at one gap collapse into the oldest). Each rung appears
 * at most once; WIP and stash rows never carry one nor count as crossing; the first row has no gap above it, so a
 * crossing there is consumed without a marker. A time that is not a representable date is skipped; an invalid `nowMs`
 * gives no markers. A row's state depends only on the rows above it, so appending rows never moves a marker.
 */
export function ageMarkers(rows: readonly GraphRow[], nowMs: number): ReadonlyMap<RowId, string> {
  const markers = new Map<RowId, string>();
  if (!Number.isFinite(nowMs) || nowMs <= 0 || nowMs > MAX_DATE_MS) return markers;
  const nowS = Math.floor(nowMs / 1000);
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  const midnightS = midnight.getTime() / 1000;
  let crossed = 0;
  rows.forEach((row, i) => {
    if (row.kind !== 'commit' || dateMs(row.item.committerTime) === null) return;
    const rank = level(row.item.committerTime, nowS, midnightS);
    if (rank <= crossed) return;
    crossed = rank;
    if (i > 0) markers.set(row.id, label(rank));
  });
  return markers;
}
