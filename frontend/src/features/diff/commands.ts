import type { Command } from '@/shell/commands';
import { trackOp } from '@/lib/opToast';
import { prefsStore, whitespaceFor } from '@/state/diff';
import { listDiffFiles, type DiffSource } from './api';
import { openDiff } from './openDiff';

// The palette's diff command: a typed revision (sha, ref, HEAD~n), checked by listing its diff before the view opens.

export const DIFF_COMMANDS: Command[] = [
  {
    id: 'diff.showCommit', title: 'Show commit…', group: 'Diff',
    pick: {
      placeholder: 'Commit (sha or ref)',
      items: () => [],
      typed: (t) => ({ id: t, label: t, detail: 'revision' }),
      // A refusal (REV_UNKNOWN, BAD_REF) is trackOp's error toast and opens nothing.
      run: async (tab, item) => {
        const source: DiffSource = { kind: 'commit', rev: item.id };
        const r = await trackOp(() => listDiffFiles(tab, source, whitespaceFor(prefsStore.get())), { running: `Loading ${item.id}…`, done: () => null });
        if (r.ok) openDiff(tab, source, { preloaded: r.result });
      },
    },
  },
];
