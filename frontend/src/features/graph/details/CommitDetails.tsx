import { useEffect, useState } from 'react';
import { clip } from '@/lib/clip';
import { CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { runOp } from '@/lib/endpoints';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useGraphData } from '@/state/graph';
import { requestFileOpen, useGraphSelection, type SelectedRow } from '@/state/graphSelection';
import { tabKey, type Tab } from '@/state/tabs';
import { diffOwnerCommit, useOpenDiff } from '@/features/diff/binding';
import { DiffFileList } from '@/features/diff/DiffFileList';
import { FileList, FileViewToggle } from '@/features/diff/FileList';
import { useRightSlot } from '@/features/workdir/rightSlot';
import { openIn, openSelectionDiff, selectionDiff } from '../diffWiring';
import { formatTime } from '../time';
import { initials } from '../initials';
import { requestJump } from '../jump';
import { WIDE_GRAPH_QUERY } from '../media';
import { CONTEXT, type FileCtx } from '../contexts';
import type { CommitDetail, Stash } from '../types';
import { SignatureBadge } from './SignatureBadge';

/** Characters of a commit body shown until "Show the whole message". */
export const BODY_SHOWN = 16_384;
/** Co-authors listed; the rest are counted. */
export const CO_AUTHORS_SHOWN = 50;

/** A commit body as text, the first BODY_SHOWN characters until asked for the rest. */
function Body({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > BODY_SHOWN;
  return (
    <>
      <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground" data-commit-body="">{all || !long ? text : clip(text, BODY_SHOWN)}</p>
      {long && !all && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>Show the whole message ({text.length.toLocaleString()} characters)</Button>
      )}
    </>
  );
}

/**
 * The details panel (right slot; a dialog on narrow screens) for the graph's selection. In the slot it shows only while
 * the slot is the details' (features/workdir/rightSlot.ts).
 */
export function CommitDetails({ tab, inDialog = false }: { tab: Tab | null; inDialog?: boolean }) {
  const wide = useMediaQuery(WIDE_GRAPH_QUERY);
  if (!tab || (!inDialog && !wide)) return null;
  return <DetailsView key={tabKey(tab)} tab={tab} inDialog={inDialog} />;
}

function DetailsView({ tab, inDialog }: { tab: Tab; inDialog: boolean }) {
  const sel = useGraphSelection(tab);
  const data = useGraphData(tab);
  const slot = useRightSlot(tab);
  if (data.status === 'idle' || (!inDialog && slot !== 'details')) return null;
  const only = sel.items.length === 1 ? sel.items[0] : null;
  let body;
  if (sel.items.length > 1) body = <Multi tab={tab} items={sel.items} commits={data.commits} stashes={data.refs?.stashes ?? []} />;
  else if (!only || only.kind === 'wip') body = <p className="text-sm text-muted-foreground">Select a commit</p>;
  else body = <Commit key={only.oid} tab={tab} oid={only.oid} />;
  return (
    <aside className="flex flex-col gap-3 p-3" aria-label="Commit details">
      {body}
    </aside>
  );
}

function Multi({ tab, items, commits, stashes }: {
  tab: Tab; items: SelectedRow[]; commits: { oid: string; subject: string }[]; stashes: Stash[];
}) {
  const subject = (it: SelectedRow) => (it.kind === 'stash' ? stashes.find((s) => s.oid === it.oid)?.subject : it.kind === 'commit' ? commits.find((c) => c.oid === it.oid)?.subject : '') ?? '';
  return (
    <>
      <h2 className="text-sm font-semibold">{items.length} selected</h2>
      {selectionDiff(tab, items) && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => openSelectionDiff(tab)}>View combined diff</Button>
      )}
      <ul className="flex flex-col gap-0.5 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            {it.kind === 'wip' ? <span className="text-muted-foreground">// WIP {clip(it.checkout.worktree ?? it.checkout.project)}</span> : (
              <>
                <span className="font-mono text-xs text-muted-foreground">{it.oid.slice(0, 7)}</span>
                <span className="truncate">{clip(subject(it))}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Person({ label, name, email, time }: { label: string; name: string; email: string; time: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-primary text-xs font-semibold">{initials(clip(name), clip(email))}</span>
      <span className="min-w-0">
        <span className="block truncate"><span className="text-muted-foreground">{label} </span>{clip(name)} <span className="text-muted-foreground">&lt;{clip(email)}&gt;</span></span>
        <span className="block text-xs text-muted-foreground">{formatTime(time)}</span>
      </span>
    </div>
  );
}

