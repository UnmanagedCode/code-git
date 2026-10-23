// Recorders for the settled-reads checks: the UI's watchers read git state only once a write op run ended, never
// between its commands (docs/architecture.md → Write op runs). Used by submodules.mjs and remotes.mjs.

/** The watcher reads that must not start while a write runs: the graph's refs, pages and summaries, the Submodules list. */
const WATCHED_READ = /\/api\/ops\/(repo\.summary|graph\.[a-zA-Z]+|submodule\.list)$/;

/**
 * Installs (before any page script) a recorder of every `[role=alert]` that ever appears inside the header or main,
 * and of whether the repository header ever showed the `detached` badge. `read()` → {alerts: string[], detached};
 * `reset()` clears both. Survives reloads (it is an init script).
 */
export async function recordAlerts(page) {
  await page.addInitScript(() => {
    const rec = { alerts: [], detached: false };
    window.__settled = rec;
    const seen = new WeakSet();
    const scan = () => {
      for (const el of document.querySelectorAll('header [role=alert], main [role=alert]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        rec.alerts.push(el.textContent);
      }
      const header = document.querySelector('header[aria-label="Repository summary"]');
      if (header && [...header.querySelectorAll('*')].some((e) => !e.children.length && e.textContent === 'detached')) rec.detached = true;
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role'] });
  });
  return {
    read: () => page.evaluate(() => ({ alerts: [...window.__settled.alerts], detached: window.__settled.detached })),
    reset: () => page.evaluate(() => { window.__settled.alerts = []; window.__settled.detached = false; }),
  };
}

/**
 * Records every watched read (WATCHED_READ) whose request starts while a request whose url matches `writes` is in
 * flight (from its request until it finished or failed). `overlaps` lists them as "read during write".
 */
export function recordReadsDuringWrites(page, writes) {
  const inFlight = new Set();
  const overlaps = [];
  page.on('request', (q) => {
    if (writes.test(q.url())) { inFlight.add(q); return; }
    if (WATCHED_READ.test(q.url()) && inFlight.size) {
      overlaps.push(`${new URL(q.url()).pathname} during ${[...inFlight].map((w) => new URL(w.url()).pathname).join(', ')}`);
    }
  });
  const done = (q) => inFlight.delete(q);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { overlaps };
}
