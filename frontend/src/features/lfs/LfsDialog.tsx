import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { runRefOp } from '@/features/branches/run';
import type { ApiError } from '@/lib/api';
import { clip } from '@/lib/clip';
import { stderrOf } from '@/lib/opToast';
import { closeLfsDialog, setLfsDialog, type LfsDialog as LfsDialogState } from '@/state/lfsDialog';
import { lfsFiles, lfsPrune, lfsPull, lfsStatus, lfsTrack, lfsUntrack, type LfsFile, type LfsStatus } from './api';

// The LFS dialog (docs/lfs.md): git-lfs's state on the project's System, the root .gitattributes patterns, and the
// ops. Opening it only reads (lfs.status); the file list is read on request, since git-lfs may write while it lists.

/** Files the table shows before "…and N more". */
const FILES_SHOWN = 200;
const NEED = '3.2.0';

const bytes = (n: number | null): string => {
  if (n === null) return '?';
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(1)} ${units[u]}`;
};

function ErrorBlock({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const stderr = stderrOf(error);
  return (
    <div role="alert" className="grid gap-1 text-sm text-destructive">
      <p className="break-words">{clip(error.message)}</p>
      {stderr && <p className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{clip(stderr, 600)}</p>}
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p role="note" className="rounded-md border border-warning/60 bg-warning/10 p-2 text-sm">{children}</p>;

/** Runs one LFS op inside the dialog: busy while it runs, its refusal shown inline, a success toast. */
function useLfsOp(d: LfsDialogState, after: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async <T,>(what: string, done: string, fn: () => Promise<T>): Promise<boolean> => {
    setBusy(what);
    setError(null);
    const r = await runRefOp(d.tab, { running: `${what}…`, done: () => done, toastRunning: false }, fn);
    setBusy(null);
    if (!r.ok) setError(r.error);
    after();
    return r.ok;
  };
  return { busy, error, run };
}

function MainView({ d }: { d: LfsDialogState }) {
  const [status, setStatus] = useState<LfsStatus | null>(null);
  const [statusError, setStatusError] = useState<ApiError | null>(null);
  const [files, setFiles] = useState<LfsFile[] | null>(null);
  const [pattern, setPattern] = useState('');
  const loadStatus = useCallback(() => {
    lfsStatus(d.tab).then((s) => { setStatus(s); setStatusError(null); }, (e: ApiError) => setStatusError(e));
  }, [d.tab]);
  const { busy: opBusy, error, run } = useLfsOp(d, loadStatus);
  const [listing, setListing] = useState(false);
  const [filesError, setFilesError] = useState<ApiError | null>(null);
  const busy = opBusy ?? (listing ? 'Listing LFS files' : null);
  const listFiles = async () => {
    setListing(true);
    try {
      setFiles((await lfsFiles(d.tab)).files);
      setFilesError(null);
    } catch (e) {
      setFilesError(e as ApiError);
    } finally {
      setListing(false);
    }
  };
  /** An op, then the list again when the user listed the files in this session. */
  const op = async <T,>(what: string, done: string, fn: () => Promise<T>) => {
    const ok = await run(what, done, fn);
    if (d.listed) await listFiles();
    return ok;
  };
  useEffect(() => { loadStatus(); }, [loadStatus]);
  // Back from Prune's step: the session listed the files, so list them again.
  useEffect(() => { if (d.listed) void listFiles(); }, []);

  const usable = !!status?.available && status.supported;
  const p = pattern.trim();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Git LFS</DialogTitle>
        <DialogDescription>
          {status?.available ? `git-lfs ${status.version} on this project's System.` : 'Large files through git-lfs on this project\'s System.'}
        </DialogDescription>
      </DialogHeader>
      {!status && !statusError && <p className="text-sm text-muted-foreground" role="status">Reading git-lfs status…</p>}
      <ErrorBlock error={statusError} />
      {status && !status.available && <Note>git-lfs is not installed on this project&apos;s System.</Note>}
      {status?.available && !status.supported && <Note>git-lfs {status.version} is installed; code-git needs git-lfs {NEED} or later.</Note>}
      {usable && status.filters === false && (
        <Note>The LFS filter is not configured on this project&apos;s System: run <code>git lfs install</code> there, or LFS files are committed as their content.</Note>
      )}
      {usable && (
        <div className="grid gap-4">
          <section className="grid gap-2" aria-label="Tracked patterns">
            <h3 className="text-sm font-medium">Tracked patterns (root .gitattributes)</h3>
            {status.attributes === 'unsupported' && <Note>The root .gitattributes is not a regular file code-git reads (a link, a directory, or too large): its patterns are not listed, and Track and Untrack are refused.</Note>}
            {status.patterns && status.patterns.length === 0 && <p className="text-sm text-muted-foreground">No pattern is tracked.</p>}
            {status.patterns && status.patterns.length > 0 && (
              <ul className="grid gap-1">
                {status.patterns.map((x) => (
                  <li key={x} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono break-all">{clip(x)}</span>
                    <Button type="button" variant="outline" size="sm" className="h-7" disabled={!!busy} aria-label={`Untrack ${x}`}
                      onClick={() => void op(`Untracking ${x}`, `Untracked ${x}`, () => lfsUntrack(d.tab, x))}>Untrack</Button>
                  </li>
                ))}
              </ul>
            )}
            <form className="flex gap-2" onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!p || busy) return;
              void op(`Tracking ${p}`, `Tracking ${p}`, () => lfsTrack(d.tab, p)).then((ok) => { if (ok) setPattern(''); });
            }}>
              <Input aria-label="Pattern" placeholder="*.psd" value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} autoComplete="off" />
              <Button type="submit" variant="outline" disabled={!p || !!busy}>Track</Button>
            </form>
          </section>
          <section className="grid gap-2" aria-label="LFS files">
            <h3 className="text-sm font-medium">Files</h3>
            <ErrorBlock error={filesError} />
            {files === null ? (
              <div className="grid gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8 justify-self-start" disabled={!!busy}
                  onClick={() => { setLfsDialog({ ...d, listed: true }); void listFiles(); }}>List files</Button>
                <p className="text-xs text-muted-foreground">git-lfs may create <code>.git/lfs</code> and install its hooks in this repository while it lists.</p>
              </div>
            ) : files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No LFS file in HEAD.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="font-normal">Path</th><th className="font-normal">Size</th><th className="font-normal">Downloaded</th></tr></thead>
                <tbody>
                  {files.slice(0, FILES_SHOWN).map((f) => (
                    <tr key={f.path}>
                      <td className="font-mono break-all">{clip(f.path)}</td>
                      <td className="whitespace-nowrap">{bytes(f.size)}</td>
                      <td>{f.downloaded === null ? '?' : f.downloaded ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                  {files.length > FILES_SHOWN && <tr><td colSpan={3} className="text-muted-foreground">…and {files.length - FILES_SHOWN} more</td></tr>}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={!!busy} onClick={closeLfsDialog}>Close</Button>
        {usable && (
          <>
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => setLfsDialog({ ...d, kind: 'prune' })}>Prune…</Button>
            <Button type="button" disabled={!!busy} onClick={() => void op('Pulling LFS files', 'Pulled LFS files', () => lfsPull(d.tab))}>
              {busy === 'Pulling LFS files' ? 'Pulling…' : 'Pull'}
            </Button>
          </>
        )}
      </DialogFooter>
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}…</p>}
    </>
  );
}

function PruneStep({ d }: { d: LfsDialogState }) {
  const back = () => setLfsDialog({ ...d, kind: 'main' });
  const { busy, error, run } = useLfsOp(d, () => {});
  return (
    <form className="contents" onSubmit={(e) => {
      e.preventDefault();
      if (busy) return;
      void run('Pruning LFS objects', 'Pruned LFS objects', () => lfsPrune(d.tab)).then((ok) => { if (ok) back(); });
    }}>
      <DialogHeader>
        <DialogTitle>Prune LFS objects?</DialogTitle>
        <DialogDescription>
          Prune deletes local LFS objects not needed by recent commits; they must be downloaded again. git-lfs keeps objects not pushed yet.
        </DialogDescription>
      </DialogHeader>
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={!!busy} onClick={back}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={!!busy}>{busy ? 'Pruning…' : 'Prune'}</Button>
      </DialogFooter>
    </form>
  );
}

export function LfsDialog({ d }: { d: LfsDialogState }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeLfsDialog(); }}>
      <DialogContent className="sm:max-w-lg">
        {d.kind === 'main' ? <MainView d={d} /> : <PruneStep d={d} />}
      </DialogContent>
    </Dialog>
  );
}
