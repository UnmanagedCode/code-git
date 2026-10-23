import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Draft } from '@/features/workdir/api';
import { clip } from '@/lib/clip';

/** A commit message's summary (one line) and description, for a reword or a squash chain's head. Sends nothing itself. */
export function RewordDialog({ title, initial, onSave, onCancel }: { title: string; initial: Draft; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const ok = summary.trim() !== '' && !/[\r\n]/.test(summary);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (ok) onSave({ summary: summary.trim(), description: description.trimEnd() }); }}>
          <DialogHeader>
            <DialogTitle className="break-words">{clip(title)}</DialogTitle>
            <DialogDescription>The commit keeps its changes, author and date; only its message changes.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            Summary
            <Input autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          <label className="grid gap-1.5 text-sm">
            Description
            <textarea
              className="min-h-32 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs" value={description}
              onChange={(e) => setDescription(e.target.value)} spellCheck={false}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={!ok}>Save message</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
