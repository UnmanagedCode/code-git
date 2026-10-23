// Parsers for the history ops (src/git/ops/history.js). Pure: each takes decoded git output (LC_ALL=C).

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const STATUS = /^[ACDMRTUXB]\d*$/;

/**
 * `log --follow -M --name-status -z --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s -- <path>` → items, newest first. Each
 * commit is its six NUL-ended fields, then `\n<status>` and its path (two for a rename or copy: old, new), each NUL-ended
 * (`history-git-probes.test.js` pins the layout). `path` is the file's name at that commit; a commit with no entry for
 * it (a merge) keeps the name of the commit before it in the list.
 */
export function parseFileHistory(out, startPath) {
  const t = out.split('\0');
  const items = [];
  let path = startPath;
  let i = 0;
  while (i + 5 < t.length) {
    const oid = t[i].replace(/^\n/, '');
    if (!OID.test(oid)) break;
    const [parents, author, email, time, subject] = t.slice(i + 1, i + 6);
    i += 6;
    let status = null;
    let oldPath = null;
    const head = t[i] ?? '';
    if (head.startsWith('\n') && STATUS.test(head.slice(1))) {
      status = head.slice(1);
      if (/^[RC]/.test(status)) {
        oldPath = t[i + 1];
        path = t[i + 2];
        i += 3;
      } else {
        path = t[i + 1];
        i += 2;
      }
    }
    items.push({ oid, parents: parents ? parents.split(' ') : [], author, email, time: Number(time), subject, status, path, oldPath });
    // What the next (older) commit calls the file.
    if (oldPath !== null) path = oldPath;
  }
  return items;
}

/**
 * `blame --porcelain` → `{lines: [{n, oid, origLine, text}], commits: {[oid]: {author, mail, time, summary, filename,
 * previous, previousPath}}}`. A group header `<oid> <orig> <final> [<count>]` is followed by that commit's headers the
 * first time it appears (and `filename` / `previous` per group), then each line as `\t<text>`.
 */
export function parseBlame(out) {
  const lines = [];
  const commits = {};
  let cur = null;
  let origLine = 0;
  let n = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      lines.push({ n, oid: cur, origLine, text: line.slice(1) });
      continue;
    }
    const head = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (head) {
      cur = head[1];
      origLine = Number(head[2]);
      n = Number(head[3]);
      commits[cur] ??= { author: '', mail: '', time: 0, summary: '', filename: '', previous: null, previousPath: null };
      continue;
    }
    if (!cur) continue;
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1);
    const c = commits[cur];
    if (key === 'author') c.author = value;
    else if (key === 'author-mail') c.mail = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') c.time = Number(value);
    else if (key === 'summary') c.summary = value;
    else if (key === 'filename') c.filename = value;
    else if (key === 'previous') {
      // "previous <oid> <path>": the commit before, and the file's name there (the old name after a rename).
      const sp2 = value.indexOf(' ');
      c.previous = (sp2 === -1 ? value : value.slice(0, sp2)) || null;
      c.previousPath = sp2 === -1 ? null : value.slice(sp2 + 1);
    }
  }
  return { lines, commits };
}

/** `log -g --date=unix --format=%H%x00%gd%x00%gs%x00%gn%x00%ge%x00%s -z`: records → entries (`%gd` is `<ref>@{<unix time>}`). */
export function parseReflog(out, { ref, skip }) {
  const t = out.split('\0');
  const items = [];
  for (let i = 0; i + 5 < t.length; i += 6) {
    const oid = t[i].replace(/^\n/, '');
    if (!OID.test(oid)) break;
    const [selector, action, name, email, subject] = t.slice(i + 1, i + 6);
    const time = /@\{(\d+)\}$/.exec(selector);
    items.push({ selector: `${ref}@{${skip + items.length}}`, oid, time: time ? Number(time[1]) : null, action, who: { name, email }, subject });
  }
  return items;
}
