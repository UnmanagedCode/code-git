import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tabKey, type Tab } from '@/state/tabs';
import { cancelEntry, useActivity } from '@/state/useActivity';
import { ActivityEntry } from './ActivityEntry';

/** Every git command code-git ran, newest first; collapsible, filterable to the active tab. */
export function ActivityPanel({ tab }: { tab: Tab | null }) {
  const { entries, error } = useActivity();
  const [expanded, setExpanded] = useState(true);
  const [scope, setScope] = useState<'tab' | 'all'>('all');
  const shown = (scope === 'tab' && tab ? entries.filter((e) => tabKey(e.target) === tabKey(tab)) : entries).slice().reverse();
  const running = entries.filter((e) => e.status === 'running').length;
  return (
    <section className="flex min-h-0 flex-col border-t bg-card" aria-label="Activity">
      <div className="flex items-center gap-2 px-3 py-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
          Activity
        </Button>
        {running > 0 && <span className="text-xs text-info">{running} running</span>}
        {expanded && (
          <div className="ml-auto flex gap-1" role="group" aria-label="Show activity for">
            <Button variant={scope === 'tab' ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={scope === 'tab'} disabled={!tab} onClick={() => setScope('tab')}>This tab</Button>
            <Button variant={scope === 'all' ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All</Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="max-h-[40dvh] min-h-24 overflow-y-auto border-t">
          {error && <p className="px-3 py-2 text-xs text-destructive">{error}</p>}
          {!shown.length && !error && <p className="px-3 py-2 text-xs text-muted-foreground">No git commands yet.</p>}
          <ul>{shown.map((e) => <ActivityEntry key={e.id} entry={e} onCancel={(id) => void cancelEntry(id)} />)}</ul>
        </div>
      )}
    </section>
  );
}
