import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// The standalone palette is a one-time snapshot of cc's tokens; embedded, cc's /pluginTheme.css wins. These pins catch an
// accidental edit of the snapshot or of the @theme block, which must stay the one in cc's docs/plugin-ui.md.

const src = path.dirname(fileURLToPath(import.meta.url));
const fallback = readFileSync(path.join(src, 'cc-theme-fallback.css'), 'utf8');
const indexCss = readFileSync(path.join(src, 'index.css'), 'utf8');

/** `selector { … }` → its declarations, in order. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+|color-scheme):\s*([^;]+);/gm)].map((m) => [m[1], m[2]]));
}

const ROOT = {
  '--radius': '0.75rem', '--background': 'oklch(0.99 0.002 60)', '--foreground': 'oklch(0.2 0.01 50)', '--card': 'oklch(1 0 0)',
  '--card-foreground': 'var(--foreground)', '--popover': 'oklch(1 0 0)', '--popover-foreground': 'var(--foreground)',
  '--primary': 'oklch(0.66 0.17 38)', '--primary-foreground': 'oklch(0.99 0.01 60)', '--secondary': 'oklch(0.96 0.005 60)',
  '--secondary-foreground': 'oklch(0.25 0.01 50)', '--muted': 'oklch(0.965 0.004 60)', '--muted-foreground': 'oklch(0.52 0.012 55)',
  '--accent': 'oklch(0.955 0.02 45)', '--accent-foreground': 'oklch(0.35 0.08 38)', '--destructive': 'oklch(0.58 0.22 25)',
  '--border': 'oklch(0.915 0.006 60)', '--input': 'oklch(0.9 0.006 60)', '--ring': 'oklch(0.66 0.17 38 / 0.5)',
  '--sidebar': 'oklch(0.975 0.004 60)', '--sidebar-foreground': 'var(--foreground)', '--sidebar-border': 'var(--border)',
  '--sidebar-accent': 'oklch(0.94 0.008 60)', '--success': 'oklch(0.62 0.15 155)', '--warning': 'oklch(0.74 0.15 75)',
  '--info': 'oklch(0.6 0.14 245)', '--plan': 'oklch(0.58 0.17 290)',
};
const DARK = {
  'color-scheme': 'dark', '--background': 'oklch(0.17 0.006 50)', '--foreground': 'oklch(0.95 0.005 60)', '--card': 'oklch(0.205 0.007 50)',
  '--card-foreground': 'var(--foreground)', '--popover': 'oklch(0.22 0.008 50)', '--popover-foreground': 'var(--foreground)',
  '--primary': 'oklch(0.72 0.16 40)', '--primary-foreground': 'oklch(0.18 0.02 40)', '--secondary': 'oklch(0.25 0.008 50)',
  '--secondary-foreground': 'var(--foreground)', '--muted': 'oklch(0.24 0.007 50)', '--muted-foreground': 'oklch(0.68 0.012 55)',
  '--accent': 'oklch(0.28 0.03 40)', '--accent-foreground': 'oklch(0.9 0.05 45)', '--destructive': 'oklch(0.66 0.2 25)',
  '--border': 'oklch(0.29 0.008 50)', '--input': 'oklch(0.32 0.008 50)', '--ring': 'oklch(0.72 0.16 40 / 0.5)',
  '--sidebar': 'oklch(0.15 0.006 50)', '--sidebar-foreground': 'var(--foreground)', '--sidebar-border': 'oklch(0.26 0.008 50)',
  '--sidebar-accent': 'oklch(0.23 0.008 50)', '--success': 'oklch(0.72 0.15 155)', '--warning': 'oklch(0.8 0.14 80)',
  '--info': 'oklch(0.72 0.12 245)', '--plan': 'oklch(0.72 0.14 290)',
};

// The @theme inline block of cc's docs/plugin-ui.md → Theme, verbatim.
const THEME_INLINE = `@theme inline {
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-plan: var(--plan);
}`;

test('the light palette snapshot holds exactly the pinned tokens', () => {
  expect(block(fallback, ':root')).toEqual(ROOT);
});

test('the dark palette snapshot holds exactly the pinned tokens', () => {
  expect(block(fallback, '.dark')).toEqual(DARK);
});

test('the snapshot is inside @layer base, so the host sheet (unlayered) wins when embedded', () => {
  expect(fallback).toMatch(/^\/\*[^]*?\*\/\n@layer base \{\n/);
  expect(fallback.trimEnd().endsWith('}\n}')).toBe(true);
});

test("index.css carries plugin-ui.md's @theme inline block verbatim and imports the fallback", () => {
  expect(indexCss).toContain(THEME_INLINE);
  expect(indexCss).toContain("@import './cc-theme-fallback.css';");
  expect(indexCss).toContain('@custom-variant dark (&:is(.dark *));');
});

test('every --color-* utility resolves to a token defined in both themes', () => {
  const refs = [...THEME_INLINE.matchAll(/--color-[\w-]+: var\((--[\w-]+)\)/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(20);
  for (const r of refs) {
    expect(ROOT, r).toHaveProperty([r]);
    expect(DARK, r).toHaveProperty([r]);
  }
});
