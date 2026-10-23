import { LG_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { useRightSlot } from '@/features/workdir/rightSlot';
import { tabKey, type Tab } from '@/state/tabs';
import { useOpenDiff } from './binding';
import { DiffFileList } from './DiffFileList';
import { FileViewToggle } from './FileList';

/**
 * The right slot's "Changed files": the open diff's file list, while no commit-view list sits beside it (a Compare
 * panel diff, a combined diff, a commit that is not the graph's selection: features/workdir/rightSlot.ts).
 */
export function DiffFilesPanel({ tab }: { tab: Tab | null }) {
  const wide = useMediaQuery(LG_QUERY);
  if (!tab || !wide) return null;
  return <Content key={tabKey(tab)} tab={tab} />;
}

function Content({ tab }: { tab: Tab }) {
  const slot = useRightSlot(tab);
  const diff = useOpenDiff(tab);
  if (slot !== 'diff-files' || !diff) return null;
  const n = diff.list.result?.files.length;
  return (
    <aside aria-label="Changed files panel" className="flex flex-col text-sm">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <h2 className="flex-1 text-sm font-semibold">Changed files</h2>
        {n !== undefined && <span className="text-xs text-muted-foreground">{n} {n === 1 ? 'file' : 'files'}</span>}
        <FileViewToggle />
      </div>
      <DiffFileList tab={tab} />
    </aside>
  );
}
