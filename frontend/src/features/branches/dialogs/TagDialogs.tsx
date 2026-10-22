import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { clip } from '@/lib/clip';
import type { RefDialog } from '@/state/refDialog';
import { createTag, deleteRemoteTags, deleteTags } from '../api';
import { fieldClass, RefDialogFrame, useRefOp } from './Frame';

type Of<K extends RefDialog['kind']> = Extract<RefDialog, { kind: K }>;

export function CreateTagDialog({ d }: { d: Of<'createTag'> }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const { busy, error, run } = useRefOp();
  const n = name.trim();
  const annotated = message.trim() !== '';
  return (
    <RefDialogFrame
      title={`Create tag at ${d.at.label}`} submit={annotated ? 'Create annotated tag' : 'Create tag'} busyLabel="Creating…" busy={busy} error={error} canSubmit={n !== ''}
      onSubmit={() => void run(d.tab, { running: `Creating ${n}…`, done: () => `Created tag ${n}` }, () => createTag(d.tab, n, d.at.oid, message))}
    >
      <label className={fieldClass}>
        Tag name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.0.0" spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Message (optional: makes an annotated tag)
        <textarea
          value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"
        />
      </label>
    </RefDialogFrame>
  );
}

export function DeleteTagsDialog({ d }: { d: Of<'deleteTags'> }) {
  const { busy, error, run } = useRefOp();
  const what = d.names.length === 1 ? d.names[0] : `${d.names.length} tags`;
  const where = d.remote === null ? 'locally' : `from ${d.remote}`;
  return (
    <RefDialogFrame
      title={`Delete ${what} ${where}?`} submit="Delete" busyLabel="Deleting…" destructive busy={busy} error={error}
      description={d.remote === null ? 'The tag is deleted in this repository only.' : `The tag is deleted on ${clip(d.remote)}; the local tag stays.`}
      onSubmit={() => void run(d.tab, { running: 'Deleting…', done: () => `Deleted ${what} ${where}` },
        () => (d.remote === null ? deleteTags(d.tab, d.names) : deleteRemoteTags(d.tab, d.remote, d.names)))}
    >
      <ul aria-label="Tags to delete" className="grid gap-0.5 font-mono text-sm">{d.names.map((n) => <li key={n} className="break-all">{clip(n)}</li>)}</ul>
    </RefDialogFrame>
  );
}
