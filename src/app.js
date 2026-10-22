import express from 'express';
import http from 'node:http';
import { createActivityLog } from './activity/log.js';
import { OPS } from './git/ops/index.js';
import { createLocks } from './git/locks.js';
import { route, sendError } from './http/route.js';
import { requireJson, securityHeaders } from './http/security.js';
import { serveDist } from './http/static.js';
import { Refusal } from './refusals.js';
import { mountRoutes } from './routes/index.js';

/** The app: headers → health → /api → UI → 404 → errors. `ops` and `activity` are injectable for tests. */
export function createApp({ distDir, ops = OPS, activity = createActivityLog() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(requireJson);
  api.use(express.json({ limit: '1mb' }));
  mountRoutes(api, { ops, activity, locks: createLocks() });
  api.use(route(async () => { throw new Refusal('NOT_FOUND', 'no such API route'); }));
  app.use('/api', api);

  app.use(serveDist(distDir));
  // Terminal 404 and error handlers: Express's own pages would replace the CSP.
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof Refusal) return sendError(res, err);
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    if (req.path.startsWith('/api/')) {
      const code = status === 413 ? 'BODY_TOO_LARGE' : status < 500 ? 'BAD_REQUEST' : 'INTERNAL';
      return res.status(status).json({ error: http.STATUS_CODES[status] ?? 'Error', code });
    }
    res.status(status).type('text/plain').send(http.STATUS_CODES[status] ?? 'Error');
  });
  return app;
}
