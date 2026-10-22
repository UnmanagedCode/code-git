import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PanelBoundary } from './PanelBoundary';

let explode = true;
function Bomb() {
  if (explode) throw new RangeError('Invalid time value');
  return <p>recovered</p>;
}

test("a panel's render error stays in that panel: a sibling still renders; Retry renders it again once it can", () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  explode = true;
  const ui = (resetKey: string) => (
    <>
      <PanelBoundary title="Commit graph" resetKey={resetKey}><Bomb /></PanelBoundary>
      <PanelBoundary title="Activity" resetKey={resetKey}><p>sibling</p></PanelBoundary>
    </>
  );
  render(ui('a'));
  expect(screen.getByRole('alert').textContent).toContain('The Commit graph panel failed: Invalid time value');
  expect(screen.getByText('sibling')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByRole('alert')).toBeTruthy();
  explode = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByText('recovered')).toBeTruthy();
  expect(screen.getByText('sibling')).toBeTruthy();
  err.mockRestore();
});

test('a new resetKey clears a failed panel', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  explode = true;
  const { rerender } = render(<PanelBoundary title="Graph" resetKey="a"><Bomb /></PanelBoundary>);
  expect(screen.getByRole('alert')).toBeTruthy();
  explode = false;
  rerender(<PanelBoundary title="Graph" resetKey="b"><Bomb /></PanelBoundary>);
  expect(screen.getByText('recovered')).toBeTruthy();
  err.mockRestore();
});

test('an on-demand panel\'s fallback offers Close, which calls onClose; a default panel\'s offers none', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  explode = true;
  const onClose = vi.fn();
  const { unmount } = render(<PanelBoundary title="Diff" resetKey="a" onClose={onClose}><Bomb /></PanelBoundary>);
  fireEvent.click(screen.getByRole('button', { name: 'Close Diff' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  render(<PanelBoundary title="Activity" resetKey="a"><Bomb /></PanelBoundary>);
  expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
  explode = false;
  err.mockRestore();
});
