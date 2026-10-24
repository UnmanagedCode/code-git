// The git-flow card's deterministic world (separate from the other seeds): a temp repo behind the test fake cc (real
// git), the backend booted against it.
//
// flow: main with two commits (app.txt, notes.txt), no gitflow config, no develop branch. HEAD main, clean. The script
// initializes git-flow and makes every branch through the UI, adding commits with the seed's git between steps.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function seedFlow() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'flow' });
    repo.commit({ 'app.txt': 'app 1\n' }, 'first');
    const base = repo.commit({ 'notes.txt': 'notes\n' }, 'second');
    const cc = await fakeCc({ home: repo.home, projects: { flow: { dir: repo.dir, workspace: 'Flow', isGitRepo: true } } });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return { url: srv.url, cc, repo, base, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
