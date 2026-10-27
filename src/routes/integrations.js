import { codeReviewPlugin } from '../conductor/integrations.js';
import { route } from '../http/route.js';

// Which sibling plugins the UI may link to: `{codeReview: {id} | null}`.
export function mount(router) {
  router.get('/integrations', route(async (_req, res) => {
    const id = await codeReviewPlugin();
    res.json({ codeReview: id ? { id } : null });
  }));
}
