import { expect, test } from 'vitest';
import { stubFetch } from '@/test/stubFetch';
import { getRemotes, refreshRemotes, remoteInfo } from './remotes';
import { refsKey } from './tabs';

const remote = (name: string) => ({ name, urls: [`https://h/${name}.git`], pushUrls: [], fetch: [], displayUrl: `https://h/${name}.git`, displayPushUrl: null, legacy: false, multiUrl: false, multiPushUrl: false });

test("a submodule tab lists its own remotes (target with sub, its own refsKey entry); a worktree tab shares the project's", async () => {
  const ROOT = { project: 'app', worktree: null };
  const SUB = { project: 'app', worktree: null, sub: ['libs/a'] };
  const fetch = stubFetch({
    'POST api/ops/remote.list': (_u: URL, init?: RequestInit) => ({ ok: true, result: { remotes: [remote(JSON.parse(String(init?.body)).target.sub ? 'sub-origin' : 'origin')] } }),
  });
  await refreshRemotes(ROOT);
  await refreshRemotes(SUB);
  expect(fetch.calls.map((c) => c.body)).toEqual([{ target: { project: 'app' } }, { target: { project: 'app', sub: ['libs/a'] } }]);
  expect(getRemotes(refsKey(ROOT)).data?.map((r) => r.name)).toEqual(['origin']);
  expect(getRemotes(refsKey(SUB)).data?.map((r) => r.name)).toEqual(['sub-origin']);
  expect(remoteInfo(refsKey({ project: 'app', worktree: 'wt' }), 'origin')?.name).toBe('origin');
  expect(remoteInfo(refsKey(SUB), 'origin')).toBeUndefined();
});
