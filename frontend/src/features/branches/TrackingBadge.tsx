import { Badge } from '@/components/ui/badge';
import { useTracking } from '@/state/branchTracking';
import type { Tab } from '@/state/tabs';

/** A local branch's ↑ahead ↓behind against its upstream, or "gone" when the upstream ref is missing. */
export function TrackingBadge({ tab, ref: name }: { tab: Tab; ref: string }) {
  const t = useTracking(tab).data?.branches[name];
  if (!t?.upstream) return null;
  if (t.gone) return <Badge variant="warning" title="The upstream branch is gone">gone</Badge>;
  if (!t.ahead && !t.behind) return null;
  const label = [t.ahead ? `${t.ahead} ahead` : '', t.behind ? `${t.behind} behind` : ''].filter(Boolean).join(', ');
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground" aria-label={label} title={label} data-tracking="">
      {t.ahead > 0 && <span>↑{t.ahead}</span>}
      {t.ahead > 0 && t.behind > 0 && ' '}
      {t.behind > 0 && <span>↓{t.behind}</span>}
    </span>
  );
}
