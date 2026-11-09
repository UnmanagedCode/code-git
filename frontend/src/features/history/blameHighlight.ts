import { HIGHLIGHT_MAX_LINES, highlightLines, languageFor, type Seg, type Tokenize } from '@/features/diff/highlight';
import type { BlameLine } from './api';

/**
 * Syntax segments per loaded blame line, or null (render plain) when there is no language or tokenizer, or the file
 * (`total` lines) is past HIGHLIGHT_MAX_LINES, so a large file is plain from its first page rather than from its sixth.
 *
 * The tokenizer always sees the file's own text, line 1 through the last loaded line, as one string (as the diff
 * tokenizes a side), so neither a page boundary nor an author run splits a construct. Each new page re-tokenizes it.
 */
export function blameSegments(lines: BlameLine[], total: number | null, path: string, tokenize: Tokenize | null): Seg[][] | null {
  const lang = languageFor(path);
  if (!lang || !tokenize || (total ?? lines.length) > HIGHLIGHT_MAX_LINES) return null;
  return highlightLines(lines.map((l) => l.text).join('\n'), lang, tokenize);
}
