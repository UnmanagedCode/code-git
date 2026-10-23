import type { Draft } from '@/features/workdir/api';

// A commit message as the commit box's summary and description. Pure; mirrors the backend's splitMessage
// (src/git/commit/message.js): the first non-blank line is the summary, the rest — minus one leading blank line and
// trailing whitespace — the description.

export function splitDraft(text: string): Draft {
  const ls = text.split('\n');
  const first = ls.findIndex((l) => l.trim() !== '');
  if (first === -1) return { summary: '', description: '' };
  const rest = ls.slice(first + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { summary: ls[first].trim(), description: rest.join('\n').trimEnd() };
}
