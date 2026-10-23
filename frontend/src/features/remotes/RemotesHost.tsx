import { useRemoteDialog, type RemoteDialog } from '@/state/remoteDialog';
import { useAutoFetch } from './autoFetch';
import { AddRemoteDialog, EditRemoteDialog, PushDialog } from './RemoteDialog';

const ids = new WeakMap<RemoteDialog, number>();
let next = 0;
/** One id per opened dialog: a new dialog, even of the same kind, starts from fresh state. */
const idOf = (d: RemoteDialog) => {
  if (!ids.has(d)) ids.set(d, ++next);
  return ids.get(d)!;
};

/** The remotes feature's always-mounted part (mounted once by the shell): the open remote dialog and the auto-fetch timers. */
export function RemotesHost() {
  useAutoFetch();
  const d = useRemoteDialog();
  if (!d) return null;
  const key = idOf(d);
  switch (d.kind) {
    case 'add': return <AddRemoteDialog key={key} d={d} />;
    case 'edit': return <EditRemoteDialog key={key} d={d} />;
    case 'push': return <PushDialog key={key} d={d} />;
  }
}
