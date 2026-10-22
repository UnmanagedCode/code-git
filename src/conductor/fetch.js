import { Refusal } from '../refusals.js';

// What a cc restart or a dropped connection raises; nothing reached cc's handler, so a read may be repeated.
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET']);
// Waits before the second and third attempt.
export const RETRY_DELAYS_MS = [50, 150];

const isConnection = (e) => CONNECTION_CODES.has(e?.cause?.code ?? e?.code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP exchange with cc at `$CONDUCTOR_URL` (read per call). Each attempt gets its own `timeoutMs` deadline.
 * `signal` aborts the request (cc then kills an exec); an abort throws CANCELLED.
 * `retry: true` repeats a connection failure (never a timeout or an HTTP answer) up to RETRY_DELAYS_MS.length times.
 * Resolves {res, text}; a transport failure or missing CONDUCTOR_URL throws CONDUCTOR_UNAVAILABLE.
 */
export async function ccFetch(path, { method = 'GET', headers, body } = {}, { timeoutMs, signal, retry = false }) {
  const base = process.env.CONDUCTOR_URL;
  if (!base) throw new Refusal('CONDUCTOR_UNAVAILABLE', 'CONDUCTOR_URL is not set: run code-git inside code-conductor');
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Refusal('CANCELLED', 'cancelled');
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    try {
      const res = await fetch(base + path, { method, headers, body, signal: AbortSignal.any(signals) });
      return { res, text: await res.text() };
    } catch (e) {
      if (signal?.aborted) throw new Refusal('CANCELLED', 'cancelled');
      if (retry && isConnection(e) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      const cause = e?.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : (e?.cause?.code ?? e?.message);
      throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor ${method} ${path}: ${cause}`);
    }
  }
}

/** Parses a cc answer as JSON; null when it is not JSON. */
export function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
