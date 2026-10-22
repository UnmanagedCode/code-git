/** A half-open character range [start, end) within one line. */
export interface Range { start: number; end: number }

/** Lines longer than this, or with more tokens per side than WORD_DIFF_MAX_TOKENS, get no word-level emphasis. */
export const WORD_DIFF_MAX_CHARS = 1000;
export const WORD_DIFF_MAX_TOKENS = 300;

const TOKEN_RE = /\w+|\s+|[^\w\s]/g;

/**
 * The changed characters of a deleted line `a` and its paired added line `b`: the tokens outside their longest
 * common token subsequence, as merged ranges per side. Null past the caps.
 */
export function wordDiff(a: string, b: string): { a: Range[]; b: Range[] } | null {
  if (a.length > WORD_DIFF_MAX_CHARS || b.length > WORD_DIFF_MAX_CHARS) return null;
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  if (ta.length > WORD_DIFF_MAX_TOKENS || tb.length > WORD_DIFF_MAX_TOKENS) return null;
  const n = ta.length;
  const m = tb.length;
  // lcs[i][j] = LCS length of ta[i..] and tb[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (ta[i] === tb[j]) { keepA[i++] = true; keepB[j++] = true; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++; else j++;
  }
  return { a: ranges(ta, keepA), b: ranges(tb, keepB) };
}

function ranges(tokens: string[], keep: boolean[]): Range[] {
  const out: Range[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    if (!keep[i]) {
      const last = out.at(-1);
      if (last && last.end === pos) last.end += t.length; else out.push({ start: pos, end: pos + t.length });
    }
    pos += t.length;
  });
  return out;
}
