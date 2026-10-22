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
