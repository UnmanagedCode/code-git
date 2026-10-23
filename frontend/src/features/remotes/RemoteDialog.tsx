import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { fieldClass, RefDialogFrame, useRefOp } from '@/features/branches/dialogs/Frame';
import { trackingOf } from '@/state/branchTracking';
import { closeRemoteDialog, type RemoteDialog } from '@/state/remoteDialog';
import { refreshRemotes, remoteInfo, useRemotes } from '@/state/remotes';
import { addRemote, editRemote, renameRemote } from './api';
import { pushFlow } from './pushFlow';
import { fetchFlow } from './run';

// The add / edit remote dialogs and the push dialog (a branch with no upstream, or "Push to <remote>…"). Add and edit
// keep the dialog open while the op runs and show a refusal (BAD_URL, REMOTE_EXISTS, BAD_REF) inline; edit sends only
// what changed, so a masked url is never written back.

type Of<K extends RemoteDialog['kind']> = Extract<RemoteDialog, { kind: K }>;

export function AddRemoteDialog({ d }: { d: Of<'add'> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const [fetchAfter, setFetchAfter] = useState(true);
  const { busy, error, run } = useRefOp();
  const n = name.trim();
  const u = url.trim();
  const p = pushUrl.trim();
  return (
    <RefDialogFrame
      title="Add remote" submit="Add remote" busyLabel="Adding…" busy={busy} error={error} canSubmit={n !== '' && u !== ''} onClose={closeRemoteDialog}
      onSubmit={() => void run(d.tab, { running: `Adding ${n}…`, done: () => `Added remote ${n}` }, () => addRemote(d.tab, n, u, p || undefined), () => {
        closeRemoteDialog();
        void refreshRemotes(d.tab);
        if (fetchAfter) void fetchFlow(d.tab, n);
      })}
    >
      <label className={fieldClass}>
        Name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="upstream" spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Fetch URL
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://host/owner/repo.git or git@host:owner/repo.git" spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Push URL (optional)
        <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="the fetch URL" spellCheck={false} autoComplete="off" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fetchAfter} onChange={(e) => setFetchAfter(e.target.checked)} />
        Fetch after adding
      </label>
    </RefDialogFrame>
  );
}

export function EditRemoteDialog({ d }: { d: Of<'edit'> }) {
  // The remote as listed when the dialog opened: what "changed" is measured against.
  const [info] = useState(() => remoteInfo(d.tab.project, d.remote));
  const shownUrl = info?.displayUrl && info.urls.length ? info.displayUrl : '';
  const shownPush = info?.displayPushUrl ?? '';
  const [name, setName] = useState(d.remote);
  const [url, setUrl] = useState(shownUrl);
  const [pushUrl, setPushUrl] = useState(shownPush);
  const { busy, error, run } = useRefOp();
  const n = name.trim();
  const u = url.trim();
  const p = pushUrl.trim();
  const multiUrl = (info?.urls.length ?? 0) > 1;
  const multiPush = (info?.pushUrls.length ?? 0) > 1;
  const change: { url?: string; pushUrl?: string | null } = {
    ...(!multiUrl && u !== shownUrl ? { url: u } : {}),
    ...(!multiPush && p !== shownPush ? { pushUrl: p || null } : {}),
  };
  const renamed = n !== d.remote;
  const changed = renamed || Object.keys(change).length > 0;
  return (
    <RefDialogFrame
      title={`Edit remote ${d.remote}`} submit="Save" busyLabel="Saving…" busy={busy} error={error} onClose={closeRemoteDialog}
      canSubmit={changed && n !== '' && (change.url === undefined || u !== '')}
      onSubmit={() => void run(d.tab, { running: `Saving ${d.remote}…`, done: () => `Saved remote ${n}` }, async () => {
        if (renamed) await renameRemote(d.tab, d.remote, n);
        if (Object.keys(change).length) await editRemote(d.tab, n, change);
      }, () => { closeRemoteDialog(); void refreshRemotes(d.tab); })}
    >
      <label className={fieldClass}>
        Name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Fetch URL
        <Input value={url} disabled={multiUrl} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Push URL (empty: the fetch URL)
        <Input value={pushUrl} disabled={multiPush} onChange={(e) => setPushUrl(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {(multiUrl || multiPush) && <p role="note" className="text-sm text-muted-foreground">This remote has several {multiUrl ? 'fetch' : 'push'} URLs: edit them with git.</p>}
    </RefDialogFrame>
  );
}

export function PushDialog({ d }: { d: Of<'push'> }) {
  const { data } = useRemotes(d.tab);
  const names = data?.map((r) => r.name) ?? [];
  const [remote, setRemote] = useState(d.remote ?? names[0] ?? '');
  const [to, setTo] = useState(d.branch);
  const hasUpstream = !!trackingOf(d.tab, `refs/heads/${d.branch}`)?.upstream?.startsWith('refs/remotes/');
  const [setUpstream, setSetUpstream] = useState(!hasUpstream);
  const t = to.trim();
  const chosen = remote || names[0] || '';
  return (
    <RefDialogFrame
      title={`Push ${d.branch}`} submit="Push" busyLabel="Pushing…" busy={false} error={null} onClose={closeRemoteDialog} canSubmit={chosen !== '' && t !== ''}
      onSubmit={() => {
        closeRemoteDialog();
        void pushFlow(d.tab, { branch: d.branch, remote: chosen, to: t, setUpstream });
      }}
    >
      <label className={fieldClass}>
        Remote
        <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30" value={chosen} onChange={(e) => setRemote(e.target.value)}>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className={fieldClass}>
        Branch on the remote
        <Input autoFocus value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)} />
        Set as upstream
      </label>
      {!names.length && <p role="note" className="text-sm text-muted-foreground">This repository has no remote: add one from the Refs panel.</p>}
    </RefDialogFrame>
  );
}
