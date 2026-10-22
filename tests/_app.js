import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server.js';

/** Boots the backend on a free loopback port with an empty dist dir unless given; closed after the test. */
export async function startApp(t, opts = {}) {
  const distDir = opts.distDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dist-'));
  const server = await start({ port: 0, ...opts, distDir });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    if (!opts.distDir) fs.rmSync(distDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  /** A JSON request; resolves {status, headers, body} (body parsed when JSON, else text). */
  const call = async (method, p, body, { headers, signal } = {}) => {
    const res = await fetch(url + p, {
      method, signal,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, body: parsed };
  };
  return { server, url, call, distDir };
}

/** Subscribes to an SSE stream; `next(pred)` resolves the next `{event, data}` matching pred. */
export async function sse(url, t) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  t.after(() => controller.abort());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const queue = [];
  const pump = async () => {
    for (;;) {
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = { event: null, data: null };
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) ev.event = line.slice(7);
          if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
        }
        if (ev.event) queue.push(ev);
        if (ev.event) return;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE stream ended');
      buf += decoder.decode(value, { stream: true });
    }
  };
  return {
    res,
    async next(pred = () => true) {
      for (;;) {
        while (queue.length) {
          const ev = queue.shift();
          if (pred(ev)) return ev;
        }
        await pump();
      }
    },
  };
}
