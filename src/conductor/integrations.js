import { plugins } from './cc.js';

// Other cc plugins code-git links to. The single home of each plugin id; the UI learns it from GET api/integrations.

export const CODE_REVIEW_PLUGIN = 'code-review';

/** code-review's plugin id when cc has it enabled with a frontend, else null. */
export async function codeReviewPlugin() {
  const rows = await plugins();
  return rows.some((r) => r?.id === CODE_REVIEW_PLUGIN && r.enabled === true && r.hasFrontend === true) ? CODE_REVIEW_PLUGIN : null;
}
