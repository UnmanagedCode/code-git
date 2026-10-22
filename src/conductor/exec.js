import { Refusal } from '../refusals.js';
import { ccFetch, parseJson } from './fetch.js';

// cc's caps on POST /api/exec (same names in cc's src/hostExec.ts). The plugin's defaults (src/git/limits.js) stay within them.
export const CC_EXEC_CAPS = {
  EXEC_MAX_TIMEOUT_MS: 600_000,
  EXEC_MAX_OUTPUT_BYTES: 128 * 1024 * 1024,
  EXEC_BODY_LIMIT: 16 * 1024 * 1024,
};

// cc's codes for "the System behind this project cannot be asked".
const UNREACHABLE = new Set(['SYSTEMS_UNAVAILABLE', 'SYSTEM_NOT_REGISTERED', 'SYSTEM_NO_PROVIDER', 'SYSTEM_NO_REMOTES', 'SYSTEM_UNREACHABLE', 'REMOTE_NOT_FOUND']);

const b64 = (s) => Buffer.from(typeof s === 'string' ? s : '', 'base64');

/**
 * Runs `argv` in a cc project's checkout through cc's `POST /api/exec`, form A only: `target` is
 * `{project, worktree}` (worktree null = the main checkout), so the System is always the project's own.
 * Resolves {exitCode, stdout: Buffer, stderr: Buffer, durationMs} whatever the exit code; every cc refusal
 * becomes a code-git Refusal (docs/protocol.md → "cc routes consumed"). `retry` lets a connection failure be repeated: reads only.
 */
export async function exec(target, argv, { env, stdin, timeoutMs, maxOutputBytes, signal, retry = false }) {
  const body = {
    project: target.project,
    ...(target.worktree ? { worktree: target.worktree } : {}),
    argv,
    ...(env ? { env } : {}),
    ...(stdin !== undefined ? { stdinB64: Buffer.from(stdin).toString('base64') } : {}),
    encoding: 'base64',
    timeoutMs,
    maxOutputBytes,
  };
  // Past cc's own deadline, so cc reports EXEC_TIMEOUT first.
  const { res, text } = await ccFetch('/api/exec', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { timeoutMs: timeoutMs + Math.min(10_000, timeoutMs), signal, retry });
  const out = parseJson(text);
  if (!out || typeof out !== 'object') throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor /api/exec: HTTP ${res.status} with a non-JSON body`);
  if (res.status === 200) return { exitCode: out.exitCode, stdout: b64(out.stdout), stderr: b64(out.stderr), durationMs: out.durationMs ?? null };
  const where = target.worktree ? `${target.project}/${target.worktree}` : target.project;
  const code = out.code;
  if (code === 'PROJECT_UNKNOWN' || code === 'WORKTREE_UNKNOWN') throw new Refusal(code, String(out.error ?? code));
  if (UNREACHABLE.has(code)) throw new Refusal('SYSTEM_UNREACHABLE', `the System of ${where} is unreachable`, { detail: code });
  if (code === 'EXEC_TIMEOUT') {
    throw new Refusal('GIT_TIMEOUT', `git did not finish within ${timeoutMs} ms in ${where}`, { stderr: b64(out.stderr).toString('utf8') });
  }
  if (code === 'EXEC_OUTPUT_TOO_LARGE') throw new Refusal('OUTPUT_TOO_LARGE', `git output exceeded ${out.limitBytes} bytes`, { limitBytes: out.limitBytes });
  if (code === 'EXEC_SPAWN_FAILED') throw new Refusal('GIT_UNAVAILABLE', `git could not start in ${where}`, { errno: out.errno ?? null });
  if (res.status === 404 && !code) throw new Refusal('CONDUCTOR_UNAVAILABLE', 'this code-conductor does not serve POST /api/exec');
  // INVALID_ARGUMENT, or anything cc is not documented to answer: a code-git bug.
  console.error(`code-git: /api/exec answered HTTP ${res.status} ${code ?? ''}: ${out.error ?? ''}`);
  throw new Refusal('INTERNAL', `code-conductor refused the exec request (${code ?? `HTTP ${res.status}`})`);
}
