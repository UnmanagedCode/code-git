import { discard } from './discard.js';
import { head } from './head.js';
import { patch } from './patch.js';
import { refs } from './refs.js';
import { rename } from './rename.js';
import { stash } from './stash.js';
import { worktree } from './worktree.js';

// The step kinds (docs/undo.md → Steps). Each is `{kind, preflight(git, step, dir, ctx), apply(git, step, dir, ctx)}`;
// a card whose op no kind fits adds one file here and one entry below.

export const STEPS = new Map([head, refs, rename, discard, patch, worktree, stash].map((s) => [s.kind, s]));
