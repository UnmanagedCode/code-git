import { bad } from '../params.js';

// The only place a commit message is checked, split into summary + description or joined back. Pure.

/**
 * An op's `summary` and `description` params (from a params object already checked for keys): a non-empty one-line
 * summary, an optional description string, no NUL in either. Else BAD_PARAMS. → {summary, description}.
 */
export function messageParams(p) {
  if (typeof p.summary !== 'string' || !p.summary.trim()) throw bad('summary must be a non-empty string');
  if (/[\r\n]/.test(p.summary)) throw bad('summary must be one line');
  if (p.description !== undefined && typeof p.description !== 'string') throw bad('description must be a string');
  const description = p.description ?? '';
  if (p.summary.includes('\0') || description.includes('\0')) throw bad('a commit message cannot contain NUL');
  return { summary: p.summary, description };
}

/** `summary` trimmed, then a blank line and the description (trailing whitespace trimmed) when there is one. */
export function joinMessage(summary, description = '') {
  const desc = description.trimEnd();
  return `${summary.trim()}${desc ? `\n\n${desc}` : ''}\n`;
}

/** The first non-blank line is the summary; the rest, minus one leading blank line and trailing whitespace, the description. */
export function splitMessage(text) {
  const ls = text.split('\n');
  const first = ls.findIndex((l) => l.trim() !== '');
  if (first === -1) return { summary: '', description: '' };
  const rest = ls.slice(first + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { summary: ls[first].trim(), description: rest.join('\n').trimEnd() };
}

/** A commit template as a draft: the lines starting with the comment prefix dropped (as git's `strip` cleanup does), then split. */
export const templateDraft = (text, commentPrefix) => splitMessage(text.split('\n').filter((l) => !l.startsWith(commentPrefix)).join('\n'));
