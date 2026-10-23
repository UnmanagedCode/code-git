import { capStderr } from '../activity/log.js';
import { exec } from '../conductor/exec.js';
import { Refusal } from '../refusals.js';
import { LIMITS } from './limits.js';

// THE choke point: every git command code-git runs goes through runGit.

/**
 * Before every subcommand. `--work-tree=.` pins the working tree to the checkout cc runs the command in, so a repo's
 * `core.worktree` cannot redirect reads, staging, discards or restores to another directory. It resolves against the
 * final directory, after any `-C <subpath>` an op adds (the submodule card relies on that). A bare repository would
 * then look like a working tree of its own files: `repo.summary` and every write first check whether the git dir is
 * the working tree itself (`rev-parse --git-dir` printing `.`; never the repo's own `core.bare`: src/git/worktree.js).
 * `submodule.recurse=false`: a repo setting it true would make restore/checkout/reset recurse into submodules, so
 * discarding a submodule row would throw away the submodule's own uncommitted work. The submodule card passes
 * `--recurse-submodules` explicitly where it wants recursion.
 */
export const BASE_ARGS = [
  '--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '--work-tree=.',
];

/** Every call: no prompt can hang, an editor launch fails loudly, pathspecs are literal, git's messages are stable. */
export const BASE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  // The System's own environment (cc's local provider merges it) may name an askpass program; git would run it
  // despite GIT_TERMINAL_PROMPT=0 and a push would wait on it until its timeout. `false` fails the ask at once.
  GIT_ASKPASS: 'false',
  SSH_ASKPASS: 'false',
  SSH_ASKPASS_REQUIRE: 'never',
  GIT_EDITOR: 'false',
  GIT_SEQUENCE_EDITOR: 'false',
  GIT_LITERAL_PATHSPECS: '1',
  LC_ALL: 'C',
};
/** Read ops only: no opportunistic index refresh. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0' };
/**
 * Names an op's env may not set: prompts and the programs git runs to ask for credentials (GIT_ASKPASS, SSH_ASKPASS and
 * SSH_ASKPASS_REQUIRE, which BASE_ENV sets —
 * git runs them even with GIT_TERMINAL_PROMPT=0), literal pathspecs, which repo and which git binary run, and the
 * prefixes PROTECTED_ENV_PREFIXES: every GIT_SSH* (GIT_SSH, GIT_SSH_COMMAND, GIT_SSH_VARIANT, …) and every config
 * injection GIT_CONFIG* (COUNT/KEY_n/VALUE_n, GLOBAL, SYSTEM, NOSYSTEM, PARAMETERS).
 * The editors stay settable: interactive rebase supplies its todo through GIT_SEQUENCE_EDITOR.
 */
export const PROTECTED_ENV = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_ASKPASS', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'GIT_LITERAL_PATHSPECS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_EXEC_PATH'];
export const PROTECTED_ENV_PREFIXES = ['GIT_SSH', 'GIT_CONFIG'];
export const isProtectedEnv = (name) => PROTECTED_ENV.includes(name) || PROTECTED_ENV_PREFIXES.some((p) => name.startsWith(p));

const STATUS_OF = { CANCELLED: 'cancelled', GIT_TIMEOUT: 'timeout' };

/**
 * Runs one git command for an op. `ctx` = {target, op, kind: 'read'|'write', cancellable, signal, opRunId, activity, locks}.
 * Resolves {exitCode, stdout: Buffer, stderr: Buffer, durationMs}; an exit code outside `okExit` throws GIT_FAILED.
 * A write holds its project's lock for the whole command. An op env naming a protected variable (isProtectedEnv) throws.
 */
export async function runGit(ctx, args, { stdin, env: opEnv = {}, timeoutMs, maxOutputBytes, okExit = [0] } = {}) {
  const { target, kind, activity } = ctx;
  const limits = LIMITS[kind];
  if (!limits) throw new Error(`runGit: unknown kind ${kind}`);
  // An op setting a protected name is a code-git bug: refuse before anything runs.
  const forbidden = Object.keys(opEnv).filter(isProtectedEnv);
  if (forbidden.length) throw new Error(`runGit: ${ctx.op} may not set ${forbidden.join(', ')}`);
  const argv = ['git', ...BASE_ARGS, ...args];
  const env = { ...BASE_ENV, ...(kind === 'read' ? READ_ENV : {}), ...opEnv };
  const stdinBytes = stdin === undefined ? 0 : Buffer.byteLength(stdin);

  const run = async () => {
    const { entry, signal } = activity.open({
      opRunId: ctx.opRunId, op: ctx.op, kind, target, argv, env: opEnv, stdinBytes, cancellable: ctx.cancellable, signal: ctx.signal,
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
