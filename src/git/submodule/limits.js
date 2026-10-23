import { NETWORK_LIMITS } from '../remote/limits.js';

// The single source for the submodule caps. Timeouts and byte caps stay within cc's exec caps (a test pins it).
export const SUBMODULE_LIMITS = {
  /** Entries in a target's `sub` chain: a submodule of a submodule of … */
  maxDepth: 8,
  /** Entries `submodule.list` reports (and probes); past it the list is `truncated`. Also the most paths one op takes. */
  maxListed: 500,
  /** Per-entry probes `submodule.list` keeps in flight. */
  probeConcurrency: 6,
  /** A clone, update or sync: a recursive clone of a large submodule outlasts NETWORK_LIMITS. */
  cloneTimeoutMs: 600_000,
  cloneMaxOutputBytes: NETWORK_LIMITS.maxOutputBytes,
};
