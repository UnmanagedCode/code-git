// The merge/rebase card's deterministic world (separate from the other seeds): temp repos behind the test fake cc (real
// git), the backend booted against it. Each script seeds its own: every one of them changes the repo.
//
// seq: base: app.txt (lines L1…L20), gone.txt, data.bin (binary), notes.md.
//      main: base ← mine (L1 "L1 mine") ← main work (L5, L10, L15 "… main"; gone.txt deleted; data.bin changed).
//      origin (bare) has main: base ← theirs (L1 "L1 theirs"), pushed from another clone and not fetched yet: a
//        rebase pull replays mine onto it and stops on L1 (step 1 of 2).
//      feature/merge: base ← merge one (L5 "L5 merge", gone.txt edited) ← merge two (L15 "L15 merge"): merging it into
//        main stops on two regions of app.txt and on gone.txt (modified there, deleted on main).
//      feature/ff: main ← ff (ff.txt): a fast-forward of main.
//      topic: main ← t1 ← t2 ← t3 ← t4 (t1.txt … t4.txt, one file each): the interactive rebase's commits.
//      picks: base ← p1 ← p2 ← p3 (p1.txt … p3.txt): cherry-picked onto main without conflict.
//      conflict: base ← conflicting change (L10 "L10 conflict"): a cherry-pick of it onto main stops on L10.
//      feature/bin: base ← binary change (data.bin other bytes): merging it into main stops on a binary file.
//      side: base ← side (side.txt): any branch rebases onto it without conflict.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { bareRemote, makeRepo } from '../../tests/_git.js';
import { pushFromElsewhere } from '../../tests/_remotes.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const APP_LINES = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
/** app.txt with line `n` (1-based) replaced, for each [n, text]. */
export const appWith = (...changes) => {
  const lines = [...APP_LINES];
  for (const [n, text] of changes) lines[n - 1] = text;
  return `${lines.join('\n')}\n`;
};
const bin = (seed) => Buffer.from(Array.from({ length: 64 }, (_, i) => (i * seed) % 256));

export async function seedSequence() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'seq' });
    const o = {};
    o.base = repo.commit({ 'app.txt': appWith(), 'gone.txt': 'gone\n', 'data.bin': bin(1), 'notes.md': 'notes\n' }, 'base');
    const origin = bareRemote(repo);
    repo.git('push', '-q', '-u', 'origin', 'main');
    const w = { repo, origin };
    o.theirs = pushFromElsewhere(w, 'main', { 'app.txt': appWith([1, 'L1 theirs']) }, 'theirs');

    repo.branch('feature/merge');
    o.merge1 = repo.commit({ 'app.txt': appWith([5, 'L5 merge']), 'gone.txt': 'gone, edited\n' }, 'merge one');
    o.merge2 = repo.commit({ 'app.txt': appWith([5, 'L5 merge'], [15, 'L15 merge']) }, 'merge two');
    repo.git('checkout', '-q', '-b', 'picks', o.base);
    o.p1 = repo.commit({ 'p1.txt': 'p1\n' }, 'p1');
    o.p2 = repo.commit({ 'p2.txt': 'p2\n' }, 'p2');
    o.p3 = repo.commit({ 'p3.txt': 'p3\n' }, 'p3');
    repo.git('checkout', '-q', '-b', 'conflict', o.base);
    o.conflict = repo.commit({ 'app.txt': appWith([10, 'L10 conflict']) }, 'conflicting change');
    repo.git('checkout', '-q', '-b', 'feature/bin', o.base);
    o.bin = repo.commit({ 'data.bin': bin(3) }, 'binary change');
    repo.git('checkout', '-q', '-b', 'side', o.base);
    o.side = repo.commit({ 'side.txt': 'side\n' }, 'side');

    repo.checkout('main');
    o.mine = repo.commit({ 'app.txt': appWith([1, 'L1 mine']) }, 'mine');
    repo.git('rm', '-q', 'gone.txt');
    o.work = repo.commit({ 'app.txt': appWith([1, 'L1 mine'], [5, 'L5 main'], [10, 'L10 main'], [15, 'L15 main']), 'data.bin': bin(5) }, 'main work');
    repo.branch('feature/ff');
    o.ff = repo.commit({ 'ff.txt': 'ff\n' }, 'ff');
    repo.checkout('main');
    repo.branch('topic');
    for (const n of [1, 2, 3, 4]) o[`t${n}`] = repo.commit({ [`t${n}.txt`]: `t${n}\n` }, `t${n}`);
    repo.checkout('main');

    const cc = await fakeCc({ home: repo.home, projects: { seq: { dir: repo.dir, workspace: 'Sequence', isGitRepo: true } } });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return { url: srv.url, cc, repo, origin, oids: o, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
