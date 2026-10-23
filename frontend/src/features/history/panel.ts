import type { PanelDef } from '@/shell/panels';
import { HistoryPanel } from './HistoryPanel';
import { HISTORY_PANEL_ID, REFLOG_PANEL_ID } from './open';
import { ReflogPanel } from './ReflogPanel';

export const HISTORY_PANEL: PanelDef = { id: HISTORY_PANEL_ID, slot: 'center', title: 'File history', component: HistoryPanel, order: 0, onDemand: true };
export const REFLOG_PANEL: PanelDef = { id: REFLOG_PANEL_ID, slot: 'center', title: 'Reflog', component: ReflogPanel, order: 0, onDemand: true };
