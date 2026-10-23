import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OPS } from '../src/git/ops/index.js';
import { startApp } from './_app.js';
import { fakeCc } from './_fakeCc.js';
import { hermeticEnv, makeRepo } from './_git.js';

// The world the submodule tests share: a parent repo `repo` with submodule `libA` (a local bare `libA.git`), itself with
// submodule `libB` (`libB.git`) when `nested`; both cloned. Fixture commands allow the file transport per command; the
// test System's global config (hermeticEnv) allows it too unless `allowFile: false` — the System user's choice, which
// the product honours and never makes itself. Ops run over HTTP (startApp), so the route's preflight runs as in
// production.

export const PROJECT = 'repo';
const FILE_OK = ['-c', 'protocol.file.allow=always'];
/** The test System's global gitconfig without the file-transport opt-in. */
const GLOBAL_NO_FILE = '[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n';

/**
 * `opts`: `nested` (default true), `populated` (default true: `submodule update --init --recursive` ran; false: as a
 * fresh clone of the parent, not initialized and not cloned), `systemRemote`
 * (the project is on `system: 'docker'`), `allowFile` (default true), `ops` (the registry, default OPS).
 */
export async function subWorld(t, { nested = true, populated = true, systemRemote = false, allowFile = true, ops = OPS } = {}) {
  const repo = makeRepo(t);
  const { root, home } = repo;
  if (!allowFile) fs.writeFileSync(path.join(home, '.gitconfig'), GLOBAL_NO_FILE);
  const env = hermeticEnv(home);
  /** A fixture git command in `cwd` (absolute, or relative to the parent repo); trimmed stdout. */
  const fx = (cwd, ...args) => execFileSync('git', [...FILE_OK, '-C', path.resolve(repo.dir, cwd), ...args], { encoding: 'utf8', env, stdio: 'pipe' }).trim();
  const bare = (name, files, setup) => {
    const dir = path.join(root, `${name}.git`);
    const work = path.join(root, `${name}-work`);
    fx(root, 'init', '-q', '--bare', '-b', 'main', dir);
    fx(root, 'clone', '-q', dir, work);
    for (const [rel, c] of Object.entries(files)) fs.writeFileSync(path.join(work, rel), c);
    fx(work, 'add', '-A');
    fx(work, 'commit', '-qm', `${name} base`);
    setup?.(work);
    fx(work, 'push', '-q', 'origin', 'HEAD:main');
    return dir;
  };
  const urls = {};
  if (nested) urls.libB = bare('libB', { 'b.txt': 'b\n' });
  urls.libA = bare('libA', { 'a.txt': 'a\n' }, (work) => {
    if (!nested) return;
    fx(work, 'submodule', 'add', '-q', urls.libB, 'libB');
    fx(work, 'commit', '-qm', 'add libB');
  });
  repo.commit({ 'p.txt': 'p\n' }, 'parent base');
  fx('.', 'submodule', 'add', '-q', urls.libA, 'libA');
  fx('.', 'commit', '-qm', 'add libA');
  if (populated) fx('.', 'submodule', 'update', '-q', '--init', '--recursive');
  else {
    // As a fresh clone of the parent has it: not initialized, nothing cloned.
    fx('.', 'submodule', 'deinit', '-q', '-f', '--all');
    fs.rmSync(path.join(repo.dir, '.git', 'modules'), { recursive: true, force: true });
  }

  const cc = await fakeCc({ projects: { [PROJECT]: { dir: repo.dir, ...(systemRemote ? { system: 'docker', remoteId: 'box' } : {}) } }, home });
  t.after(() => cc.close());
  const app = await startApp(t, { ops });
  const markers = path.join(root, 'markers');
  fs.mkdirSync(markers);

  const target = (sub) => ({ project: PROJECT, ...(sub ? { sub } : {}) });
  /** Runs op `name` over HTTP in the parent (no `sub`) or the submodule chain `sub`; resolves {status, body}. */
  const op = (name, params, sub) => app.call('POST', `/api/ops/${name}`, { target: target(sub), ...(params === undefined ? {} : { params }) });
  /** op(), asserting it succeeded; its result. */
  const ok = async (name, params, sub) => {
    const r = await op(name, params, sub);
    if (r.status !== 200) throw new Error(`${name} answered ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body.result;
  };
  return {
    repo, root, home, env, urls, cc, app, fx, op, ok, target,
    /** A git command in the parent (or `cwd` relative to it) as the user would run it: no file-transport opt-in. */
    git: (cwd, ...args) => spawnSync('git', ['-C', path.resolve(repo.dir, cwd), ...args], { encoding: 'utf8', env }),
    execCalls: () => cc.state.execCalls,
    execArgv: () => cc.state.execCalls.map((b) => b.argv),
    /** An absolute path for marker file `name`, which nothing may create. */
    marker: (name) => path.join(markers, name),
    markers: () => fs.readdirSync(markers),
    /** An executable script that creates marker `name`. */
    markerScript(name) {
      const p = path.join(root, `make-${name}.sh`);
      fs.writeFileSync(p, `#!/bin/sh\ntouch '${path.join(markers, name)}'\n`, { mode: 0o755 });
      return p;
    },
    activity: async () => (await app.call('GET', '/api/activity')).body.entries,
    /** Deinitializes submodule `name` of the parent and forgets its clone: as a fresh clone of the parent has it. */
    unclone(name = 'libA') {
      fx('.', 'submodule', 'deinit', '-q', '-f', '--', name);
      fs.rmSync(path.join(repo.dir, '.git', 'modules', name), { recursive: true, force: true });
    },
    /** A new commit of `files` on `<lib>.git`'s main (pushed from its work clone); its oid. */
    advance(lib, files, msg = `${lib} next`) {
      const work = path.join(root, `${lib}-work`);
      for (const [rel, c] of Object.entries(files)) fs.writeFileSync(path.join(work, rel), c);
      fx(work, 'add', '-A');
      fx(work, 'commit', '-qm', msg);
      fx(work, 'push', '-q', 'origin', 'HEAD:main');
      return fx(work, 'rev-parse', 'HEAD');
    },
    file: (rel) => path.join(repo.dir, rel),
  };
}

/** The argv after BASE_ARGS of every exec, as the strings after `--work-tree=.`. */
export const afterBase = (argv) => argv.slice(argv.indexOf('--work-tree=.') + 1);
