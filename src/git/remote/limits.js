// Caps on a command that talks to a remote (push now; fetch and pull reuse them). Within cc's exec caps (CC_EXEC_CAPS).
export const NETWORK_LIMITS = {
  timeoutMs: 120_000,
  maxOutputBytes: 1024 * 1024,
};
