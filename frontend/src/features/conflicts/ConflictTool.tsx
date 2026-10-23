import { useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chunked, LineNo } from '@/features/diff/CodeLine';
import { clip } from '@/lib/clip';
import { confirm } from '@/lib/confirm';
import { cn } from '@/lib/utils';
import { graphStore } from '@/state/graph';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import { splitLines } from './diff3';
import { closeTool, markResolved, saveConflict, takeSide } from './flows';
import { labelsFor, openConflict } from './open';
import { applyEdit, conflictsOf, nextBlock, prevBlock, setPick, unresolved, type Picks, type SideLabels } from './output';
import { updateFile, useTool, type NotText, type ToolFile } from './state';

type Side = 'ours' | 'theirs';
const SIDE_NAME: Record<Side, 'current' | 'incoming'> = { ours: 'current', theirs: 'incoming' };
const abbrev = (oid: string | undefined) => oid?.slice(0, 7) ?? '—';

const NOTICE: Record<NotText, string> = {
  binary: 'Binary file: the merge tool cannot show it. Take a side, or resolve it outside and mark it resolved.',
  large: 'Larger than the merge tool shows (512 KiB a side). Take a side, or resolve it outside and mark it resolved.',
  notUtf8: 'Not UTF-8 text: the merge tool cannot edit it. Take a side, or resolve it outside and mark it resolved.',
  tooDifferent: 'Too different to merge line by line. Take a side, or resolve it outside and mark it resolved.',
  symlink: 'A symbolic link on either side: take the link to keep.',
  submodule: 'A submodule pointer: take the commit to keep (its own checkout is not changed).',
  oneSided: 'Modified on one side, deleted on the other: take the side to keep (taking the side that deleted it deletes the file).',
  none: 'Deleted on both sides: mark it resolved to stage the deletion.',
};

interface PaneRow { id: string; kind: 'line' | 'header'; line: number; text: string; conflict: number | null; within: number }

/** A side file's rows: every line, and a header before each conflict's lines on that side (also for an empty side). */
function paneRows(text: string, f: ToolFile, side: Side): PaneRow[] {
  const lines = splitLines(text);
  const conflicts = conflictsOf(f.regions ?? []);
  const range = (i: number) => (side === 'ours' ? conflicts[i].oursRange : conflicts[i].theirsRange);
  const rows: PaneRow[] = [];
  const headerAt = new Map<number, number[]>();
  conflicts.forEach((_, i) => headerAt.set(range(i).start, [...(headerAt.get(range(i).start) ?? []), i]));
  const conflictOf = (l: number) => conflicts.findIndex((_, i) => l >= range(i).start && l < range(i).end);
  for (let l = 0; l <= lines.length; l++) {
    for (const i of headerAt.get(l) ?? []) rows.push({ id: `h${i}`, kind: 'header', line: l, text: '', conflict: i, within: -1 });
    if (l === lines.length) break;
    const c = conflictOf(l);
    rows.push({ id: `l${l}`, kind: 'line', line: l, text: lines[l].replace(/\r?\n$/, ''), conflict: c === -1 ? null : c, within: c === -1 ? -1 : l - range(c).start });
  }
  return rows;
}

