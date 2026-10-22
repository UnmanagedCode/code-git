import fs from 'node:fs';
import path from 'node:path';

// The only files served from dist: a name that starts with a letter or digit, one of these extensions, at the root
// or under assets/. `.map`, dotfiles and `.vite/` cannot match. Tested on the decoded path, so `%2Emap` cannot slip past.
const ASSET_RE = /^\/((?:assets\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.(html|js|css|svg|png|ico|webmanifest))$/;

/** Serves the built UI from `distDir`. While it is unbuilt, HTML entry pages answer 503 and every other path falls through to the 404. */
export function serveDist(distDir) {
  // Read per request, so a UI built while the backend runs is served without a restart.
  const built = () => fs.existsSync(path.join(distDir, 'index.html'));
  // True when `rel` resolves, symlinks included, to a file inside dist. Nothing is cached.
  const inside = (rel) => {
    try {
      const root = fs.realpathSync(distDir);
      return fs.realpathSync(path.join(root, rel)).startsWith(root + path.sep);
    } catch { return false; }
  };
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p;
    try { p = decodeURIComponent(req.path); } catch { return next(); }
    const m = p === '/' ? [p, 'index.html', 'html'] : ASSET_RE.exec(p);
    if (!m) return next();
    if (!built()) {
      if (m[2] !== 'html') return next();
      console.error(`UI not built: ${path.join(distDir, 'index.html')} is missing — run npm install`);
      return res.status(503).type('text/plain').send('UI not built — run npm install');
    }
    if (!inside(m[1])) return next();
    res.sendFile(m[1], { root: distDir, dotfiles: 'deny' }, (err) => { if (err) next(err.status === 404 ? undefined : err); });
  };
}
