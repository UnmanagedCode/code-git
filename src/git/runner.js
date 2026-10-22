import { capStderr } from '../activity/log.js';
import { exec } from '../conductor/exec.js';
import { Refusal } from '../refusals.js';
import { LIMITS } from './limits.js';

// THE choke point: every git command code-git runs goes through runGit.

export const BASE_ARGS = ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false'];

/** Every call: no prompt can hang, an editor launch fails loudly, pathspecs are literal, git's messages are stable. */
export const BASE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_EDITOR: 'false',
  GIT_SEQUENCE_EDITOR: 'false',
  GIT_LITERAL_PATHSPECS: '1',
  LC_ALL: 'C',
};
/** Read ops only: no opportunistic index refresh. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0' };
// Base keys an op's env cannot override.
const PINNED = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE'];

const STATUS_OF = { CANCELLED: 'cancelled', GIT_TIMEOUT: 'timeout' };

/**
 * Runs one git command for an op. `ctx` = {target, op, kind: 'read'|'write', cancellable, signal, opRunId, activity, locks}.
 * Resolves {exitCode, stdout: Buffer, stderr: Buffer, durationMs}; an exit code outside `okExit` throws GIT_FAILED.
 * A write holds its project's lock for the whole command.
 */
export async function runGit(ctx, args, { stdin, env: opEnv = {}, timeoutMs, maxOutputBytes, okExit = [0] } = {}) {
  const { target, kind, activity } = ctx;
  const limits = LIMITS[kind];
  if (!limits) throw new Error(`runGit: unknown kind ${kind}`);
  const argv = ['git', ...BASE_ARGS, ...args];
  const env = { ...BASE_ENV, ...(kind === 'read' ? READ_ENV : {}), ...opEnv };
  for (const k of PINNED) env[k] = BASE_ENV[k];
  const stdinBytes = stdin === undefined ? 0 : Buffer.byteLength(stdin);

  const run = async () => {
    const { entry, signal } = activity.open({
      opRunId: ctx.opRunId, op: ctx.op, target, argv, env: opEnv, stdinBytes, cancellable: ctx.cancellable, signal: ctx.signal,
    });
    let r;
    try {
      r = await exec(target, argv, {
        env, stdin, signal, retry: kind === 'read',
        timeoutMs: timeoutMs ?? limits.timeoutMs, maxOutputBytes: maxOutputBytes ?? limits.maxOutputBytes,
      });
    } catch (e) {
      const code = e instanceof Refusal ? e.code : 'INTERNAL';
      const partial = typeof e?.extra?.stderr === 'string' ? Buffer.from(e.extra.stderr) : undefined;
      activity.close(entry, { status: STATUS_OF[code] ?? (e instanceof Refusal ? 'refused' : 'failed'), code, ...capStderr(partial) });
      throw e;
    }
    const ok = okExit.includes(r.exitCode);
    const err = capStderr(r.stderr);
    activity.close(entry, { status: ok ? 'ok' : 'failed', code: ok ? null : 'GIT_FAILED', exitCode: r.exitCode, durationMs: r.durationMs, ...err });
    if (!ok) throw new Refusal('GIT_FAILED', `git ${args[0]} exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr: err.stderr });
    return r;
  };
  return kind === 'write' ? ctx.locks.run(target.project, run) : run();
}
