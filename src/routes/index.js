import * as activity from './activity.js';
import * as integrations from './integrations.js';
import * as ops from './ops.js';
import * as repos from './repos.js';

/** Mounts every feature's routes on the /api router. A feature adds `routes/<feature>.js` exporting `mount(router, deps)` and one line here. */
export function mountRoutes(router, deps) {
  repos.mount(router, deps);
  ops.mount(router, deps);
  activity.mount(router, deps);
  integrations.mount(router, deps);
}
