import type { PanelDef } from '@/shell/panels';
import { WorkdirPanel } from './WorkdirPanel';

export const WORKDIR_PANEL: PanelDef = { id: 'workdir', slot: 'right', title: 'Changes', component: WorkdirPanel, order: 0 };
