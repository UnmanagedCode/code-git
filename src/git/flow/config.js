import { Refusal } from '../../refusals.js';
import { bad } from '../params.js';
import { shortBranch } from '../refs/check.js';
import { isCcOwned } from '../refs/heads.js';
import { assertRefName } from '../validate.js';

// The git-flow settings (docs/gitflow.md): nvie's and AVH's `gitflow.*` keys in the repository config, so a checkout
// set up by the git-flow extension reads the same here and back.

const decoder = new TextDecoder('utf-8', { fatal: false });

export const TYPES = ['feature', 'release', 'hotfix'];
/** Each setting's config key (git lowercases the last part of a key, so `versiontag`). */
export const KEYS = {
  main: 'gitflow.branch.master', develop: 'gitflow.branch.develop',
  feature: 'gitflow.prefix.feature', release: 'gitflow.prefix.release', hotfix: 'gitflow.prefix.hotfix',
  versionTag: 'gitflow.prefix.versiontag',
};
export const DEFAULT_PREFIXES = { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' };

/** The raw `gitflow.*` values: {complete, main, develop, prefixes}, each null when unset; `complete`: all but the version-tag prefix are set. */
async function readRaw(git) {
  const r = await git(['config', '-z', '--get-regexp', '^gitflow\\.'], { okExit: [0, 1] });
  const values = new Map();
  for (const rec of decoder.decode(r.stdout).split('\0')) {
    if (!rec) continue;
    const nl = rec.indexOf('\n');
    // A key with no `=` (`versiontag` alone) prints without a newline: an empty value here.
    values.set(nl === -1 ? rec : rec.slice(0, nl), nl === -1 ? '' : rec.slice(nl + 1));
  }
  const get = (k) => values.get(KEYS[k]) ?? null;
  const c = {
    main: get('main'), develop: get('develop'),
    prefixes: { feature: get('feature'), release: get('release'), hotfix: get('hotfix'), versionTag: get('versionTag') },
  };
  return { complete: c.main !== null && c.develop !== null && TYPES.every((t) => c.prefixes[t] !== null), ...c };
}

/** Why complete settings `c` cannot be used (checkSettings' refusal), else null. */
function problemOf(c) {
  try {
    checkSettings({ ...c, prefixes: { ...c.prefixes, versionTag: c.prefixes.versionTag ?? '' } });
    return null;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return e;
  }
}

/**
 * The `gitflow.*` settings: {initialized, main, develop, prefixes: {feature, release, hotfix, versionTag}}, each null
 * when unset. `initialized`: usable by the write ops — both branches and the three type prefixes set (the version-tag
 * prefix may be unset or empty) and passing checkSettings. A repeated key's last value wins, as git's own reads do.
 */
export async function readFlowConfig(git) {
  const { complete, ...c } = await readRaw(git);
  return { initialized: complete && problemOf(c) === null, ...c };
}

const notCc = (name, what) => {
  if (isCcOwned(name)) throw new Refusal('BAD_REF', `${what} may not be under code-conductor/: cc owns those branches`);
};

/**
 * Checks settings `{main, develop, prefixes}` (from a request or from the config) and returns them. BAD_REF for a name a
 * branch or tag could not have or one under `code-conductor/`; BAD_PARAMS for equal branches, a missing or empty type
 * prefix, or two equal type prefixes (a branch's type would be ambiguous).
 */
export function checkSettings({ main, develop, prefixes }) {
  shortBranch(main);
  shortBranch(develop);
  if (main === develop) throw bad('main and develop must differ');
  notCc(main, 'main');
  notCc(develop, 'develop');
  if (prefixes === null || typeof prefixes !== 'object' || Array.isArray(prefixes)) throw bad('prefixes must be an object');
  for (const k of [...TYPES, 'versionTag']) {
    const v = prefixes[k];
    if (typeof v !== 'string' || (v === '' && k !== 'versionTag')) throw bad(`prefixes.${k} must be a${k === 'versionTag' ? '' : ' non-empty'} string`);
    // A prefix is a branch (or tag) name's start: with a name after it, it must make a valid one.
    assertRefName(`${v}x`);
    if (k !== 'versionTag') notCc(v, `the ${k} prefix`);
  }
  if (new Set(TYPES.map((k) => prefixes[k])).size !== TYPES.length) throw bad('the feature, release and hotfix prefixes must differ');
  // Otherwise main or develop would read as a flow branch, and a finish would merge and delete it.
  for (const k of TYPES) {
    for (const b of [main, develop]) if (b.startsWith(prefixes[k])) throw bad(`the ${k} prefix ${prefixes[k]} would make ${b} a ${k} branch`);
  }
  return { main, develop, prefixes: Object.fromEntries([...TYPES, 'versionTag'].map((k) => [k, prefixes[k]])) };
}

/** The settings start and finish run with: FLOW_NOT_INITIALIZED when unset, or set to something checkSettings refuses. */
export async function flowSettings(git) {
  const { complete, ...c } = await readRaw(git);
  if (!complete) throw new Refusal('FLOW_NOT_INITIALIZED', 'git-flow is not initialized in this repository');
  const problem = problemOf(c);
  if (problem) throw new Refusal('FLOW_NOT_INITIALIZED', `the git-flow settings are not usable (${problem.message}): initialize again`);
  return { main: c.main, develop: c.develop, prefixes: { ...c.prefixes, versionTag: c.prefixes.versionTag ?? '' } };
}
