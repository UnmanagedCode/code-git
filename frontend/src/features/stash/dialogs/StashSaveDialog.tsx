import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DiffFile } from '@/features/diff/api';
import { patchPaths } from '@/features/diff/patch';
import type { ApiError } from '@/lib/api';
import { clip, FILE_RENDER_CAP } from '@/lib/clip';
import { trackOp } from '@/lib/opToast';
import { clearLineSelection } from '@/state/lineSelection';
import { closeStashDialog, type SaveMode, type StashDialog } from '@/state/stashDialog';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import { stashPush, stashPushLines, type PushParams, type PushResult } from '../api';
import { runStashOp } from '../run';
import { dialogError, ErrorBlock, type DialogError } from './shared';

type SaveDialog = Extract<StashDialog, { kind: 'save' }>;

const savedText = (r: PushResult) => (r.selector ? `Stashed as ${r.selector}` : 'Stashed (another stash was saved at the same moment: check the stash list)');

/**
 * A failed save git had already stored as a stash (the refusal names it): said in a warning toast, beside the dialog's
 * error. Through trackOp, as every toast is (lib/opToast.ts): the "op" is the notice itself.
 */
function warnIfStored(e: ApiError): void {
  const selector = (e.body as { oid?: unknown; selector?: unknown } | undefined)?.selector;
  if (typeof selector !== 'string') return;
  void trackOp(async () => undefined, {
    running: '', toastRunning: false,
    done: () => ({ tone: 'warning', title: 'A stash was created despite the error', description: `Your changes are in ${selector}; check it before saving again.` }),
  });
}

const MODES: { mode: SaveMode; label: string }[] = [
  { mode: 'all', label: 'All changes' }, { mode: 'files', label: 'Selected files' }, { mode: 'staged', label: 'Staged only' },
];

/** The Changes panel's rows, unstaged first, one per path. */
function changedFiles(tab: Tab): DiffFile[] {
  const s = workdirOf(tab);
  const seen = new Set<string>();
  return [...(s.unstaged?.files ?? []), ...(s.staged?.files ?? [])].filter((f) => !seen.has(f.path) && !!seen.add(f.path));
}

function SaveContent({ dialog }: { dialog: SaveDialog }) {
  const { tab, preset } = dialog;
  useStore(workdirStore);
  const files = changedFiles(tab);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<SaveMode>(preset.mode === 'lines' ? 'all' : preset.mode);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(preset.mode === 'files' ? preset.paths ?? [] : []));
  const [untracked, setUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);

  const picked = files.filter((f) => selected.has(f.path));
  // A ticked untracked file is stashed only with --include-untracked.
  const untrackedForced = mode === 'files' && picked.some((f) => f.status === '?');
  const withUntracked = untracked || untrackedForced;
  const ready = !busy && (mode !== 'files' || picked.length > 0);

  const params = (): PushParams => {
    const m = message.trim() ? { message: message.trim() } : {};
    if (mode === 'staged') return { ...m, staged: true };
    return { ...m, ...(mode === 'files' ? { paths: patchPaths(picked) } : {}), ...(withUntracked ? { includeUntracked: true } : {}), ...(keepIndex ? { keepIndex: true } : {}) };
  };
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const r = await runStashOp(tab, { running: 'Stashing…', toastRunning: false, done: savedText }, () => (preset.mode === 'lines'
      ? stashPushLines(tab, { ...preset.request, ...(message.trim() ? { message: message.trim() } : {}) })
      : stashPush(tab, params())));
    setBusy(false);
    if (!r.ok) {
      setError(dialogError(r.error));
      warnIfStored(r.error);
      return;
    }
    if (preset.mode === 'lines') clearLineSelection(tab);
    closeStashDialog();
  };
  const toggle = (path: string, on: boolean) => setSelected((s) => {
    const next = new Set(s);
    if (on) next.add(path); else next.delete(path);
    return next;
  });

  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Stash changes</DialogTitle>
        <DialogDescription>
          {preset.mode === 'lines'
            ? `${preset.count} ${preset.count === 1 ? 'line' : 'lines'} of ${clip(preset.request.path)}`
            : 'Set the changes aside: they leave the working tree and wait in the stash list.'}
        </DialogDescription>
      </DialogHeader>
      <Input aria-label="Stash message" placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
      {preset.mode !== 'lines' && (
        <>
          <div role="radiogroup" aria-label="What to stash" className="flex flex-wrap gap-4 text-sm">
            {MODES.map((m) => (
              <label key={m.mode} className="flex items-center gap-1.5">
                <input type="radio" name="stash-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
                {m.label}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={mode !== 'staged' && withUntracked} disabled={mode === 'staged' || untrackedForced} onChange={(e) => setUntracked(e.target.checked)} />
              Include untracked files
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={mode !== 'staged' && keepIndex} disabled={mode === 'staged'} onChange={(e) => setKeepIndex(e.target.checked)} />
              Keep staged changes
            </label>
          </div>
          {mode === 'files' && (
            <ul aria-label="Files to stash" className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
              {files.slice(0, FILE_RENDER_CAP).map((f) => (
                <li key={f.path}>
                  <label className="flex min-w-0 items-center gap-1.5">
                    <input type="checkbox" checked={selected.has(f.path)} onChange={(e) => toggle(f.path, e.target.checked)} />
                    <span className="w-3 shrink-0 text-muted-foreground">{f.status === '?' ? 'U' : f.status}</span>
                    <span className="min-w-0 truncate" title={clip(f.path)}>{clip(f.path)}</span>
                  </label>
                </li>
              ))}
              {files.length > FILE_RENDER_CAP && <li className="text-muted-foreground">…and {files.length - FILE_RENDER_CAP} more</li>}
              {!files.length && <li className="text-muted-foreground">No changes</li>}
            </ul>
          )}
        </>
      )}
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeStashDialog}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Stash</Button>
      </DialogFooter>
    </form>
  );
}

export function StashSaveDialog({ dialog }: { dialog: SaveDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeStashDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><SaveContent dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
