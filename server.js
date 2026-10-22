import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { SECURITY_HEADERS } from './src/http/security.js';

export { createApp } from './src/app.js';
export { CSP } from './src/http/security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 7500;

/** Listens on loopback only; resolves to the http.Server once bound. */
export async function start({ port = Number(process.env.PORT) || DEFAULT_PORT, distDir = path.join(here, 'frontend', 'dist'), ...opts } = {}) {
  const server = createApp({ distDir, ...opts }).listen(port, '127.0.0.1');
  // A request Node's parser rejects never reaches Express: answer it here, with the CSP.
  server.on('clientError', (err, socket) => {
    if (!socket.writable) return socket.destroy();
    const status = err.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request';
    const headers = Object.entries(SECURITY_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status}\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await start();
  console.log(`code-git listening on http://127.0.0.1:${server.address().port}`);
}
