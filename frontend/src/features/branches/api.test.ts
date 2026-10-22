import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { stubFetch } from '@/test/stubFetch';
import { createBranch, deleteBranches, NAMES_MAX, resetHead } from './api';

test('NAMES_MAX mirrors the backend REF_LIMITS.namesMax', async () => {
  const backend = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/git/refs/limits.js')).href;
  const { REF_LIMITS } = (await import(/* @vite-ignore */ backend)) as { REF_LIMITS: { namesMax: number } };
  expect(NAMES_MAX).toBe(REF_LIMITS.namesMax);
});

test('ccOwned and force are sent only when true; an omitted from is not sent', async () => {
  const f = stubFetch({
    'POST api/ops/branch.create': { ok: true, result: {} },
    'POST api/ops/branch.delete': { ok: true, result: {} },
    'POST api/ops/head.reset': { ok: true, result: {} },
  });
  const T = { project: 'app', worktree: null };
  await createBranch(T, { name: 'b', checkout: false });
  await createBranch(T, { name: 'b', from: 'a'.repeat(40), checkout: true, ccOwned: true });
  await deleteBranches(T, ['b'], false);
  await resetHead(T, { to: 'a'.repeat(40), mode: 'soft', expect: 'b'.repeat(40), ccOwned: false });
  expect(f.calls.map((c) => (c.body as { params: unknown }).params)).toEqual([
    { name: 'b', checkout: false },
    { name: 'b', from: 'a'.repeat(40), checkout: true, ccOwned: true },
    { names: ['b'] },
    { to: 'a'.repeat(40), mode: 'soft', expect: 'b'.repeat(40) },
  ]);
});
