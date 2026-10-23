// The history / undo card's deterministic world (separate from the other seeds): temp repos behind the test fake cc
// (real git), the backend booted against it.
//
// hist: docs/intro.md written by Ann → edited by Bob → renamed docs/guide.md (Cy) → edited by Ann → renamed
//       guide.md at the root (Bob); big.txt, 1500 lines, its halves by Ann and Cy (blame pages at 1000 lines);
//       a branch `side` whose commit conflicts with main on conflict.txt (its cherry-pick stops); reflog activity
//       (checkouts of side and back, a reset and back); a bare origin with main pushed up to `pushed`; one commit
//       after that, not pushed; a subject holding markup. HEAD main, clean.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { bareRemote, makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const XSS_SUBJECT = 'tweak <img src=x onerror=alert(1)>';
export const AUTHORS = { ann: ['Ann Author', 'ann@example.com'], bob: ['Bob Builder', 'bob@example.com'], cy: ['Cy Coder', 'cy@example.com'] };
export const BIG_LINES = 1500;

export async function seedHistory() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    const repo = makeRepo(t, { name: 'hist' });
    const as = (who, files, msg) => {
      for (const [rel, content] of Object.entries(files)) repo.write(rel, content);
      repo.git('add', '-A');
      const [name, email] = AUTHORS[who];
      repo.git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', msg);
      return repo.git('rev-parse', 'HEAD');
    };
    const big = (from, to, who) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i} by ${who}`).join('\n');
    const o = {};
    o.intro = as('ann', { 'docs/intro.md': 'Intro\n\nFirst words.\n', 'conflict.txt': 'base\n', 'big.txt': `${big(1, BIG_LINES, 'ann')}\n` }, 'add the intro');
    o.edit1 = as('bob', { 'docs/intro.md': 'Intro\n\nFirst words, edited by Bob.\n' }, 'edit the intro');
    repo.git('mv', 'docs/intro.md', 'docs/guide.md');
    o.rename1 = as('cy', {}, 'rename intro to guide');
    o.edit2 = as('ann', { 'docs/guide.md': 'Guide\n\nFirst words, edited by Bob.\nMore from Ann.\n' }, XSS_SUBJECT);
    o.bigCy = as('cy', { 'big.txt': `${big(1, 750, 'ann')}\n${big(751, BIG_LINES, 'cy')}\n` }, 'the second half of big.txt');
    repo.git('mv', 'docs/guide.md', 'guide.md');
    o.rename2 = as('bob', {}, 'move the guide to the root');
    bareRemote(repo);
    repo.git('push', '-q', '-u', 'origin', 'main');
    o.pushed = o.rename2;
    repo.git('checkout', '-q', '-b', 'side', o.intro);
    o.side = as('cy', { 'conflict.txt': 'side\n' }, 'side change');
    repo.git('checkout', '-q', 'main');
    o.local = as('ann', { 'conflict.txt': 'main\n' }, 'local change');
    repo.git('reset', '-q', '--hard', 'HEAD~1');
    repo.git('reset', '-q', '--hard', o.local);

    const cc = await fakeCc({ home: repo.home, projects: { hist: { dir: repo.dir, workspace: 'History', isGitRepo: true } } });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return { url: srv.url, cc, repo, oids: o, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
