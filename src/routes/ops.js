import { getOp } from '../git/ops/index.js';
import { runGit } from '../git/runner.js';
import { assertTarget } from '../git/validate.js';
import { route } from '../http/route.js';
import { Refusal } from '../refusals.js';

// POST api/ops/:name — the one way the UI runs git: an op name plus typed params, never argv or git options.
export function mount(router, { ops, activity, locks }) {
  router.post('/ops/:name', route(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refusal('BAD_PARAMS', 'the body must be {target, params?}');
    for (const k of Object.keys(body)) {
      if (k !== 'target' && k !== 'params') throw new Refusal('BAD_PARAMS', `unknown field ${JSON.stringify(k)}`);
    }
    const target = assertTarget(body.target);
    const op = getOp(ops, req.params.name);
    const params = op.params(body.params);
    // A client that goes away aborts a cancellable op; any other op runs to completion and is logged.
    const controller = new AbortController();
    if (op.cancellable) res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const ctx = {
      target, op: op.name, kind: op.kind, cancellable: op.cancellable, signal: controller.signal,
      opRunId: activity.newRunId(), activity, locks,
    };
    const result = await op.run((args, opts) => runGit(ctx, args, opts), params, { target });
    res.json({ ok: true, result });
  }));
}
