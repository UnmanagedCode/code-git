// `git status --porcelain=v2 --branch -z` → the summary repo.summary returns.
// Linear: split on NUL, read the fixed `# branch.*` headers and each entry's type character only — paths are never matched.

/** @param {string} out the command's stdout */
export function parseStatus(out) {
  const head = { oid: null, branch: null, unborn: false };
  let upstream = null;
  let ahead = null;
  let behind = null;
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.startsWith('# ')) {
      const sp = f.indexOf(' ', 2);
      const key = sp === -1 ? f.slice(2) : f.slice(2, sp);
      const value = sp === -1 ? '' : f.slice(sp + 1);
      if (key === 'branch.oid') {
        if (value === '(initial)') head.unborn = true; else head.oid = value;
      } else if (key === 'branch.head') {
        head.branch = value === '(detached)' ? null : value;
      } else if (key === 'branch.upstream') {
        upstream = value;
      } else if (key === 'branch.ab') {
        const [a, b] = value.split(' ');
        ahead = Number(a.slice(1));
        behind = Number(b.slice(1));
      }
    } else if (f[0] === '1' || f[0] === '2') {
      // `<type> <XY> …`: X is the index side, Y the worktree side, '.' = unchanged.
      if (f[2] !== '.') counts.staged++;
      if (f[3] !== '.') counts.unstaged++;
      if (f[0] === '2') i++; // a rename/copy entry is followed by its original path
    } else if (f[0] === 'u') {
      counts.conflicted++;
    } else if (f[0] === '?') {
      counts.untracked++;
    }
  }
  return { head, upstream, ahead, behind, counts };
}
