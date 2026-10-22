import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile, fdiff, filesResult, hunk, OID } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { openDiff } from './openDiff';
import { copyPatch, downloadPatch, PATCH_MAX_PATHS, patchPaths } from './patch';

const APP = { project: 'app', worktree: null };
const BYTES = new Uint8Array([0x64, 0x69, 0x66, 0x66, 0x0a, 0x00, 0xff]);
const B64 = btoa(String.fromCharCode(...BYTES));
let blobs: Blob[] = [];
let revoked: string[] = [];
let clicked: HTMLAnchorElement[] = [];
const origClick = HTMLAnchorElement.prototype.click;

beforeEach(() => {
  blobs = []; revoked = []; clicked = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => { blobs.push(b); return `blob:test/${blobs.length}`; },
    revokeObjectURL: (u: string) => { revoked.push(u); },
  }));
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this); };
});
afterEach(() => { HTMLAnchorElement.prototype.click = origClick; });

async function open(patch: Response | object = { ok: true, result: { filename: 'abc1234.patch', base64: B64, bytes: BYTES.length } }) {
  const fetch = stubFetch({
    'GET api/activity': { entries: [] },
    'POST api/ops/repo.summary': { ok: true, result: summary() },
    'POST api/ops/diff.files': { ok: true, result: filesResult([dfile({ path: 'a.ts' }), dfile({ path: 'b.ts' }), dfile({ path: 'c.ts', oldPath: 'old/c.ts', status: 'R', similarity: 90 })], { commit: { oid: OID('c'), parents: [OID('p')] } }) },
    'POST api/ops/diff.file': { ok: true, result: fdiff([hunk(1, 1, ['+x'])]) },
    'POST api/ops/diff.patch': patch,
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await screen.findByRole('option', { name: /a\.ts/ });
  const patches = () => fetch.calls.filter((c) => c.url.pathname.endsWith('diff.patch')).map((c) => (c.body as { params: unknown }).params);
  return { patches };
}

const menu = async (item: string) => {
  await userEvent.click(screen.getByRole('button', { name: /Create patch/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};

test('Download: a Blob of the decoded bytes typed text/x-diff, named by the backend, its URL revoked', async () => {
  const { patches } = await open();
  await menu('Download .patch');
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(patches()).toEqual([{ source: { kind: 'commit', rev: OID('c') } }]);
  expect(blobs[0].type).toBe('text/x-diff');
  expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(BYTES);
  expect(clicked[0].download).toBe('abc1234.patch');
  expect(clicked[0].getAttribute('href')).toBe('blob:test/1');
  await waitFor(() => expect(revoked).toEqual(['blob:test/1']));
});

test('Copy: the decoded patch text goes to the clipboard', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await open({ ok: true, result: { filename: 'x.patch', base64: btoa('From abc\n'), bytes: 9 } });
  await menu('Copy patch');
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('From abc\n'));
});

test('multi-selected files are sent as paths, a rename with its old path too; from the file menu too', async () => {
  const { patches } = await open();
  await userEvent.click(screen.getByRole('option', { name: /a\.ts/ }));
  fireEvent.click(screen.getByRole('option', { name: /→ c\.ts/ }), { ctrlKey: true });
  expect(diffStore.get().get(tabKey(APP))?.selected.sort()).toEqual(['a.ts', 'c.ts']);
  await menu('Download .patch of 2 selected files');
  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(patches()[0]).toEqual({ source: { kind: 'commit', rev: OID('c') }, paths: ['a.ts', 'old/c.ts', 'c.ts'] });
  await userEvent.click(screen.getByRole('button', { name: 'Actions for c.ts' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Create patch from selection (download)' }));
  await waitFor(() => expect(patches()).toHaveLength(2));
  expect(patches()[1]).toEqual({ source: { kind: 'commit', rev: OID('c') }, paths: ['a.ts', 'old/c.ts', 'c.ts'] });
});

test('PATCH_MAX_PATHS mirrors the backend DIFF_LIMITS.maxPaths', async () => {
  const backend = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/git/diff/limits.js')).href;
  const { DIFF_LIMITS } = (await import(/* @vite-ignore */ backend)) as { DIFF_LIMITS: { maxPaths: number } };
  expect(PATCH_MAX_PATHS).toBe(DIFF_LIMITS.maxPaths);
});

test('a selection needing more than PATCH_MAX_PATHS paths (renames count twice) is refused in the header, with no request', async () => {
  const { patches } = await open();
  const renames = Array.from({ length: PATCH_MAX_PATHS / 2 + 1 }, (_, i) => dfile({ path: `n${i}`, oldPath: `o${i}`, status: 'R' }));
  expect(patchPaths(renames)).toHaveLength(PATCH_MAX_PATHS + 2);
  await act(() => downloadPatch(APP, { kind: 'commit', rev: OID('c') }, patchPaths(renames)));
  await act(() => copyPatch(APP, { kind: 'commit', rev: OID('c') }, patchPaths(renames)));
  expect((await screen.findByRole('alert')).textContent).toBe(`Too many files selected for a patch (max ${PATCH_MAX_PATHS} paths); use the whole-diff patch`);
  expect(patches()).toHaveLength(0);
  expect(clicked).toHaveLength(0);
  await act(() => downloadPatch(APP, { kind: 'commit', rev: OID('c') }, patchPaths(renames.slice(0, PATCH_MAX_PATHS / 2))));
  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a failed patch request is shown as an alert in the diff header', async () => {
  await open(json({ error: 'git output exceeded', code: 'OUTPUT_TOO_LARGE', limitBytes: 1 }, 422));
  await menu('Download .patch');
  expect((await screen.findByRole('alert')).textContent).toMatch(/Could not create the patch: git output exceeded/);
  expect(clicked).toHaveLength(0);
});
