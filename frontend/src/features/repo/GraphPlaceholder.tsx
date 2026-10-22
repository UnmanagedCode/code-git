import { GitGraphIcon } from 'lucide-react';
import type { PanelDef } from '@/shell/panels';

function GraphPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <GitGraphIcon className="size-8" />
      <p className="text-sm">The commit graph is coming in a later release.</p>
    </div>
  );
}

export const GRAPH_PLACEHOLDER: PanelDef = { id: 'graph-placeholder', slot: 'center', title: 'Commit graph', component: GraphPlaceholder, order: 100 };
