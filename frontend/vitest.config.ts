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
    // One suite value, set from a measured loaded worst case: no test is slow alone (the slowest, its file run by
    // itself, ~0.5 s), but at a 1-min load of ~3x the cores with Vitest's default forks a broad tail slows 10-15x (worst
    // seen 7.2 s; dozens of tests in over 20 files past 2.5 s). The value keeps 2x over that worst; a hung test takes
    // that long to fail.
    testTimeout: 15_000,
  },
});
