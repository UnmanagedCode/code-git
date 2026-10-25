// Waits for the toast an action shows, for the harness scripts that check one after each step.

/** Runs `action` and waits for a toast reading `text` (exact when a string) that was not on screen before it. sonner
 *  keeps earlier toasts (an identical one too) for their lifetime, lists the newest first and then removes them: a
 *  count or an index cannot tell the new one. */
export async function toasted(page, text, action) {
  await page.locator('[data-sonner-toast]').evaluateAll((els) => { for (const e of els) e.setAttribute('data-seen', ''); });
  await action();
  const fresh = page.locator('[data-sonner-toast]:not([data-seen])');
  await (typeof text === 'string' ? fresh.getByText(text, { exact: true }) : fresh.getByText(text)).waitFor();
}