function SidePane({ f, side, label, onPick, paneRef }: { f: ToolFile; side: Side; label: string; onPick: (i: number, picks: Picks) => void; paneRef: (el: HTMLDivElement | null) => void }) {
  const name = SIDE_NAME[side];
  const conflicts = conflictsOf(f.regions ?? []);
  const picksOf = (i: number) => f.out.blocks[i]?.picks ?? { ours: [], theirs: [] };
  const toggleLine = (i: number, within: number, on: boolean) => {
    const p = picksOf(i);
    onPick(i, { ...p, [side]: on ? [...p[side], within] : p[side].filter((x) => x !== within) });
  };
  const toggleAll = (i: number, on: boolean) => {
    const n = (side === 'ours' ? conflicts[i].ours : conflicts[i].theirs).length;
    onPick(i, { ...picksOf(i), [side]: on ? Array.from({ length: n }, (_, k) => k) : [] });
  };
  const render = (r: PaneRow): ReactNode => {
    if (r.kind === 'header') {
      const n = (side === 'ours' ? conflicts[r.conflict!].ours : conflicts[r.conflict!].theirs).length;
      const all = n > 0 && picksOf(r.conflict!)[side].length === n;
      return (
        <label key={r.id} data-conflict={r.conflict} className="flex items-center gap-2 border-y bg-warning/15 px-2 py-0.5 font-sans text-xs text-warning">
          <input type="checkbox" checked={all} disabled={!n || f.busy} aria-label={`Take conflict ${r.conflict! + 1} from ${name}`} onChange={(e) => toggleAll(r.conflict!, e.target.checked)} />
          Conflict {r.conflict! + 1}{n ? '' : ` — nothing on the ${name} side`}
        </label>
      );
    }
    const inConflict = r.conflict !== null;
    return (
      <div key={r.id} className={cn('flex items-start gap-1 px-1', inConflict && 'bg-warning/10')}>
        {inConflict ? (
          <input
            type="checkbox" className="mt-1" disabled={f.busy} aria-label={`Take line ${r.line + 1} from ${name}`}
            checked={picksOf(r.conflict!)[side].includes(r.within)} onChange={(e) => toggleLine(r.conflict!, r.within, e.target.checked)}
          />
        ) : <span className="w-3.5 shrink-0" />}
        <LineNo no={r.line + 1} />
        <span className="min-w-0 flex-1 whitespace-pre">{r.text}</span>
      </div>
    );
  };
  return (
    <section aria-label={`${name === 'current' ? 'Current' : 'Incoming'}: ${label}`} className="flex min-h-0 min-w-0 flex-col border-b lg:border-r">
      <h3 className="truncate border-b px-2 py-1 text-xs font-semibold" title={clip(label)}>{name === 'current' ? 'Current' : 'Incoming'} · {clip(label)}</h3>
      <div ref={paneRef} className="max-h-72 min-h-24 overflow-auto font-mono text-xs lg:max-h-none lg:flex-1">
        <Chunked rows={paneRows(f.sides![side], f, side)} render={render} />
      </div>
    </section>
  );
}

function Notice({ tab, f, labels }: { tab: Tab; f: ToolFile; labels: SideLabels }) {
  const kind = f.notText!;
  const target = (b64: string | null | undefined) => (b64 ? new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))) : '—');
  return (
    <div role="note" className="m-3 flex flex-col gap-2 rounded-md border bg-card p-3 text-sm">
      <p>{NOTICE[kind]}</p>
      {kind === 'symlink' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs">
          <dt>{clip(labels.current)}</dt><dd className="break-all">{clip(target(f.read.ours?.b64))}</dd>
          <dt>{clip(labels.incoming)}</dt><dd className="break-all">{clip(target(f.read.theirs?.b64))}</dd>
        </dl>
      )}
      {kind === 'submodule' && (
        <p className="font-mono text-xs">{abbrev(f.read.ours?.oid)} (current) · {abbrev(f.read.theirs?.oid)} (incoming)</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {kind !== 'none' && (
          <>
            <Button size="sm" variant="outline" disabled={f.busy} onClick={() => void takeSide(tab, [f.path], 'ours')}>Take current ({clip(labels.current, 60)})</Button>
            <Button size="sm" variant="outline" disabled={f.busy} onClick={() => void takeSide(tab, [f.path], 'theirs')}>Take incoming ({clip(labels.incoming, 60)})</Button>
          </>
        )}
        <Button size="sm" disabled={f.busy} onClick={() => void markResolved(tab, f.path)}>Mark resolved</Button>
      </div>
    </div>
  );
}

/**
 * The three-pane conflict tool (docs/merge.md → The conflict tool), shown in the graph's place: Current and Incoming
 * with each conflict's lines to pick, and the whole result in Output, editable. Alt+↑/↓ move between conflicts,
 * Ctrl/⌘+S saves to the worktree file, Mark resolved stages it.
 */
