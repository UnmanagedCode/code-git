// Single source for refusal codes and their HTTP status. Anything that refuses throws a `Refusal`;
// the route wrapper (src/http/route.js) renders it as `{error, code, …extra}` with this status.
export const HTTP_STATUS = {
  BAD_REQUEST: 400, BAD_TARGET: 400, BAD_REF: 400, BAD_PATH: 400, BAD_PARAMS: 400,
  PROJECT_UNKNOWN: 404, WORKTREE_UNKNOWN: 404, UNKNOWN_OP: 404, ACTIVITY_UNKNOWN: 404, NOT_FOUND: 404,
  NOT_A_REPO: 409, NOT_CANCELLABLE: 409, NOT_RUNNING: 409, CANCELLED: 409,
  BODY_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  GIT_FAILED: 422, OUTPUT_TOO_LARGE: 422,
  INTERNAL: 500,
  SYSTEM_UNREACHABLE: 502, GIT_UNAVAILABLE: 502,
  CONDUCTOR_UNAVAILABLE: 503,
  GIT_TIMEOUT: 504,
  REV_UNKNOWN: 404, NO_MERGE_BASE: 409, DIFF_NOT_CONTIGUOUS: 409,
  PARTIAL_UNSUPPORTED: 409, SELECTION_UNSUPPORTED: 409, STALE_DIFF: 409, CONFLICTED: 409, NOTHING_TO_COMMIT: 409,
  NO_HEAD: 409, PATCH_DOES_NOT_APPLY: 409, GITIGNORE_UNSUPPORTED: 409, PATH_NOT_IN_COMMIT: 404,
  BARE_REPO: 409, UNTRACKED_UNDER_PATH: 409,
  BRANCH_CHECKED_OUT: 409, CC_OWNED_BRANCH: 409, REF_EXISTS: 409, REF_UNKNOWN: 404, REF_MOVED: 409, NOT_FAST_FORWARD: 409, CHECKOUT_CONFLICT: 409, PICK_EMPTY: 409, NOTHING_IN_PROGRESS: 409, REMOTE_UNKNOWN: 404, REMOTE_AUTH_FAILED: 502, REMOTE_UNREACHABLE: 502, PUSH_REJECTED: 409, SYMBOLIC_REF: 409, REMOTE_CONFIG_UNSUPPORTED: 409,
};

export class Refusal extends Error {
  /** `extra` fields are sent beside `{error, code}`; keep them JSON-safe. */
  constructor(code, message, extra = {}) {
    if (!(code in HTTP_STATUS)) throw new Error(`Refusal: unknown code ${code}`);
    super(message);
    this.code = code;
    this.extra = extra;
  }

  get status() { return HTTP_STATUS[this.code]; }

  toBody() { return { error: this.message, code: this.code, ...this.extra }; }
}
