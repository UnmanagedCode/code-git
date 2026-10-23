import type { PanelDef } from '@/shell/panels';
import { REBASE_PANEL_ID } from './open';
import { RebaseEditor } from './RebaseEditor';

export const REBASE_PANEL: PanelDef = { id: REBASE_PANEL_ID, slot: 'center', title: 'Interactive rebase', component: RebaseEditor, order: 0, onDemand: true };
