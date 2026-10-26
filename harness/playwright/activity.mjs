// The Activity panel starts collapsed on every page load (no persistence): a script that reads its rows opens it first.
/** Opens (`true`) or closes the Activity panel, clicking only when it differs; waits for the toggle's `aria-expanded`. */
export async function setActivity(page, open) {
  const toggle = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('button', { name: 'Activity', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await toggle.click();
  await page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute('aria-expanded') === String(want), ['[aria-label=Activity] button[aria-expanded]', open]);
}
