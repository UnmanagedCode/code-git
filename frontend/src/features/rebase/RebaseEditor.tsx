import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DRAG_THRESHOLD } from '@/features/graph/drag';
import { formatTime } from '@/features/graph/time';
import type { RowAction } from '@/features/sequence/api';
import { clip } from '@/lib/clip';
import { confirm } from '@/lib/confirm';
import { cn } from '@/lib/utils';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import {
  ACTION_KEY, ACTION_LABEL, ACTIONS, chains, droppedCount, edited, messageOf, move, reset, setAction, setMessage, validate, type RebaseSession,
} from './model';
import { closeRebaseEditor } from './open';
import { RewordDialog } from './RewordDialog';
import { editorTitle, startRebase } from './start';
import { updateSession, useEditor } from './state';

const abbrev = (oid: string) => oid.slice(0, 7);

/** Asks before closing an edited editor; closes it. */
async function close(tab: Tab, s: RebaseSession | null): Promise<void> {
  if (s && edited(s) && !(await confirm({ title: 'Discard the edits?', body: 'The rows go back to the branch as it is; nothing has run.', confirmLabel: 'Discard' }))) return;
  closeRebaseEditor(tab);
}

/**
 * The interactive-rebase editor (docs/merge.md → Interactive rebase), shown in the graph's place: one row per commit,
 * oldest first, each with an action; P/R/E/S/F/D set the focused row's action (R opens the message), ↑/↓ move the focus,
 * Alt+↑/↓ (or the Move buttons, or dragging the handle) move the row. Start runs it; Reset and Cancel discard edits.
 */
