import { EventEmitter } from 'node:events';
import { LIMITS } from '../git/limits.js';
import { Refusal } from '../refusals.js';

// A diagnostic record of every git command run: what ran, where, and how it ended. Nothing derives
// repo state from it (undo and reflog read git itself); it is in memory and gone on restart.

const SECRET_NAME = /TOKEN|PASS|SECRET|KEY/i;
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Env values as recorded: a secret-looking name's value is redacted. */
export const redactEnv = (env) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k, SECRET_NAME.test(k) ? '[redacted]' : v]));

/** The tail of `buf` (git's verdict comes last), decoded without trusting it to be UTF-8. */
export function capStderr(buf, cap = LIMITS.stderrCap) {
  const b = buf ?? Buffer.alloc(0);
  return { stderr: decoder.decode(b.length > cap ? b.subarray(b.length - cap) : b), stderrTruncated: b.length > cap };
}

/**
 * An in-memory ring of activity entries. Emits `activity` with an entry snapshot on every open and close.
 * Entry status: running → ok | failed | refused | timeout | cancelled.
 */
export function createActivityLog({ ring = LIMITS.activityRing } = {}) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const entries = [];
  const live = new Map(); // id → {entry, controller}, while running
  let nextId = 1;
  let nextRun = 1;
  const snapshot = (e) => ({ ...e, target: { ...e.target }, argv: [...e.argv], env: { ...e.env } });

  return {
    events,
    newRunId: () => `run-${nextRun++}`,
    list: () => entries.map(snapshot),

    /**
     * Records a command about to run. `signal` (the op's) aborts it too. Resolves the entry and the signal the
     * command must run under: aborted by `signal` or by `cancel(id)`.
     */
    open({ opRunId, op, kind, target, argv, env = {}, stdinBytes = 0, cancellable, signal }) {
      const controller = new AbortController();
      const entry = {
        id: nextId++, opRunId, op, kind, target: { project: target.project, worktree: target.worktree ?? null }, argv: [...argv],
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
