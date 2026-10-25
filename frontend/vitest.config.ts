import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  cacheDir: path.join(here, '.vite-cache'),
  resolve: { alias: { '@': path.join(here, 'src') } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Load-driven, suite-wide: no test is slow alone (the slowest, a file run by itself, ~0.5 s), but at a 1-min load of
    // ~3x the cores with the default forks a full-Shell test runs 10-15x slower (worst seen 7.2 s), and dozens pass
    // 2.5 s. 15 s keeps 2x over that worst; the trade is that a hung test takes 15 s to fail.
    testTimeout: 15_000,
  },
});