export function RebaseEditor({ tab }: { tab: Tab | null }) {
  const state = useEditor(tab);
  useStore(workdirStore);
  const [focus, setFocus] = useState(0);
  const [reword, setReword] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const focusRequest = useRef<number | null>(null);
  useEffect(() => {
    if (focusRequest.current === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${focusRequest.current}"]`)?.focus();
    focusRequest.current = null;
  });
  if (!tab) return null;
  const session = state?.status === 'ready' ? state.session : null;
  if (!session) {
    return (
      <section aria-label="Interactive rebase" className="flex flex-col gap-2 p-3 text-sm">
        {state?.status === 'error' ? <p role="alert" className="break-words text-destructive">{state.message}</p> : <p className="text-muted-foreground">Loading commits…</p>}
        <Button variant="outline" size="sm" className="self-start" onClick={() => void close(tab, null)}>Close</Button>
      </section>
    );
  }
  const s = session;
  const update = (f: (x: RebaseSession) => RebaseSession) => { setErrors([]); updateSession(tab, f); };
  const focusRow = (i: number) => { focusRequest.current = Math.max(0, Math.min(s.rows.length - 1, i)); setFocus(focusRequest.current); };
  const moveRow = (from: number, to: number) => { update((x) => ({ ...x, rows: move(x.rows, from, to) })); focusRow(to); };
  const act = (i: number, action: RowAction) => {
    update((x) => ({ ...x, rows: setAction(x.rows, i, action) }));
    if (action === 'reword') setReword(i);
  };
  const { chains: cs } = chains(s.rows);
  const takesMessage = new Set(cs.filter((c) => c.needsMessage).map((c) => c.head));
  const inProgress = workdirOf(tab).operation;
  const allDropped = s.rows.length > 0 && s.rows.every((r) => r.action === 'drop');
  const blocked = !s.rows.length ? 'Nothing to rebase.'
    : allDropped ? 'Every commit is dropped: use Reset to move the branch instead.'
      : inProgress ? `A ${inProgress.kind} is in progress: continue or abort it first.` : null;
  const start = async () => {
    const found = validate(s);
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try { await startRebase(tab, s); } finally { setBusy(false); }
  };
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (e.altKey) moveRow(i, to); else focusRow(to);
      return;
    }
    const action = !e.altKey && !e.ctrlKey && !e.metaKey ? ACTION_KEY[e.key.toLowerCase()] : undefined;
    if (action) { e.preventDefault(); act(i, action); }
  };
  const startDrag = (e: ReactPointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    let dragging = false;
    let to = from;
    const target = (y: number) => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-index]') ?? [])];
      const below = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
      const idx = below === -1 ? rows.length : below;
      return idx > from ? idx - 1 : idx;
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - y0) < DRAG_THRESHOLD) return;
      dragging = true;
      to = target(ev.clientY);
      setDrag({ from, to });
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
    };
    const onUp = () => { end(); if (dragging && to !== from) moveRow(from, to); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', end);
  };
  const rewordRow = reword !== null && reword < s.rows.length ? reword : null;
  const rewordCommit = rewordRow !== null ? s.commits[s.rows[rewordRow].oid] : null;
  return (
    <section aria-label="Interactive rebase" className="flex min-h-0 flex-col text-sm">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="min-w-60 flex-1">
          <h2 className="font-semibold break-words">{clip(editorTitle(s))}</h2>
          <p className="text-xs text-muted-foreground">Oldest first; squash and fixup meld into the commit above. P R E S F D set the action, Alt+↑/↓ moves a row.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={busy || !edited(s)} onClick={() => update(reset)}>Reset</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void close(tab, s)}>Cancel</Button>
          <Button size="sm" disabled={busy || blocked !== null} onClick={() => void start()}>{busy ? 'Starting…' : 'Start'}</Button>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Close interactive rebase" disabled={busy} onClick={() => void close(tab, s)}><XIcon /></Button>
        </div>
      </header>
      {blocked && <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{blocked}</p>}
      {errors.length > 0 && (
        <ul role="alert" className="border-b px-3 py-1.5 text-xs text-destructive">
          {errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {droppedCount(s.rows) > 0 && !allDropped && <p className="border-b px-3 py-1.5 text-xs text-warning">{droppedCount(s.rows)} dropped: Start asks first.</p>}
      <ol ref={listRef} aria-label="Commits to rebase" className="min-h-0 flex-1 overflow-auto">
        {s.rows.map((r, i) => {
          const c = s.commits[r.oid];
          const message = messageOf(s, i);
          const shown = message?.summary ?? c.summary;
          return (
            <li
              key={r.oid} data-row-index={i} data-action={r.action} tabIndex={i === focus ? 0 : -1} aria-label={`${abbrev(r.oid)} ${clip(shown)}`}
              className={cn(
                'flex items-center gap-2 border-b px-2 py-1 outline-none focus-visible:bg-accent',
                r.action === 'drop' && 'text-muted-foreground line-through',
                drag && drag.to === i && drag.from !== i && 'border-t-2 border-t-primary',
              )}
              onFocus={() => setFocus(i)} onKeyDown={(e) => onRowKey(e, i)}
            >
              <span role="button" tabIndex={-1} aria-label={`Drag ${abbrev(r.oid)}`} className="cursor-grab touch-none text-muted-foreground" onPointerDown={(e) => startDrag(e, i)}>
                <GripVerticalIcon className="size-4" />
              </span>
              <select
                aria-label={`Action for ${abbrev(r.oid)}`} value={r.action} className="h-7 rounded-md border border-input bg-transparent px-1 text-xs no-underline"
                onChange={(e) => act(i, e.target.value as RowAction)}
              >
                {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
              </select>
              <span className="font-mono text-xs">{abbrev(r.oid)}</span>
              <span className="min-w-0 flex-1 truncate" title={clip(shown)}>{clip(shown)}</span>
              {takesMessage.has(i) && (
                <Button variant="outline" size="sm" className="h-6 px-1.5 text-xs" aria-label={`Message for ${abbrev(r.oid)}`} onClick={() => setReword(i)}>Message…</Button>
              )}
              <span className="hidden w-32 truncate text-xs text-muted-foreground md:inline" title={clip(c.author.name)}>{clip(c.author.name)}</span>
              <span className="hidden text-xs whitespace-nowrap text-muted-foreground lg:inline">{formatTime(c.author.time)}</span>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Move ${abbrev(r.oid)} up`} disabled={i === 0} onClick={() => moveRow(i, i - 1)}><ArrowUpIcon className="size-3.5" /></Button>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Move ${abbrev(r.oid)} down`} disabled={i === s.rows.length - 1} onClick={() => moveRow(i, i + 1)}><ArrowDownIcon className="size-3.5" /></Button>
            </li>
          );
        })}
      </ol>
      {rewordRow !== null && rewordCommit && (
        <RewordDialog
          title={`Message for ${abbrev(rewordCommit.oid)}`}
          initial={messageOf(s, rewordRow) ?? { summary: rewordCommit.summary, description: rewordCommit.description }}
          onCancel={() => { setReword(null); focusRow(rewordRow); }}
          onSave={(d) => { update((x) => ({ ...x, rows: setMessage(x.rows, rewordRow, d) })); setReword(null); focusRow(rewordRow); }}
        />
      )}
    </section>
  );
}
