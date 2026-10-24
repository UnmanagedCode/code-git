import { capStderr } from '../activity/log.js';
import { exec } from '../conductor/exec.js';
import { Refusal } from '../refusals.js';
import { LIMITS } from './limits.js';

// THE choke point: every git command code-git runs goes through runGit.

/**
 * Before every subcommand. `--work-tree=.` pins the working tree to the checkout cc runs the command in, so a repo's
 * `core.worktree` cannot redirect reads, staging, discards or restores to another directory. It resolves against the
 * final directory, after the `-C <subpath>` of subArgs. A bare repository would
 * then look like a working tree of its own files: `repo.summary` and every write first check whether the git dir is
 * the working tree itself (`rev-parse --git-dir` printing `.`; never the repo's own `core.bare`: src/git/worktree.js).
 * `submodule.recurse=false`: a repo setting it true would make restore/checkout/reset recurse into submodules, so
 * discarding a submodule row would throw away the submodule's own uncommitted work. `submodule update` passes
 * `--recursive` explicitly, the only command that recurses.
 */
export const BASE_ARGS = [
  '--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '--work-tree=.',
];

/**
 * After BASE_ARGS, for a target inside a submodule: run in the submodule's directory, its `.git` (a gitfile) named
 * explicitly. Without `--git-dir`, git would walk up from a submodule that is not cloned yet to the parent repository and,
 * under `--work-tree=.`, treat the submodule's directory as the parent's working tree — writes would land in the
 * parent's index. With it, such a target exits 128 ("not a git repository").
 */
export const subArgs = (target) => (target.sub ? ['-C', target.sub.join('/'), '--git-dir=.git'] : []);

/**
 * git's trace and trace2 output, off over the System's own environment (and over trace2's `trace2.*Target` config, which
 * the environment beats): it can print a url's userinfo without its scheme, where no mask finds it — GIT_TRACE's
 * `run_command: ssh … user:password@host`, trace2's `child_start` of the same (trace2 redacts only `scheme://` urls),
 * a `def_param` of a config url — or request headers. Each switch `0`; trace2's lists of config values and env vars to
 * log empty; both redactions forced on in case a target is reached anyway.
 */
const TRACE_OFF = {
  ...Object.fromEntries(['GIT_TRACE', 'GIT_TRACE_PACKET', 'GIT_TRACE_CURL', 'GIT_CURL_VERBOSE', 'GIT_TRACE_PERFORMANCE', 'GIT_TRACE_SETUP',
    'GIT_TRACE_SHALLOW', 'GIT_TRACE_PACK_ACCESS', 'GIT_TRACE_REFS', 'GIT_TRACE_FSMONITOR', 'GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'].map((n) => [n, '0'])),
  GIT_TRACE2_CONFIG_PARAMS: '',
  GIT_TRACE2_ENV_VARS: '',
  GIT_TRACE_REDACT: '1',
  GIT_TRACE2_REDACT: '1',
};

/**
 * Every call: no prompt can hang, an editor launch fails loudly, pathspecs are literal, git's messages are stable, and
 * no trace output prints a credential (TRACE_OFF).
 */
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
  ...TRACE_OFF,
};
/** Read ops only: no opportunistic index refresh. */
export const READ_ENV = { GIT_OPTIONAL_LOCKS: '0' };
/**
 * Names an op's env may not set: prompts and the programs git runs to ask for credentials (GIT_ASKPASS, SSH_ASKPASS and
 * SSH_ASKPASS_REQUIRE, which BASE_ENV sets —
 * git runs them even with GIT_TERMINAL_PROMPT=0), literal pathspecs, which repo and which git binary run, the trace
 * switches (TRACE_OFF), and the
 * prefixes PROTECTED_ENV_PREFIXES: every GIT_SSH* (GIT_SSH, GIT_SSH_COMMAND, GIT_SSH_VARIANT, …) and every config
 * injection GIT_CONFIG* (COUNT/KEY_n/VALUE_n, GLOBAL, SYSTEM, NOSYSTEM, PARAMETERS).
 * The editors stay settable: interactive rebase supplies its todo through GIT_SEQUENCE_EDITOR.
 */
export const PROTECTED_ENV = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_ASKPASS', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'GIT_LITERAL_PATHSPECS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_EXEC_PATH', ...Object.keys(TRACE_OFF)];
export const PROTECTED_ENV_PREFIXES = ['GIT_SSH', 'GIT_CONFIG'];
export const isProtectedEnv = (name) => PROTECTED_ENV.includes(name) || PROTECTED_ENV_PREFIXES.some((p) => name.startsWith(p));

const STATUS_OF = { CANCELLED: 'cancelled', GIT_TIMEOUT: 'timeout' };

/** The subcommand of an op's `args`, past any leading `-c <key=value>` pairs (netRun's, a pull's config overrides). */
export function subcommandOf(args) {
  let i = 0;
  while (args[i] === '-c') i += 2;
  return args[i];
}

/**
 * Runs one git command for an op, in `ctx.target` (subArgs for a submodule). `ctx` = {target, op, kind: 'read'|'write', cancellable, signal, opRunId, activity, locks}.
 * Resolves {exitCode, stdout: Buffer, stderr: Buffer, durationMs}; an exit code outside `okExit` throws GIT_FAILED.
 * A write holds its project's lock for the whole command (a submodule's too: its pointer is the project's state). An op env naming a protected variable (isProtectedEnv) throws.
 */
export async function runGit(ctx, args, { stdin, env: opEnv = {}, timeoutMs, maxOutputBytes, okExit = [0] } = {}) {
  const { target, kind, activity } = ctx;
  const limits = LIMITS[kind];
  if (!limits) throw new Error(`runGit: unknown kind ${kind}`);
  // An op setting a protected name is a code-git bug: refuse before anything runs.
  const forbidden = Object.keys(opEnv).filter(isProtectedEnv);
  if (forbidden.length) throw new Error(`runGit: ${ctx.op} may not set ${forbidden.join(', ')}`);
  const argv = ['git', ...BASE_ARGS, ...subArgs(target), ...args];
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
    if (!ok) throw new Refusal('GIT_FAILED', `git ${subcommandOf(args)} exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr: err.stderr });
    return r;
  };
  return kind === 'write' ? ctx.locks.run(target.project, run) : run();
}
