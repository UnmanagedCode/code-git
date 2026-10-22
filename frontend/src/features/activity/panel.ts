import type { PanelDef } from '@/shell/panels';
import { ActivityPanel } from './ActivityPanel';

export const ACTIVITY_PANEL: PanelDef = { id: 'activity', slot: 'bottom', title: 'Activity', component: ActivityPanel, order: 100 };