export function ConflictTool({ tab }: { tab: Tab | null }) {
  const state = useTool(tab);
  useStore(workdirStore);
  useStore(graphStore);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const panes = useRef<(HTMLDivElement | null)[]>([null, null]);
  if (!tab) return null;
  if (state?.status !== 'ready') {
    return (
      <section aria-label="Merge tool" className="flex flex-col gap-2 p-3 text-sm">
        {state?.status === 'error' ? <p role="alert" className="break-words text-destructive">{clip(state.message)}</p> : <p className="text-muted-foreground">Loading {clip(state?.path ?? '')}…</p>}
        <Button variant="outline" size="sm" className="self-start" onClick={() => void closeTool(tab)}>Close</Button>
      </section>
    );
  }
  const f = state.file;
  const labels = labelsFor(tab);
  const conflicts = conflictsOf(f.regions ?? []);
  const files = workdirOf(tab).conflicts.map((c) => c.path);
  const fileIndex = files.indexOf(f.path);
  const go = (i: number | null) => {
    if (i === null) return;
    updateFile(tab, (x) => ({ ...x, current: i }));
    for (const p of panes.current) p?.querySelector(`[data-conflict="${i}"]`)?.scrollIntoView?.({ block: 'center' });
    const b = f.out.blocks[i];
    const ta = outputRef.current;
    if (b && ta) { ta.focus(); ta.setSelectionRange(b.start, b.start); }
  };
  const switchFile = async (path: string | undefined) => {
    if (!path) return;
    if (f.dirty && !(await confirm({ title: 'Discard the unsaved resolution?', body: 'The Output has changes not saved to the file.', confirmLabel: 'Discard' }))) return;
    await openConflict(tab, path);
  };
  const onPick = (i: number, picks: Picks) => updateFile(tab, (x) => ({ ...x, out: setPick(x.out, conflictsOf(x.regions ?? []), labels, i, picks), dirty: true, current: i }));
  const onOutput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    updateFile(tab, (x) => ({ ...x, out: { text, blocks: applyEdit(x.out.blocks, x.out.text, text) }, dirty: true }));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && conflicts.length) {
      e.preventDefault();
      go(e.key === 'ArrowUp' ? prevBlock(f.out.blocks, f.current) : nextBlock(f.out.blocks, f.current));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !f.notText) {
      e.preventDefault();
      if (!f.busy) void saveConflict(tab);
    }
  };
  const left = unresolved(f.out.blocks).length;
  return (
    <section aria-label="Merge tool" className="flex min-h-0 flex-col text-sm" onKeyDown={onKey}>
      <header className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <h2 className="min-w-40 flex-1 truncate font-mono text-sm font-semibold" title={clip(f.path)}>{clip(f.path)}</h2>
        {files.length > 1 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous conflicted file" disabled={fileIndex <= 0 || f.busy} onClick={() => void switchFile(files[fileIndex - 1])}><ChevronLeftIcon /></Button>
            File {fileIndex + 1} of {files.length}
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next conflicted file" disabled={fileIndex === -1 || fileIndex >= files.length - 1 || f.busy} onClick={() => void switchFile(files[fileIndex + 1])}><ChevronRightIcon /></Button>
          </span>
        )}
        {!f.notText && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous conflict" disabled={!conflicts.length || f.current <= 0} onClick={() => go(prevBlock(f.out.blocks, f.current))}><ArrowUpIcon /></Button>
            <span aria-live="polite">{conflicts.length ? `Conflict ${Math.min(f.current, conflicts.length - 1) + 1} of ${conflicts.length}${left ? ` · ${left} unresolved` : ''}` : 'No conflicting lines'}</span>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next conflict" disabled={!conflicts.length || f.current >= conflicts.length - 1} onClick={() => go(nextBlock(f.out.blocks, f.current))}><ArrowDownIcon /></Button>
          </span>
        )}
        {!f.notText && <Button variant="outline" size="sm" disabled={f.busy || !f.dirty} onClick={() => void saveConflict(tab)}>Save</Button>}
        {!f.notText && <Button size="sm" disabled={f.busy} onClick={() => void markResolved(tab, f.path)}>Mark resolved</Button>}
        <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Close merge tool" disabled={f.busy} onClick={() => void closeTool(tab)}><XIcon /></Button>
      </header>
      {f.error && <p role="alert" className="border-b px-3 py-1.5 text-xs break-words text-destructive">{clip(f.error)}</p>}
      {f.notText ? <Notice tab={tab} f={f} labels={labels} /> : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 grid-cols-1 lg:flex-1 lg:grid-cols-2">
            {(['ours', 'theirs'] as Side[]).map((side, k) => (
              <SidePane key={side} f={f} side={side} label={side === 'ours' ? labels.current : labels.incoming} onPick={onPick} paneRef={(el) => { panes.current[k] = el; }} />
            ))}
          </div>
          <label className="flex min-h-0 flex-col lg:flex-1">
            <span className="border-b px-2 py-1 text-xs font-semibold">Output</span>
            <textarea
              ref={outputRef} aria-label="Output" wrap="off" spellCheck={false} disabled={f.busy}
              className="min-h-48 flex-1 resize-none bg-transparent p-2 font-mono text-xs outline-none" value={f.out.text} onChange={onOutput}
            />
          </label>
        </div>
      )}
    </section>
  );
}
