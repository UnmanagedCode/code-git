import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { clip } from '@/lib/clip';
import type { Tab } from '@/state/tabs';
import { refreshAfterWrite } from '@/state/workdir';
import { APPLY_PATCH_MAX_BYTES, patchApply, patchCheck, type ApplyTarget, type PatchFile } from './api';

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const TARGETS: { value: ApplyTarget; label: string }[] = [{ value: 'worktree', label: 'Working tree' }, { value: 'index', label: 'Index only' }];
const failure = (e: unknown) => ({
  message: e instanceof Error ? e.message : String(e),
  stderr: e instanceof ApiError && typeof (e.body as { stderr?: unknown } | undefined)?.stderr === 'string' ? (e.body as { stderr: string }).stderr : null,
});

/**
 * Apply a patch (plain diff or mailbox) from a file or pasted text, to the working tree (default) or the index only.
 * **Check** lists what it changes; **Apply** is enabled only after a successful check of the same bytes and target.
 * A patch over APPLY_PATCH_MAX_BYTES is refused here, before any request.
 */
export function ApplyPatchDialog({ tab, open, onOpenChange }: { tab: Tab; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [target, setTarget] = useState<ApplyTarget>('worktree');
  const [checked, setChecked] = useState<{ key: string; files: PatchFile[] } | null>(null);
  const [error, setError] = useState<{ message: string; stderr: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const bytes = file ? file.bytes : new TextEncoder().encode(text);
  const tooLarge = bytes.length > APPLY_PATCH_MAX_BYTES;
  const b64 = !bytes.length || tooLarge ? '' : toBase64(bytes);
  const key = `${target}\0${b64}`;
  const ready = !!checked && checked.key === key;
  const reset = () => { setText(''); setFile(null); setTarget('worktree'); setChecked(null); setError(null); };

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await f(); } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  };
  const check = () => run(async () => {
    setChecked(null);
    const r = await patchCheck(tab, b64, target);
    setChecked({ key, files: r.files });
  });
  const apply = () => run(async () => {
    try {
      await patchApply(tab, b64, target);
    } finally {
      await refreshAfterWrite(tab);
    }
    reset();
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Apply patch</DialogTitle>
          <DialogDescription>A plain diff or a mailbox patch. Nothing changes until you Apply; all of it applies or none.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          Patch file
          <input
            type="file"
            aria-label="Patch file"
            accept=".patch,.diff,text/x-diff,text/plain"
            className="text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setFile(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
            }}
          />
        </label>
        <textarea
          aria-label="Patch text"
          placeholder="…or paste the patch here"
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          value={text}
          disabled={!!file}
          onChange={(e) => setText(e.target.value)}
        />
        <div role="radiogroup" aria-label="Apply to" className="flex gap-4 text-sm">
          {TARGETS.map((t) => (
            <label key={t.value} className="flex items-center gap-1.5">
              <input type="radio" name="apply-target" checked={target === t.value} onChange={() => setTarget(t.value)} />
              {t.label}
            </label>
          ))}
        </div>
        {tooLarge && <p role="alert" className="text-sm text-destructive">The patch is larger than {Math.round(APPLY_PATCH_MAX_BYTES / 1024)} KiB: apply it outside code-git.</p>}
        {error && (
          <div role="alert" className="text-xs">
            <p className="break-words text-destructive">{error.message}</p>
            {error.stderr && <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">{error.stderr}</pre>}
          </div>
        )}
        {ready && (
          <ul aria-label="Files the patch changes" className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
            {checked.files.map((f) => (
              <li key={`${f.oldPath ?? ''}\0${f.path}`} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{clip(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}</span>
                <span className="shrink-0 text-muted-foreground">{f.added === null ? 'binary' : `+${f.added} −${f.deleted}`}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy || !b64} onClick={() => void check()}>Check</Button>
          <Button disabled={busy || !ready} onClick={() => void apply()}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
