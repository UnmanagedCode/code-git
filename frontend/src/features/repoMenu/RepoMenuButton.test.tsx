import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { flowStore } from '@/features/flow/state';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { lfsDialogStore } from '@/state/lfsDialog';
import { tabKey } from '@/state/tabs';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { oid, ref, refsResult } from '@/test/graphData';
import { RepoMenuButton } from './RepoMenuButton';

const T = { project: 'app', worktree: null };
const UNSET = {
  initialized: false, main: null, develop: null, prefixes: { feature: null, release: null, hotfix: null, versionTag: null },
  defaults: { main: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' } },
};

function world(headOid: string | null) {
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready',
    refs: refsResult({ head: { oid: headOid, branch: 'refs/heads/main', detached: false, unborn: headOid === null }, refs: headOid ? [ref('refs/heads/main', headOid)] : [] }),
  }]]));
  const f = stubGraph(linearWorld(1), { 'POST api/ops/flow.config': { ok: true, result: UNSET } });
  render(<RepoMenuButton tab={T} />);
  return f;
}

test("renders the repo context's actions and loads the git-flow settings for the branch menus", async () => {
  const f = world(oid(1));
  await waitFor(() => expect(flowStore.get().get('app')).toEqual(UNSET));
  await userEvent.click(screen.getByRole('button', { name: 'Repository actions' }));
  const items = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
  expect(items).toEqual(['Git-flow', 'LFS…']);
  await userEvent.click(screen.getByRole('menuitem', { name: 'LFS…' }));
  expect(lfsDialogStore.get()).toEqual({ kind: 'main', tab: T, listed: false });
  expect(f.count('POST api/ops/flow.config')).toBeGreaterThanOrEqual(1);
});

test('an unborn HEAD still offers LFS; git-flow needs a commit', async () => {
  world(null);
  await userEvent.click(screen.getByRole('button', { name: 'Repository actions' }));
  expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['LFS…']);
});
