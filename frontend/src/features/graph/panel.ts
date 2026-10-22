import type { PanelDef } from '@/shell/panels';
import { CommitDetails } from './details/CommitDetails';
import { GraphPanel } from './GraphPanel';
import { RefsPanel } from './RefsPanel';

export const GRAPH_PANEL: PanelDef = { id: 'graph', slot: 'center', title: 'Commit graph', component: GraphPanel, order: 100 };
export const REFS_PANEL: PanelDef = { id: 'graph-refs', slot: 'left', title: 'Refs', component: RefsPanel, order: 100 };
export const DETAILS_PANEL: PanelDef = { id: 'graph-details', slot: 'right', title: 'Details', component: CommitDetails, order: 100 };
