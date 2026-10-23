import type { PanelDef } from '@/shell/panels';
import { ConflictTool } from './ConflictTool';
import { CONFLICT_PANEL_ID } from './open';

export const CONFLICT_PANEL: PanelDef = { id: CONFLICT_PANEL_ID, slot: 'center', title: 'Merge tool', component: ConflictTool, order: 0, onDemand: true };
