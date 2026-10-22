import { execFileSync } from 'node:child_process';
import { hermeticEnv } from './_git.js';

// A deterministic large history for paging and perf checks, written with one `git fast-import` run.
// Defaults are the perf fixture documented in docs/graph.md → Performance: 5,000 commits, 60 topic branches of which
// 45 are merged back into main, every head mirrored as origin/<head>, and tags — about 200 refs.

/** mulberry32: a small seeded PRNG, so the same seed always yields the same history. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXTURE_DEFAULTS = { seed: 42, commits: 5000, branches: 60, merged: 45, tags: 78 };

/**
 * Builds the history into the existing empty repo `dir` (made by `git init -b main`) and checks out main.
 * `subject(n)` names commit n (default `commit <n>`). Returns {heads, remotes, tags, commits} as written.
 */
export function buildGraphFixture(dir, home, opts = {}) {
  const { seed, commits, branches, merged, tags, subject = (n) => `commit ${n}` } = { ...FIXTURE_DEFAULTS, ...opts };
  const rand = mulberry32(seed);
  const pick = (n) => Math.floor(rand() * n);
  const out = [];
  let mark = 0;
  const marks = { main: [] };
  const commit = (ref, parents, n) => {
    mark++;
    const msg = Buffer.from(`${subject(n)}\n`);
    const who = `Dev ${n % 7} <dev${n % 7}@example.com> ${1_700_000_000 + n * 60} +0000`;
    const content = `${n}\n`;
    out.push(`commit ${ref}`, `mark :${mark}`, `author ${who}`, `committer ${who}`, `data ${msg.length}`, msg.toString().trimEnd());
    if (parents[0]) out.push(`from :${parents[0]}`);
    for (const p of parents.slice(1)) out.push(`merge :${p}`);
    out.push(`M 100644 inline f${n % 50}.txt`, `data ${Buffer.byteLength(content)}`, content.trimEnd(), '');
    return mark;
  };

  const active = []; // {name, target, merge}
  let created = 0;
  let n = 0;
  let mainTip = commit('refs/heads/main', [], n++);
  marks.main.push(mainTip);
  const forkWindow = Math.floor(commits * 0.7);
  while (n < commits) {
    const pendingMerges = active.filter((b) => b.merge).length;
    const left = commits - n;
    const r = rand();
    if (left <= pendingMerges) {
      // Just enough budget left to merge every branch that was meant to be merged.
      const b = active.find((x) => x.merge);
      mainTip = commit('refs/heads/main', [mainTip, marks[b.name].at(-1)], n++);
      marks.main.push(mainTip);
      active.splice(active.indexOf(b), 1);
    } else if (created < branches && r < branches / forkWindow * 1.5) {
      const name = `topic/${String(created).padStart(2, '0')}`;
      marks[name] = [commit(`refs/heads/${name}`, [mainTip], n++)];
      active.push({ name, target: 3 + pick(80), merge: created < merged });
      created++;
    } else if (active.length && r < 0.6) {
      const b = active[pick(active.length)];
      marks[b.name].push(commit(`refs/heads/${b.name}`, [marks[b.name].at(-1)], n++));
      if (marks[b.name].length >= b.target) {
        active.splice(active.indexOf(b), 1);
        if (b.merge && n < commits) {
          mainTip = commit('refs/heads/main', [mainTip, marks[b.name].at(-1)], n++);
          marks.main.push(mainTip);
        }
      }
    } else {
      mainTip = commit('refs/heads/main', [mainTip], n++);
      marks.main.push(mainTip);
    }
  }
  const heads = Object.keys(marks);
  for (const h of heads) {
    // Some remotes are a commit behind their local branch.
    const list = marks[h];
    const at = list.length > 1 && rand() < 0.3 ? list.at(-2) : list.at(-1);
    out.push(`reset refs/remotes/origin/${h}`, `from :${at}`, '');
  }
  for (let i = 0; i < tags; i++) {
    out.push(`reset refs/tags/v${Math.floor(i / 10)}.${i % 10}`, `from :${marks.main[pick(marks.main.length)]}`, '');
  }
  const env = hermeticEnv(home);
  execFileSync('git', ['-C', dir, 'fast-import', '--quiet'], { input: `${out.join('\n')}\n`, env, maxBuffer: 1 << 28 });
  execFileSync('git', ['-C', dir, 'reset', '-q', '--hard', 'main'], { env });
  return { heads: heads.length, remotes: heads.length, tags, commits: n, branchesCreated: created };
}
