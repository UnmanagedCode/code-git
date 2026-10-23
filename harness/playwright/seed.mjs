// One deterministic world for the visual harness: temp repos behind a fake cc (which runs real git), and the backend
// booted against it. Reuses the backend test helpers, so there is one implementation of the fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { diffRepo } from '../../tests/_diffRepo.js';
import { bareRemote, makeRepo } from '../../tests/_git.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The `stage` project's src/app.js: committed, and as edited in the worktree (line 3 changed; line 25 changed + a line added). */
export const STAGE_BASE = Array.from({ length: 30 }, (_, i) => `const l${i + 1} = ${i + 1};`);
export const STAGE_EDITED = STAGE_BASE.flatMap((l, i) => (i === 2 ? ['const l3 = 300;'] : i === 24 ? ['const l25 = 2500;', 'const extra = true;'] : [l]));

export async function seed() {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    // app: main ahead 2 / behind 1 of a bare origin, with staged, unstaged and untracked changes; a `feat` worktree.
    const app = makeRepo(t, { name: 'app' });
    bareRemote(app);
    app.commit({ 'README.md': '# app\n', 'src/a.js': 'a\n' }, 'initial');
    app.git('push', '-q', '-u', 'origin', 'main');
    app.branch('tmp');
    app.commit({ 'theirs.txt': 'upstream change\n' }, 'upstream');
    app.git('push', '-q', 'origin', 'tmp:main');
    app.checkout('main');
    app.git('branch', '-q', '-D', 'tmp');
    app.commit({ 'src/b.js': 'b\n' }, 'local 1');
    app.commit({ 'src/c.js': 'c\n' }, 'local 2');
    app.write('src/a.js', 'staged\n');
    app.git('add', 'src/a.js');
    app.write('src/b.js', 'unstaged\n');
    app.write('notes.txt', 'untracked\n');
    const feat = app.worktreeAdd(path.join(app.root, 'feat'), 'feature/login');
    feat.commit({ 'login.js': 'login\n' }, 'login');

    // diffs: every diff source and file state, under a hostile .git/config (tests/_diffRepo.js).
    const diffs = diffRepo(t);

    // stage: the staging path (staging.mjs). src/app.js has two separate changes (hunks), plus an untracked file, a
    // deleted file, and a commit template.
    const stage = makeRepo(t, { name: 'stage' });
    stage.commit({ 'src/app.js': STAGE_BASE.join('\n') + '\n', 'old.txt': 'old\n' }, 'initial');
    stage.write('src/app.js', STAGE_EDITED.join('\n') + '\n');
    stage.write('notes.md', '# notes\n');
    fs.rmSync(path.join(stage.dir, 'old.txt'));
    const template = path.join(stage.root, 'gitmessage');
    fs.writeFileSync(template, '# Summary in the imperative\nfeat:\n\n# Why?\n');
    stage.git('config', 'commit.template', template);

    // stash: the stash path (stash.mjs). Two stashes made beforehand ("earlier experiment": README.md + an untracked
    // scratch/notes.txt; "docs draft": docs/guide.md), then src/app.js with two unstaged hunks, a staged lib/util.js and
    // an untracked todo.txt.
    const stash = makeRepo(t, { name: 'stash' });
    stash.commit({
      'src/app.js': STAGE_BASE.join('\n') + '\n', 'README.md': '# stash demo\n', 'docs/guide.md': '# Guide\n', 'lib/util.js': 'export const util = 1;\n',
    }, 'initial');
    stash.write('README.md', '# stash demo\n\nAn earlier experiment.\n');
    stash.write('scratch/notes.txt', 'scratch\n');
    stash.git('stash', 'push', '-q', '-u', '-m', 'earlier experiment');
    stash.write('docs/guide.md', '# Guide\n\nA draft section.\n');
    stash.git('stash', 'push', '-q', '-m', 'docs draft');
    stash.write('src/app.js', STAGE_EDITED.join('\n') + '\n');
    stash.write('lib/util.js', 'export const util = 2;\n');
    stash.git('add', 'lib/util.js');
    stash.write('todo.txt', 'todo\n');

    // detached: HEAD detached at the second commit.
    const detached = makeRepo(t, { name: 'detached' });
    detached.commit({ 'a.txt': 'a\n' }, 'one');
    detached.commit({ 'a.txt': 'b\n' }, 'two');
    detached.git('checkout', '-q', '--detach');
    detached.write('a.txt', 'c\n');

    const plain = path.join(app.root, 'plain');
    fs.mkdirSync(plain);
    const cc = await fakeCc({
      home: app.home,
      projects: {
        app: { dir: app.dir, workspace: 'Web', isGitRepo: true, worktrees: { feat: feat.dir }, locked: ['feat'] },
        box: { dir: app.dir, workspace: 'Web', system: 'docker', remoteId: 'cc-box', isGitRepo: true },
        plain: { dir: plain, workspace: 'Web', isGitRepo: false },
        gone: { dir: '/nowhere', workspace: 'Ops', systemUnreachable: "system 'ssh' (build-01) could not be reached: connection refused" },
        notes: { dir: plain, workspace: null, isGitRepo: true },
        diffs: { dir: diffs.repo.dir, workspace: 'Web', isGitRepo: true },
        stage: { dir: stage.dir, workspace: 'Web', isGitRepo: true },
        stash: { dir: stash.dir, workspace: 'Web', isGitRepo: true },
        detached: { dir: detached.dir, workspace: 'Web', isGitRepo: true },
      },
    });
    cleanups.push(() => cc.close());
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    return {
      url: srv.url,
      diffs,
      stage,
      stash,
      /** While on, every exec is held by the fake cc (until cancelled or released). */
      hold(on) { cc.state.execHook = on ? () => 'hold' : null; },
      nextHeld: () => cc.nextHeld(),
      close: cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
