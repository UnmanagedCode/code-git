// The LFS card's deterministic world (separate from the other seeds): temp repos behind the test fake cc (real git and
// the machine's git-lfs), the backend booted against it. The LFS filter config is written into the seed's temp HOME
// (tests/_lfs.js lfsFilters), never the user's.
//
// lfs: a smudge-skipped clone (GIT_LFS_SKIP_SMUDGE=1) of a bare origin whose main tracks `*.bin`: `old.bin` (first
//      commit, deleted by the second) and `a.bin` ("one\n", a pointer in the clone). `absent: true` serves a plain repo
//      with no LFS filter config from a System whose PATH holds only git: no git-lfs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { fakeCc } from '../../tests/_fakeCc.js';
import { bareRemote, bindRepo, hermeticEnv, makeRepo, tempDir } from '../../tests/_git.js';
import { lfsFilters, sha256 } from '../../tests/_lfs.js';

const { bootServer } = await import(BROWSER);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function seedLfs({ absent = false } = {}) {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const cleanup = async () => { for (const fn of cleanups.reverse()) await fn(); };
  let srv;
  try {
    let dir;
    let home;
    if (absent) {
      // A System without git-lfs has no LFS filter config either (git would refuse the required filter it cannot run).
      const plain = makeRepo(t, { name: 'lfs' });
      plain.commit({ 'plain.txt': 'plain\n' }, 'plain');
      ({ dir, home } = plain);
    } else {
      const seed = makeRepo(t, { name: 'seed' });
      lfsFilters(seed.home);
      seed.git('lfs', 'track', '*.bin');
      seed.commit({ 'old.bin': 'old\n' }, 'old');
      fs.rmSync(path.join(seed.dir, 'old.bin'));
      seed.commit({ 'a.bin': 'one\n', 'plain.txt': 'plain\n' }, 'a');
      const origin = bareRemote(seed);
      seed.git('push', '-q', 'origin', 'main');
      seed.git('lfs', 'push', '--all', 'origin');
      dir = path.join(seed.root, 'lfs');
      home = seed.home;
      execFileSync('git', ['clone', '-q', origin.dir, dir], { env: { ...hermeticEnv(home), GIT_LFS_SKIP_SMUDGE: '1' } });
    }
    const repo = bindRepo(dir, home);
    const gitDir = path.join(dir, '.git');
    const cc = await fakeCc({ home, projects: { lfs: { dir, workspace: 'LFS', isGitRepo: true } } });
    cleanups.push(() => cc.close());
    if (absent) {
      const bin = tempDir(t, 'cg-bin-');
      fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));
      cc.state.inheritedEnv = { PATH: bin };
    }
    srv = await bootServer({ cwd: projectRoot, entry: 'server.js', silent: true, env: { CONDUCTOR_URL: cc.url } });
    cleanups.push(() => srv.close());
    const objectPath = (content) => { const oid = sha256(content); return path.join(gitDir, 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4), oid); };
    return { url: srv.url, cc, repo, gitDir, objectPath, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
