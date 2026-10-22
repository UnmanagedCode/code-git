import { LIMITS } from '../git/limits.js';
import { Refusal } from '../refusals.js';
import { ccFetch, parseJson } from './fetch.js';

// cc's REST reads code-git consumes. Each resolves cc's JSON array or throws a Refusal.
async function getArray(path) {
  const { res, text } = await ccFetch(path, {}, { timeoutMs: LIMITS.ccReadTimeoutMs, retry: true });
  const body = parseJson(text);
  if (res.status === 200 && Array.isArray(body)) return body;
  if (res.status === 404 && body?.code === 'PROJECT_UNKNOWN') throw new Refusal('PROJECT_UNKNOWN', String(body.error ?? 'unknown project'));
  throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor GET ${path}: HTTP ${res.status}${body?.code ? ` ${body.code}` : ''}`);
}

/** cc's `GET /api/projects`: every project row with its System and git facts. */
export const projects = () => getArray('/api/projects');

/** cc's `GET /api/projects/:name/worktrees`. */
export const worktrees = (project) => getArray(`/api/projects/${encodeURIComponent(project)}/worktrees`);
