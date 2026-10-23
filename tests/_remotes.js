import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { NET_CONFIG } from '../src/git/remote/net.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { bindRepo, hermeticEnv } from './_git.js';

// Helpers the remote op tests share: credential-demanding http servers and the NET_CONFIG scan.

export const hasHttp = (() => {
  try { return fs.existsSync(path.join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git-remote-http')); } catch { return false; }
})();
export const NO_HTTP = !hasHttp && 'this git has no git-remote-http';

/** A local http server answering every request with `status` (401 asks for Basic credentials); → its base url. */
export async function authServer(t, status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, status === 401 ? { 'WWW-Authenticate': 'Basic realm="x"' } : {});
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}`;
}

const NETWORK_SUBCOMMANDS = new Set(['push', 'fetch', 'ls-remote']);

/** The exec bodies of network subcommands (push, fetch, ls-remote) in `execCalls`. */
export const netCalls = (execCalls) => execCalls.filter((b) => b.argv.slice(1 + BASE_ARGS.length).some((x) => NETWORK_SUBCOMMANDS.has(x)));

/** At least one network command ran, and every one carries NET_CONFIG right after BASE_ARGS. */
export function assertNetPinned(execCalls) {
  const net = netCalls(execCalls);
  assert.ok(net.length, 'a network command ran');
  for (const b of net) assert.deepEqual(b.argv.slice(1 + BASE_ARGS.length, 1 + BASE_ARGS.length + NET_CONFIG.length), NET_CONFIG, b.argv.join(' '));
}

/** Rejects when `promise` is still pending after `ms`: a command waiting on a prompt would hang until its timeout. */
export function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} still pending after ${ms} ms`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * A second clone of `w`'s origin (created once, at `<root>/elsewhere`): commits `files` on `branch` (based on origin's
 * `branch`, else origin's main) and pushes it to origin, as another user would. → the pushed commit.
 */
export function pushFromElsewhere(w, branch, files, msg = `elsewhere ${branch}`) {
  const dir = path.join(w.repo.root, 'elsewhere');
  if (!fs.existsSync(dir)) execFileSync('git', ['clone', '-q', w.origin.dir, dir], { env: hermeticEnv(w.repo.home) });
  const other = bindRepo(dir, w.repo.home);
  other.git('fetch', '-q', 'origin');
  const base = (() => { try { return other.git('rev-parse', '--verify', '-q', `origin/${branch}`); } catch { return other.git('rev-parse', 'origin/main'); } })();
  other.git('checkout', '-q', '-B', branch, base);
  const oid = other.commit(files, msg);
  other.git('push', '-q', 'origin', `${branch}:${branch}`);
  return oid;
}
