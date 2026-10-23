import type { Stash } from '@/features/graph/types';
import { openDiff } from '@/features/diff/openDiff';
import type { Tab } from '@/state/tabs';
import { STASH_VIEWS, stashViewSource, viewsOf, type StashView } from './views';

/** In a stash's diff header, in place of the parent select: which of the stash's parts the diff shows. */
export function StashViewSwitch({ tab, stash, view, path }: { tab: Tab; stash: Stash; view: StashView; path: string | null }) {
  const offered = viewsOf(stash);
  return (
    <div role="radiogroup" aria-label="Stash view" className="flex overflow-hidden rounded-md border text-xs">
      {STASH_VIEWS.filter((v) => offered.includes(v.view)).map((v) => (
        <label
          key={v.view}
          className="cursor-pointer border-r px-2 py-1 last:border-r-0 has-[:checked]:bg-accent has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset"
        >
          <input
            type="radio"
            name={`stash-view-${stash.oid}`}
            className="sr-only"
            checked={view === v.view}
            onChange={() => openDiff(tab, stashViewSource(stash, v.view), path ? { path } : {})}
          />
          {v.label}
        </label>
      ))}
    </div>
  );
}
