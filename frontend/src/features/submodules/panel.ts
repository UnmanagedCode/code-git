import type { PanelDef } from '@/shell/panels';
import { SubmodulesPanel } from './SubmodulesPanel';

export const SUBMODULES_PANEL: PanelDef = { id: 'submodules', slot: 'left', title: 'Submodules', component: SubmodulesPanel, order: 200 };
