/** A failed request: the HTTP status, the backend's `{error, code}` when it sent them, and the parsed body. Status 0 is a request that never got a response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** A JSON request to this plugin's own backend. `path` is relative: a `/`-led path would reach cc's API. A body is sent as JSON. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  if (path.startsWith('/')) throw new Error(`api('${path}'): root-relative, so it would reach cc, not this plugin`);
  const method = init?.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal: init?.signal,
      // The backend refuses a state-changing request that is not JSON (cross-site requests cannot send it).
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(init?.body ?? {}),
    });
  } catch (e) {
    throw new ApiError(0, `unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const body: { error?: unknown; code?: unknown } | null = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`,
      typeof body?.code === 'string' ? body.code : undefined,
      body ?? undefined,
    );
  }
  return (await res.json()) as T;
}
