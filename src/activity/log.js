import { EventEmitter } from 'node:events';
import { LIMITS } from '../git/limits.js';
import { maskUrl, maskUrls } from '../mask.js';
import { Refusal } from '../refusals.js';

// A diagnostic record of every git command run: what ran, where, and how it ended. Nothing derives
// repo state from it (undo and reflog read git itself); it is in memory and gone on restart.

const SECRET_NAME = /TOKEN|PASS|SECRET|KEY/i;
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Env values as recorded: a secret-looking name's value is redacted. */
export const redactEnv = (env) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k, SECRET_NAME.test(k) ? '[redacted]' : v]));

/** A remote's config keys whose values are urls (maskUrl hides their passwords) or refspecs: recorded. */
const URL_VARS = new Set(['url', 'pushurl', 'fetch']);

/** `git config` options whose value is the next argument (before the key): skipped when looking for the key. */
const CONFIG_VALUE_OPTS = new Set(['--file', '-f', '--blob', '--type', '-t', '--default', '--comment']);

/** The index of the subcommand in a recorded `git …` argv: past git's own options (`-c` / `-C` take a value), or -1. */
function subcommandAt(argv) {
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '-c' || argv[i] === '-C') i++;
    else if (!argv[i].startsWith('-')) return i;
  }
  return -1;
}

/** Subcommands whose arguments are names, urls, refspecs and config values, never prose. */
const VALUE_SUBCOMMANDS = new Set(['remote', 'submodule', 'config', 'ls-remote', 'fetch', 'push', 'pull', 'clone']);

/**
 * Argv as recorded; git itself gets the real argv. A url's password is masked: in git's own options and every argument
 * of a VALUE_SUBCOMMANDS command as a stored value (maskUrl: the whole argument is the url or value); in any other
 * argument (a commit message) as text (maskUrls), so free text keeps its shape. The value of a `git config` write to a
 * remote's other keys (`remote.<name>.<var>`: a proxy, which may be `user:password@host`, a pack command) is replaced by
 * `***`, the key kept: no mask could tell its secret part.
 */
export function redactArgv(argv) {
  const sub = subcommandAt(argv);
  const values = sub === -1 || VALUE_SUBCOMMANDS.has(argv[sub]);
  const out = argv.map((a, i) => (values || i <= sub ? maskUrl(a) : maskUrls(a)));
  if (sub === -1 || argv[sub] !== 'config') return out;
  let key = -1;
  for (let i = sub + 1; i < argv.length && key === -1; i++) {
    if (CONFIG_VALUE_OPTS.has(argv[i])) i++;
    else if (!argv[i].startsWith('-')) key = i;
  }
  const v = /^remote\..+\.([^.]+)$/i.exec(argv[key] ?? '')?.[1]?.toLowerCase();
  if (v === undefined || URL_VARS.has(v)) return out;
  return out.map((a, i) => (i > key ? '***' : a));
}

/** A target as an entry records it: `sub` only when the command ran in a submodule. */
const copyTarget = (t) => ({ project: t.project, worktree: t.worktree ?? null, ...(t.sub ? { sub: [...t.sub] } : {}) });

/** The tail of `buf` (git's verdict comes last), decoded without trusting it to be UTF-8. */
export function capStderr(buf, cap = LIMITS.stderrCap) {
  const b = buf ?? Buffer.alloc(0);
  return { stderr: maskUrls(decoder.decode(b.length > cap ? b.subarray(b.length - cap) : b)), stderrTruncated: b.length > cap };
}

/**
 * An in-memory ring of activity entries. Emits `activity` with an entry snapshot on every open and close.
 * Entry status: running → ok | failed | refused | timeout | cancelled.
 * Beside it, a ring of write op runs (openRun), emitting `run` with a run snapshot when one opens and when it ends.
 */
