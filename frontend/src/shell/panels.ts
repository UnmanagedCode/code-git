import type { ComponentType } from 'react';
import { ACTIVITY_PANEL } from '@/features/activity/panel';
import { COMPARE_PANEL, DIFF_FILES_PANEL, DIFF_PANEL } from '@/features/diff/panel';
import { DETAILS_PANEL, GRAPH_PANEL, REFS_PANEL } from '@/features/graph/panel';
import { WORKDIR_PANEL } from '@/features/workdir/panel';
import { REBASE_PANEL } from '@/features/rebase/panel';
import { CONFLICT_PANEL } from '@/features/conflicts/panel';
import { SUBMODULES_PANEL } from '@/features/submodules/panel';
import { HISTORY_PANEL, REFLOG_PANEL } from '@/features/history/panel';
import type { Tab } from '@/state/tabs';

// The panel registry. A feature defines its panel in its own folder and adds one entry to PANELS.

export type PanelSlot = 'left' | 'center' | 'right' | 'bottom';

export interface PanelDef {
  id: string;
  slot: PanelSlot;
  title: string;
  /** Rendered with the active tab (null when none is open). */
  component: ComponentType<{ tab: Tab | null }>;
  order: number;
  /** Shown only while useShownPanel names it; it then replaces the slot's other panels. */
  onDemand?: boolean;
}

const PANELS: PanelDef[] = [ACTIVITY_PANEL, GRAPH_PANEL, REFS_PANEL, DETAILS_PANEL, COMPARE_PANEL, DIFF_PANEL, DIFF_FILES_PANEL, WORKDIR_PANEL, REBASE_PANEL, CONFLICT_PANEL, SUBMODULES_PANEL, HISTORY_PANEL, REFLOG_PANEL];

export const panelsFor = (slot: PanelSlot): PanelDef[] => PANELS.filter((p) => p.slot === slot).sort((a, b) => a.order - b.order);
