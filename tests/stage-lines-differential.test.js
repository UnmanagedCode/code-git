import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hermeticEnv } from './_git.js';
import { hostile, opWorld } from './_ops.js';

// A seeded randomized differential test: random small files (few distinct lines, so occurrences repeat; final newline
// present or not on either side), a random selection of the shown diff's change lines, stage / unstage / discard at
// context 0, 3 and full against real git, and the resulting bytes compared with an oracle that computes the intended
// result from line numbers alone (it never builds a patch).

const SEED = 0xc4c4;
const CASES = 14; // per (action, context)
const CONTEXTS = [0, 3, 'full'];
const ACTIONS = ['stage', 'unstage', 'discard'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = ['a', 'b', 'c', 'f'];

function randomPair(r) {
  const pick = () => ALPHABET[Math.floor(r() * ALPHABET.length)];
  const base = Array.from({ length: 1 + Math.floor(r() * 7) }, pick);
  const edited = [];
  for (const l of base) {
    const x = r();
    if (x < 0.2) continue; // delete
    if (x < 0.4) { edited.push(pick()); continue; } // replace
    edited.push(l);
    if (x > 0.8) edited.push(pick()); // insert after
  }
  if (r() < 0.2) edited.unshift(pick());
  const text = (ls, nl) => (ls.length ? ls.join('\n') + (nl ? '\n' : '') : '');
  return { base: text(base, r() < 0.5), edited: text(edited.length ? edited : [pick()], r() < 0.5) };
}

/** A file's lines, each with its own terminator (the last may have none). */
const linesOf = (s) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * The intended result. `from` = the side the change applies to (stage: old; unstage/discard: new), `other` = the other side.
 * Within a change block the i-th removed line pairs with the i-th added line; forward keeps unselected removed lines and
 * inserts selected added lines after their pair; reverse keeps unselected added lines and re-inserts selected removed
 * lines before their pair.
 */
function oracle(fd, selected, forward, oldText, newText) {
  const oldL = linesOf(oldText);
  const newL = linesOf(newText);
  const base = forward ? oldL : newL;
  const out = [];
  let cursor = 0; // lines of `base` copied so far
  for (const h of fd.hunks) {
    let prevNo = null;
    for (let i = 0; i < h.lines.length;) {
      const l = h.lines[i];
      if (l.kind === 'context') { prevNo = forward ? l.oldNo : l.newNo; i++; continue; }
      const dels = [];
      const adds = [];
      for (; i < h.lines.length && h.lines[i].kind !== 'context'; i++) (h.lines[i].kind === 'del' ? dels : adds).push(h.lines[i]);
      const own = forward ? dels : adds;
      const [start, count] = forward ? [h.oldStart, h.oldLines] : [h.newStart, h.newLines];
      const before = own.length ? (forward ? own[0].oldNo : own[0].newNo) - 1 : prevNo ?? (count ? start - 1 : start);
      while (cursor < before) out.push(base[cursor++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k];
        const a = adds[k];
        if (forward) {
          if (d && !selected.has(d)) out.push(oldL[d.oldNo - 1]);
          if (a && selected.has(a)) out.push(newL[a.newNo - 1]);
        } else {
          if (d && selected.has(d)) out.push(oldL[d.oldNo - 1]);
          if (a && !selected.has(a)) out.push(newL[a.newNo - 1]);
        }
      }
      cursor = before + own.length;
      prevNo = null;
    }
  }
  while (cursor < base.length) out.push(base[cursor++]);
  return out.join('');
}

test(`selection ops match the oracle against real git (seed ${SEED}, ${CASES} cases × stage/unstage/discard × context 0/3/full)`, { timeout: 120_000 }, async (t) => {
  const w = await opWorld(t);
  const r = rng(SEED);
  const cases = [];
  for (const action of ACTIONS) for (const context of CONTEXTS) for (let i = 0; i < CASES; i++) {
    cases.push({ action, context, file: `${action}-${context}-${i}.txt`, ...randomPair(r) });
  }
  // One commit of every base, then every worktree / index as each action needs it.
  for (const c of cases) w.repo.write(c.file, c.base);
  w.repo.write('.keep', 'k\n');
  w.repo.git('add', '-A');
  w.repo.git('commit', '-q', '-m', 'bases');
  for (const c of cases) w.repo.write(c.file, c.edited);
  w.repo.git('add', '--', ...cases.filter((c) => c.action === 'unstage').map((c) => c.file));
  hostile(w.repo);
  const blob = (p) => execFileSync('git', ['-C', w.repo.dir, 'cat-file', 'blob', `:${p}`], { env: hermeticEnv(w.repo.home) }).toString('latin1');
  const disk = (p) => fs.readFileSync(path.join(w.repo.dir, p)).toString('latin1');

  let applied = 0;
  let refused = 0;
  for (const c of cases) {
    if (c.base === c.edited) continue;
    const fd = await w.op('diff.file', { source: { kind: c.action === 'unstage' ? 'staged' : 'unstaged' }, path: c.file, context: c.context, whitespace: 'none' });
    const changes = fd.hunks.flatMap((h) => h.lines.filter((l) => l.kind !== 'context').map((l) => ({ h, l })));
    if (!changes.length) continue;
    const picked = changes.filter(() => r() < 0.5);
    if (!picked.length) picked.push(changes[Math.floor(r() * changes.length)]);
    const hunks = fd.hunks.map((h) => ({ header: h.header, lines: h.lines.flatMap((l, index) => (picked.some((p) => p.l === l) ? [{ index, text: l.text }] : [])) })).filter((h) => h.lines.length);
    const read = c.action === 'discard' ? disk : blob;
    const before = read(c.file);
    const op = { stage: 'stage.stageLines', unstage: 'stage.unstageLines', discard: 'stage.discardLines' }[c.action];
    const label = `${c.action} ctx=${c.context} ${JSON.stringify(c.base)} → ${JSON.stringify(c.edited)} picked ${JSON.stringify(picked.map((p) => `${p.l.kind}${p.l.oldNo ?? p.l.newNo}`))}`;
    try {
      await w.op(op, { path: c.file, context: c.context, hunks });
    } catch (e) {
      // A selection that would orphan a no-newline line is refused, and changes nothing.
      assert.equal(e.code, 'SELECTION_UNSUPPORTED', `${label}: ${e.message}`);
      assert.equal(read(c.file), before, label);
      refused++;
      continue;
    }
    const selected = new Set(picked.map((p) => p.l));
    const expected = c.action === 'stage' ? oracle(fd, selected, true, c.base, c.edited) : oracle(fd, selected, false, c.base, c.edited);
    assert.equal(read(c.file), expected, label);
    applied++;
  }
  // The run must exercise mostly applied selections, not refusals.
  t.diagnostic(`applied ${applied}, refused ${refused} of ${cases.length}`);
  assert.ok(applied >= cases.length * 0.6, `applied ${applied}, refused ${refused} of ${cases.length}`);
});

test('the oracle gives the review repros\' expected bytes (A: unstage, B: stage, both at context 0)', async (t) => {
  const w = await opWorld(t);
  w.repo.commit({ 'a.txt': 'a\ng\na\nd\nf\n', 'b.txt': 'd\nc\nc\ng\nc\ng\nf\nf' });
  w.repo.write('a.txt', 'a\nf\na\nd\nf\nf');
  w.repo.git('add', 'a.txt');
  w.repo.write('b.txt', 'c\ng\nc\ng\nf\nf\n');
  const fa = await w.op('diff.file', { source: { kind: 'staged' }, path: 'a.txt', context: 0, whitespace: 'none' });
  const pickA = new Set(fa.hunks.flatMap((h) => h.lines.filter((l) => (l.kind === 'del' && l.text === 'g') || (l.kind === 'add' && l.newNo === 6))));
  assert.equal(pickA.size, 2);
  assert.equal(oracle(fa, pickA, false, 'a\ng\na\nd\nf\n', 'a\nf\na\nd\nf\nf'), 'a\ng\nf\na\nd\nf\n');
  const fb = await w.op('diff.file', { source: { kind: 'unstaged' }, path: 'b.txt', context: 0, whitespace: 'none' });
  const dels = fb.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'del'));
  assert.equal(oracle(fb, new Set([dels[1], dels.at(-1)]), true, 'd\nc\nc\ng\nc\ng\nf\nf', 'c\ng\nc\ng\nf\nf\n'), 'd\nc\ng\nc\ng\nf\n');
});