function Commit({ tab, oid }: { tab: Tab; oid: string }) {
  const [d, setD] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useOpenDiff(tab);
  const stashes = useGraphData(tab).refs?.stashes ?? [];
  useEffect(() => {
    const ac = new AbortController();
    runOp<CommitDetail>('graph.commit', tab, { oid }, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setD(r); })
      .catch((e) => { if (!ac.signal.aborted && !(e instanceof ApiError && e.code === 'CANCELLED')) setError(e instanceof Error ? e.message : String(e)); });
    return () => ac.abort();
  }, [oid]);
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // The open diff is this commit's (or one of this stash's views): the list shows and drives the diff's files.
  const bound = open && diffOwnerCommit(open, stashes) === d.oid ? open : null;
  const boundParent = bound?.source.kind === 'commit' ? bound.source.parent ?? 1 : 1;
  const sameFiles = !!bound && bound.source.kind === 'commit' && bound.source.rev === d.oid && boundParent === 1;
  const count = bound ? bound.list.result?.files.length ?? (sameFiles ? d.files?.length : undefined) : d.files?.length;
  const parent = d.parents[0] ?? null;
  const sameCommitter = d.committer.name === d.author.name && d.committer.email === d.author.email;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold break-words">{clip(d.subject)}</h2>
        <Button variant="outline" size="sm" className="self-start" onClick={() => openIn(tab, tab, { kind: 'commit', rev: d.oid })}>View changes</Button>
        {d.body && <Body text={d.body} />}
      </div>
      <Person label="Author" name={d.author.name} email={d.author.email} time={d.author.time} />
      {!sameCommitter && <Person label="Committer" name={d.committer.name} email={d.committer.email} time={d.committer.time} />}
      {d.coAuthors.length > 0 && (
        <section aria-label="Co-authors" className="text-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">Co-authors</h3>
          {d.coAuthors.length > CO_AUTHORS_SHOWN && <p className="text-xs text-muted-foreground">and {d.coAuthors.length - CO_AUTHORS_SHOWN} more</p>}
          <ul>{d.coAuthors.slice(0, CO_AUTHORS_SHOWN).map((c, i) => <li key={i}>{clip(c.name)} <span className="text-muted-foreground">&lt;{clip(c.email)}&gt;</span></li>)}</ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs break-all" aria-label="Commit SHA">{d.oid}</span>
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Copy SHA" onClick={() => navigator.clipboard?.writeText(d.oid)}><CopyIcon /></Button>
        <SignatureBadge status={d.signature.status} signer={d.signature.signer} keyId={d.signature.key} />
      </div>
      {d.parents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm" role="group" aria-label="Parents">
          <span className="text-muted-foreground">{d.parents.length > 1 ? 'Parents' : 'Parent'}</span>
          {d.parents.map((p) => (
            <Button key={p} variant="outline" size="sm" className="h-6 px-1.5 font-mono text-xs" aria-label={`Jump to parent ${p.slice(0, 7)}`} onClick={() => requestJump(tab, p)}>{p.slice(0, 7)}</Button>
          ))}
        </div>
      )}
      {boundParent > 1
        ? <p className="text-xs text-muted-foreground">Changes against parent {boundParent}</p>
        : d.parents.length > 1 && <p className="text-xs text-muted-foreground">Changes against the first parent</p>}
      {count !== undefined && (
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">{count} {count === 1 ? 'file' : 'files'}</h3>
          <div className="ml-auto"><FileViewToggle /></div>
        </div>
      )}
      {bound ? <div className="-mx-3"><DiffFileList tab={tab} fallback={sameFiles ? d.files ?? undefined : undefined} /></div> : d.files ? (
        <div className="-mx-3">
          <FileList
            label="Changed files"
            files={d.files}
            onSelect={(_sel, f) => requestFileOpen({ tab, commit: d.oid, parent, path: f.path, oldPath: f.oldPath })}
            menu={(f) => ({ context: CONTEXT.file, ctx: { tab, commit: d.oid, parent, file: f } satisfies FileCtx })}
          />
        </div>
      ) : (
        <p className="text-sm text-destructive" role="alert">
          {d.filesError?.code === 'OUTPUT_TOO_LARGE' ? 'Too many changes to list.' : `The changed files could not be listed: ${d.filesError?.message ?? 'unknown error'}`}
        </p>
      )}
    </>
  );
}
