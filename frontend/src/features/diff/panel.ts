import type { PanelDef } from '@/shell/panels';
import { ComparePanel } from './ComparePanel';
import { DiffPanel } from './DiffPanel';
import { DIFF_PANEL_ID } from './openDiff';

export const DIFF_PANEL: PanelDef = { id: DIFF_PANEL_ID, slot: 'center', title: 'Diff', component: DiffPanel, order: 0, onDemand: true };
export const COMPARE_PANEL: PanelDef = { id: 'compare', slot: 'left', title: 'Compare', component: ComparePanel, order: 100 };
