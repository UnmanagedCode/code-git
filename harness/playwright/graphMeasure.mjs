// The scroll measurement shared by graph-perf.mjs (seeded) and live-graph.mjs (read-only, live cc).

/** Opens `url` and scrolls the commit list to the end of the snapshot; resolves the raw samples. */
export async function measureScroll(page, url, { stepPx = 600, timeoutMs = 180_000 } = {}) {
  const pages = [];
  page.on('requestfinished', (r) => {
    if (r.url().endsWith('api/ops/graph.page')) pages.push(Math.round(r.timing().responseEnd));
  });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(url);
  await page.locator('[data-row-id]').first().waitFor({ timeout: 60_000 });
  const samples = await page.evaluate(({ stepPx, timeoutMs }) => new Promise((resolve, reject) => {
    const list = document.querySelector('[role=listbox][aria-label=Commits]');
    const root = document.querySelector('[data-graph-root]');
    const frames = [];
    const rows = [];
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      rows.push(document.querySelectorAll('[data-row-id]').length);
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
      if (atEnd && !root.hasAttribute('data-more')) return resolve({ frames, rows, loaded: Number(root.getAttribute('data-loaded')), listHeight: list.clientHeight });
      if (now - started > timeoutMs) return reject(new Error(`not at the end after ${timeoutMs} ms (${root.getAttribute('data-loaded')} loaded)`));
      list.scrollTop += atEnd ? 0 : stepPx;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { stepPx, timeoutMs });
  const longTasks = await page.evaluate(() => window.__longTasks);
  return { ...samples, pages, longTasks };
}

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};
const stats = (xs) => ({ count: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: xs.length ? Math.round(Math.max(...xs) * 10) / 10 : 0 });

/** The printed report: rows, round trips, long tasks, frame times, and cc's own durations of the graph.page commands. */
export function summarize(m, entries) {
  return {
    loaded: m.loaded,
    maxRows: Math.max(...m.rows),
    listHeightPx: m.listHeight,
    pageRoundTripMs: stats(m.pages),
    longTaskMs: stats(m.longTasks),
    frameMs: stats(m.frames.slice(1)),
    ccGraphPageMs: stats(entries.filter((e) => e.op === 'graph.page' && e.durationMs !== null).map((e) => e.durationMs)),
  };
}
