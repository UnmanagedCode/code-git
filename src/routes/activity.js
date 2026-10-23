import { route } from '../http/route.js';

export const HEARTBEAT_MS = 25_000;

export function mount(router, { activity }) {
  router.get('/activity', route(async (_req, res) => {
    res.json({ entries: activity.list(), runs: activity.listRuns() });
  }));

  // Server-sent events: `event: activity` with the entry on every open and close; `event: run` with a write op run
  // when it opens and when it ends.
  router.get('/activity/events', (req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const send = (entry) => res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
    const sendRun = (run) => res.write(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    activity.events.on('activity', send);
    activity.events.on('run', sendRun);
    const stop = () => { clearInterval(beat); activity.events.off('activity', send); activity.events.off('run', sendRun); };
    req.on('error', stop);
    res.on('error', stop);
    res.on('close', stop);
  });

  router.post('/activity/:id/cancel', route(async (req, res) => {
    activity.cancel(Number(req.params.id));
    res.json({ ok: true });
  }));
}
