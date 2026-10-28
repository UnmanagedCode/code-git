import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { clip } from '@/lib/clip';
import { prefsStore, whitespaceFor } from '@/state/diff';
import { useGraphData } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import type { DiffFileCtx } from '@/features/diff/actions';
import { listDiffFiles, type DiffFilesResult, type DiffSource } from '@/features/diff/api';
import { diffOwnerPair, samePair, useOpenDiff } from '@/features/diff/binding';
import { sourceLabel } from '@/features/diff/DiffHeader';
import { DiffFileList } from '@/features/diff/DiffFileList';
import { FileList } from '@/features/diff/FileList';
import { patchSource } from '@/features/diff/patch';
import { openIn } from '../diffWiring';
import { requestJump } from '../jump';
import { DetailsFrame, FilesError, LIST_FAILED } from './DetailsFrame';

/**
 * Two selected commits: their diff's files (the `commits` source, ends as the backend resolves them; docs/protocol.md →
 * Diff sources), listed at once. A file opens that diff there, and the list then drives it, as a commit's does.
 * `oids` in graph order, newest first.
 */
export function PairDetails({ tab, oids, inDialog, available }: { tab: Tab; oids: string[]; inDialog: boolean; available: number }) {
  const [result, setResult] = useState<DiffFilesResult | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const open = useOpenDiff(tab);
  const commits = useGraphData(tab).commits;
  const source: DiffSource = { kind: 'commits', oids };
  // The single commit's list ignores whitespace too (graph.commit): Ignore whitespace applies once the diff opens.
  useEffect(() => {
    const ac = new AbortController();
    listDiffFiles(tab, source, 'none', { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setResult(r); })
      .catch((e) => {
        if (ac.signal.aborted || (e instanceof ApiError && e.code === 'CANCELLED')) return;
        setError({ code: e instanceof ApiError ? e.code : undefined, message: e instanceof Error ? e.message : String(e) });
      });
    return () => ac.abort();
  }, [oids.join()]);
  // The open diff is this pair's: the list shows and drives the diff's files.
  const bound = open && samePair(diffOwnerPair(open), oids) ? open : null;
  const listFailed = !!bound?.list.error;
  const shown = bound?.list.result ?? result;
  const count = listFailed ? undefined : shown?.files.length;
  const subject = (oid: string) => commits.find((c) => c.oid === oid)?.subject ?? '';
  const header = (
    <>
      <h2 className="text-sm font-semibold">{oids.length} commits</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {oids.map((o) => (
          <li key={o} className="flex min-w-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-6 shrink-0 px-1.5 font-mono text-xs" aria-label={`Jump to commit ${o.slice(0, 7)}`} onClick={() => requestJump(tab, o)}>{o.slice(0, 7)}</Button>
            <span className="truncate">{clip(subject(o))}</span>
          </li>
        ))}
      </ul>
      {shown && <p className="font-mono text-xs break-all text-muted-foreground">{sourceLabel(source, shown)}</p>}
    </>
  );
  return (
    <DetailsFrame label="Selected commits" header={header} inDialog={inDialog} available={available} count={count}>
      {listFailed ? <p className="px-3 py-2 text-xs text-muted-foreground">{LIST_FAILED}</p>
        : bound ? <DiffFileList tab={tab} fallback={result?.files} />
        : error ? <FilesError code={error.code} message={error.message} />
        : !result ? <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p> : (
          <FileList
            label="Changed files"
            files={result.files}
            // The pane's answer is the diff's list unless Ignore whitespace asks the diff for another.
            onSelect={(_sel, f) => openIn(tab, tab, source, { path: f.path, preloaded: whitespaceFor(prefsStore.get()) === 'none' ? result : undefined })}
            menu={(_f, targets) => ({ context: 'diff-file', ctx: { tab, files: targets, source: patchSource(source, result) } satisfies DiffFileCtx })}
          />
        )}
    </DetailsFrame>
  );
}
