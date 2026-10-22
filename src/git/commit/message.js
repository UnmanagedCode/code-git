// The only place a commit message is split into summary + description or joined back. Pure.

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
