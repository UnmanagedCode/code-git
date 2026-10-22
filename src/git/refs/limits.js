// Caps on what a ref-writing op accepts (docs/refs.md).
export const REF_LIMITS = {
  /** Names one request may delete, push or remove from a remote. */
  namesMax: 100,
  /** An annotated tag's message, in UTF-8 bytes. */
  tagMessageMaxBytes: 64 * 1024,
};
