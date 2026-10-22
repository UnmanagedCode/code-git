import { Refusal } from '../refusals.js';

// cc's plugin-ui.md Part 2 minimum, plus inline styles (Radix dropdown, dialog and scroll-area set them) and same-origin images.
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };

/** First middleware: every response carries the CSP and nosniff, whatever its status. */
export function securityHeaders(_req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** A state-changing request must be JSON, which a cross-site "simple" request cannot send (415 otherwise). */
export function requireJson(req, _res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (!JSON_TYPE.test(req.get('content-type') ?? '')) {
    return next(new Refusal('UNSUPPORTED_MEDIA_TYPE', 'state-changing requests must have Content-Type: application/json'));
  }
  next();
}
