import type { ComponentType } from 'react';
import { ACTIVITY_PANEL } from '@/features/activity/panel';
import { GRAPH_PLACEHOLDER } from '@/features/repo/GraphPlaceholder';
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
}

const PANELS: PanelDef[] = [ACTIVITY_PANEL, GRAPH_PLACEHOLDER];

export const panelsFor = (slot: PanelSlot): PanelDef[] => PANELS.filter((p) => p.slot === slot).sort((a, b) => a.order - b.order);
