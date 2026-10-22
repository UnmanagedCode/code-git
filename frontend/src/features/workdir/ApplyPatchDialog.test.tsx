import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { dispatchTabs } from '@/state/tabs';
import { json } from '@/test/fixtures';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';
import { APPLY_PATCH_MAX_BYTES } from './api';

const APP = { project: 'app', worktree: null };
const PATCH = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n';
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function openDialog(w: WorkdirWorld = {}) {
  const world = workdirWorld({ answers: { 'patch.check': { files: [{ path: 'a', oldPath: null, added: 1, deleted: 1 }] }, ...w.answers } });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await userEvent.click(await screen.findByRole('button', { name: 'Changes menu' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Apply patch…' }));
  return world;
}
const dialog = () => screen.getByRole('dialog', { name: 'Apply patch' });
const button = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;

test('Apply is enabled only after a successful Check of the same bytes and target; it sends them', async () => {
  const w = await openDialog();
  expect(button('Check').disabled).toBe(true);
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Patch text' }), { target: { value: PATCH } });
  expect(button('Apply').disabled).toBe(true);
  await userEvent.click(button('Check'));
  await waitFor(() => expect(button('Apply').disabled).toBe(false));
  expect(w.posts('patch.check')).toEqual([{ patchB64: b64(PATCH), apply: 'worktree' }]);
  expect(within(within(dialog()).getByRole('list', { name: 'Files the patch changes' })).getByText('a')).toBeTruthy();
  // Another target, or other bytes, needs a new check.
  await userEvent.click(within(dialog()).getByRole('radio', { name: 'Index only' }));
  expect(button('Apply').disabled).toBe(true);
  await userEvent.click(button('Check'));
  await waitFor(() => expect(button('Apply').disabled).toBe(false));
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Patch text' }), { target: { value: `${PATCH}\n` } });
  expect(button('Apply').disabled).toBe(true);
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Patch text' }), { target: { value: PATCH } });
  expect(button('Apply').disabled).toBe(false);
  expect(w.posts('patch.apply')).toEqual([]);
  await userEvent.click(button('Apply'));
  await waitFor(() => expect(w.posts('patch.apply')).toEqual([{ patchB64: b64(PATCH), apply: 'index' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('only Working tree and Index only are offered', async () => {
  await openDialog();
  expect(within(within(dialog()).getByRole('radiogroup', { name: 'Apply to' })).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['Working tree', 'Index only']);
});

test('a patch that does not apply shows git\'s stderr as text, and Apply stays disabled', async () => {
  await openDialog({ answers: { 'patch.check': json({ error: 'the patch does not apply: x', code: 'PATCH_DOES_NOT_APPLY', stderr: 'error: <b>a</b>: patch does not apply' }, 409) } });
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Patch text' }), { target: { value: PATCH } });
  await userEvent.click(button('Check'));
  const alert = await within(dialog()).findByRole('alert');
  expect(within(alert).getByText('error: <b>a</b>: patch does not apply', { selector: 'pre' })).toBeTruthy();
  expect(button('Apply').disabled).toBe(true);
});

test('a patch over APPLY_PATCH_MAX_BYTES is refused before any request', async () => {
  const w = await openDialog();
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Patch text' }), { target: { value: 'x'.repeat(APPLY_PATCH_MAX_BYTES + 1) } });
  expect(within(dialog()).getByRole('alert').textContent).toMatch(/larger than 512 KiB/);
  expect(button('Check').disabled).toBe(true);
  expect(w.posts('patch.check')).toEqual([]);
});

test('a chosen file is sent byte for byte (non-UTF-8 included)', async () => {
  const w = await openDialog();
  const bytes = new Uint8Array([...new TextEncoder().encode(PATCH), 0xe9, 0x0a]);
  await userEvent.upload(within(dialog()).getByLabelText('Patch file'), new File([bytes], 'x.patch'));
  await waitFor(() => expect(button('Check').disabled).toBe(false));
  await userEvent.click(button('Check'));
  await waitFor(() => expect(w.posts('patch.check')).toEqual([{ patchB64: Buffer.from(bytes).toString('base64'), apply: 'worktree' }]));
});

test('APPLY_PATCH_MAX_BYTES mirrors the backend STAGE_LIMITS.applyPatchMaxBytes', async () => {
  const backend = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/git/stage/limits.js')).href;
  const { STAGE_LIMITS } = (await import(/* @vite-ignore */ backend)) as { STAGE_LIMITS: { applyPatchMaxBytes: number } };
  expect(APPLY_PATCH_MAX_BYTES).toBe(STAGE_LIMITS.applyPatchMaxBytes);
});
