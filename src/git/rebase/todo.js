import { Refusal } from '../../refusals.js';
import { joinMessage } from '../commit/message.js';
import { REBASE_LIMITS } from '../sequence/limits.js';

// The interactive rebase's todo (docs/merge.md → The scripted editor). Pure. Messages never go through an editor: a row
// that needs a new message is applied as a carrier — a commit with that row's tree, parent and author and the new
// message (carrier.js) — so the todo holds only actions and oids, and the messages live in git's own objects.

const bad = (msg) => new Refusal('BAD_PARAMS', msg);
export const ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
/** Actions that keep their commit and start a chain the squash / fixup rows below meld into. */
const KEEP = new Set(['pick', 'reword', 'edit']);
/** What each action becomes in the todo: a squash is a fixup into a carrier holding the chain's final message. */
const COMMAND = { pick: 'pick', reword: 'pick', edit: 'edit', squash: 'fixup', fixup: 'fixup', drop: 'drop' };

/**
 * A row's message `{summary, description}` → the commit message text. BAD_PARAMS for an empty or multi-line summary, a
 * NUL, or more than REBASE_LIMITS.messageMaxBytes.
 */
export function messageText(m, what) {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) throw bad(`${what}: message must be {summary, description}`);
  for (const k of Object.keys(m)) if (k !== 'summary' && k !== 'description') throw bad(`${what}: message: unknown key ${JSON.stringify(k)}`);
  if (typeof m.summary !== 'string' || !m.summary.trim()) throw bad(`${what}: the summary must be a non-empty string`);
  if (/[\r\n]/.test(m.summary)) throw bad(`${what}: the summary must be one line`);
  if (m.description !== undefined && typeof m.description !== 'string') throw bad(`${what}: the description must be a string`);
  const text = joinMessage(m.summary, m.description ?? '');
  if (text.includes('\0')) throw bad(`${what}: a commit message cannot contain NUL`);
  if (Buffer.byteLength(text) > REBASE_LIMITS.messageMaxBytes) throw bad(`${what}: the message is over ${REBASE_LIMITS.messageMaxBytes} bytes`);
  return text;
}

/**
 * Chains: each kept row (pick, reword, edit) with the squash and fixup rows after it (drop rows do not break a chain:
 * git melds into the last kept commit). A chain needs a message when its head is a reword or it holds a squash.
 * BAD_PARAMS for a squash or fixup with no kept row above it.
 */
export function chains(rows) {
  const out = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (KEEP.has(r.action)) { cur = { head: i, members: [], squash: false }; out.push(cur); return; }
    if (r.action !== 'squash' && r.action !== 'fixup') return;
    if (!cur) throw bad(`row ${i + 1}: a ${r.action} needs a kept commit above it`);
    cur.members.push(i);
    if (r.action === 'squash') cur.squash = true;
  });
  return out.map((c) => ({ ...c, needsMessage: c.squash || rows[c.head].action === 'reword' }));
}

/**
 * `rows` ([{oid, action, message: text | null}], oldest first) → `{lines: [{command, oid, carrier: index | null}],
 * carriers: [{oid, message}]}`: every row once, drops explicit (so `rebase.missingCommitsCheck=error` passes), a squash
 * row as `fixup`, and the head of a chain that needs a message replaced by carrier `carrier` (made from its own commit).
 * BAD_PARAMS: no rows, every row dropped, an unknown action, a squash/fixup with no kept row above, a message on a row
 * that takes none, or none where one is needed.
 */
export function buildTodo(rows) {
  if (!rows.length) throw bad('rows: nothing to rebase');
  rows.forEach((r, i) => { if (!ACTIONS.includes(r.action)) throw bad(`row ${i + 1}: action must be one of ${ACTIONS.join(', ')}`); });
  if (rows.every((r) => r.action === 'drop')) throw bad('every row is dropped: use Reset to move the branch instead');
  const takes = new Set(chains(rows).filter((c) => c.needsMessage).map((c) => c.head));
  rows.forEach((r, i) => {
    if (r.message !== null && !takes.has(i)) throw bad(`row ${i + 1}: a ${r.action} takes no message here`);
    if (r.message === null && takes.has(i)) throw bad(`row ${i + 1}: ${r.action === 'reword' ? 'a reword' : 'a squash chain'} needs its message`);
  });
  const carriers = [];
  const lines = rows.map((r, i) => {
    if (!takes.has(i)) return { command: COMMAND[r.action], oid: r.oid, carrier: null };
    carriers.push({ oid: r.oid, message: r.message });
    return { command: COMMAND[r.action], oid: r.oid, carrier: carriers.length - 1 };
  });
  return { lines, carriers };
}

/** The todo text: each line's command and oid, a carrier's oid (`made[carrier]`) in place of its row's. */
export const renderTodo = (lines, made) => lines.map((l) => `${l.command} ${l.carrier === null ? l.oid : made[l.carrier]}\n`).join('');
