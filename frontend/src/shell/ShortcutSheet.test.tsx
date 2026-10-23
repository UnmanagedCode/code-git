import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { overlayStore } from './overlays';
import { SHORTCUT_GROUPS, shortcutLabel } from './shortcuts';
import { ShortcutSheet } from './ShortcutSheet';
import { useShellKeys } from './useShellKeys';

function Harness() {
  useShellKeys();
  return <ShortcutSheet />;
}

// Invariant: the sheet renders exactly the catalog — every group as a section, every shortcut's label and combos, in order.
test('Ctrl/⌘+/ opens the sheet; its rows equal the catalog', async () => {
  render(<Harness />);
  act(() => { fireEvent.keyDown(window, { key: '/', ctrlKey: true }); });
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  const sections = within(dialog).getAllByRole('region');
  expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(SHORTCUT_GROUPS.map((g) => g.scope));
  SHORTCUT_GROUPS.forEach((g, i) => {
    const rows = [...sections[i].querySelectorAll('[data-shortcut]')].map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent]);
    expect(rows).toEqual(g.shortcuts.map((s) => [s.label, shortcutLabel(s)]));
  });
  act(() => overlayStore.set(null));
});
