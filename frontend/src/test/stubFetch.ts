import { vi } from 'vitest';
import { json } from './fixtures';

type Responder = Response | unknown | ((url: URL, init?: RequestInit) => Response | unknown | Promise<Response | unknown>);
export interface Call { method: string; url: URL; body: unknown; headers: Record<string, string> }

/**
 * Stubs global fetch with a route table keyed "METHOD path" (relative path, no query). A non-Response responder is
 * sent as a 200 JSON body. An unmatched request fails the test loudly.
 */
export function stubFetch(routes: Record<string, Responder>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    const url = new URL(raw, 'http://x/');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    if (raw.startsWith('/')) throw new Error(`root-relative request: ${raw}`);
    const key = `${method} ${url.pathname.replace(/^\//, '')}`;
    if (!(key in routes)) throw new Error(`unstubbed request: ${key}`);
    const r = routes[key];
    const v = typeof r === 'function' ? await (r as (u: URL, i?: RequestInit) => unknown)(url, init) : r;
    return v instanceof Response ? v : json(v);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url.pathname.replace(/^\//, '')}` === key).length };
}