export function createActivityLog({ ring = LIMITS.activityRing } = {}) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const entries = [];
  const runs = [];
  const live = new Map(); // id → {entry, controller}, while running
  let nextId = 1;
  let nextRun = 1;
  let nextRunRecord = 1;
  const snapshot = (e) => ({ ...e, target: copyTarget(e.target), argv: [...e.argv], env: { ...e.env } });
  const runSnapshot = (r) => ({ ...r, target: copyTarget(r.target) });
  // Over the cap, the oldest *ended* runs go: a running one stays (the UI would read its project as idle mid-write), so
  // the ring exceeds the cap only by the runs still running.
  const trimRuns = () => {
    for (let i = 0, excess = runs.length - ring; excess > 0 && i < runs.length;) {
      if (runs[i].status === 'ended') { runs.splice(i, 1); excess--; } else i++;
    }
  };

  return {
    events,
    newRunId: () => `run-${nextRun++}`,
    list: () => entries.map(snapshot),
    listRuns: () => runs.map(runSnapshot),

    /**
     * Records a write op run starting. `track(promise)` counts one git call of the run until it settles (lock wait
     * included) and passes its outcome through; `end()` (idempotent) says the op returned or threw. The run is `ended`
     * once both hold: no git call of it can still run or start, so a client reading the repo then sees it settled.
     */
    openRun({ opRunId, op, kind, target }) {
      const run = { id: nextRunRecord++, opRunId, op, kind, target: copyTarget(target), status: 'running', startedAt: new Date().toISOString(), endedAt: null };
      runs.push(run);
      trimRuns();
      events.emit('run', runSnapshot(run));
      let pending = 0;
      let ending = false;
      const settle = () => {
        if (!ending || pending || run.status !== 'running') return;
        Object.assign(run, { status: 'ended', endedAt: new Date().toISOString() });
        trimRuns();
        events.emit('run', runSnapshot(run));
      };
      return {
        track(promise) {
          pending++;
          return promise.finally(() => { pending--; settle(); });
        },
        end() { ending = true; settle(); },
      };
    },

    /**
     * Records a command about to run. `signal` (the op's) aborts it too. Resolves the entry and the signal the
     * command must run under: aborted by `signal` or by `cancel(id)`.
     */
    open({ opRunId, op, kind, target, argv, env = {}, stdinBytes = 0, cancellable, signal }) {
      const controller = new AbortController();
      const entry = {
        id: nextId++, opRunId, op, kind, target: copyTarget(target), argv: redactArgv(argv),
        env: redactEnv(env), stdinBytes, cancellable, startedAt: new Date().toISOString(),
        durationMs: null, exitCode: null, stderr: '', stderrTruncated: false, status: 'running', code: null,
      };
      entries.push(entry);
      if (entries.length > ring) entries.splice(0, entries.length - ring);
      live.set(entry.id, { entry, controller });
      events.emit('activity', snapshot(entry));
      return { entry, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal };
    },

    /** Closes a running entry with its outcome; a closed entry is left as it is. */
    close(entry, { status, code = null, exitCode = null, durationMs = null, stderr = '', stderrTruncated = false }) {
      if (entry.status !== 'running') return;
      Object.assign(entry, { status, code, exitCode, durationMs, stderr, stderrTruncated });
      live.delete(entry.id);
      events.emit('activity', snapshot(entry));
    },

    /** Aborts a running cancellable entry's command. */
    cancel(id) {
      const entry = entries.find((e) => e.id === id) ?? live.get(id)?.entry;
      if (!entry) throw new Refusal('ACTIVITY_UNKNOWN', `no activity entry ${id}`);
      if (!entry.cancellable) throw new Refusal('NOT_CANCELLABLE', `${entry.op} cannot be cancelled: aborting it mid-command could leave the repo half-changed`);
      if (entry.status !== 'running') throw new Refusal('NOT_RUNNING', `activity entry ${id} has already finished`);
      live.get(id).controller.abort();
    },
  };
}
