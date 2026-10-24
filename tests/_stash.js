import fs from 'node:fs';
import path from 'node:path';
import { hostile, opWorld } from './_ops.js';

// The world the stash op tests share: opWorld with a base commit, under the hostile config.

export const BASE = { 'a.txt': 'a\n', 'b.txt': 'b\n', 'dir/c.txt': 'c\n' };

export async function stashWorld(t, files = BASE) {
  const w = await opWorld(t);
  const base = w.repo.commit(files, 'base');
  hostile(w.repo);
  return { ...w, base };
}

/** The stash list, newest first: [{oid, message}] (message = the reflog subject). */
export const stashList = (w) => w.repo.git('stash', 'list', '--format=%H%x00%gs').split('\n').filter(Boolean)
  .map((l) => { const [oid, message] = l.split('\0'); return { oid, message }; });
export const read = (w, p) => fs.readFileSync(path.join(w.repo.dir, p), 'utf8');
export const exists = (w, p) => fs.existsSync(path.join(w.repo.dir, p));
/** The file at `rev:path`, or null. */
export const blob = (w, spec) => { try { return w.repo.git('show', spec); } catch { return null; } };

/** An empty directory beside the repo, and an untracked symlink `link` in the repo pointing at it. */
export function outsideLink(w, link = 'link') {
  const outside = path.join(w.repo.root, `outside-${link.replaceAll('/', '-')}`);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.dirname(path.join(w.repo.dir, link)), { recursive: true });
  fs.symlinkSync(outside, path.join(w.repo.dir, link));
  return outside;
}

/** The argv of every exec whose git subcommand (after BASE_ARGS) starts with `words`. */
export const runs = (w, ...words) => w.execArgv().filter((a) => {
  const i = a.indexOf('--work-tree=.') + 1;
  return words.every((x, k) => a[i + k] === x);
});

/**
 * `runs` limited to the real index: the execs from `from` on (an index into the exec log) that set no GIT_INDEX_FILE —
 * the undo snapshots' temporary-index commands (src/git/stash/snapshot.js) left out.
 */
export const realIndexRuns = (w, from, ...words) => w.cc.state.execCalls.slice(from).filter((b) => !b.env?.GIT_INDEX_FILE).map((b) => b.argv).filter((a) => {
  const i = a.indexOf('--work-tree=.') + 1;
  return words.every((x, k) => a[i + k] === x);
});
