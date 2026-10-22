import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const src = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.dirname(src);

/** Every .ts, .tsx, .js, .mjs and .html file under frontend/, minus dist/, node_modules/, test/ dirs and *.test.* files. */
function frontendSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return ['dist', 'node_modules', 'test', '.vite-cache'].includes(name) ? [] : frontendSources(p);
    return /\.(tsx?|jsx?|mjs|html)$/.test(name) && !/\.test\./.test(name) && !/\.config\./.test(name) ? [p] : [];
  });
}
const all = frontendSources(frontend);
const offenders = (re: RegExp, files = all) => files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(frontend, f));

test('the guards see the sources they cover', () => {
  const seen = all.map((f) => path.relative(frontend, f));
  expect(seen.length).toBeGreaterThan(25);
  for (const must of ['index.html', 'public/theme-init.js', 'src/App.tsx', 'src/shell/Shell.tsx', 'src/features/activity/ActivityEntry.tsx',
    'src/features/repos/RepoPicker.tsx', 'src/features/repo/RepoHeader.tsx', 'src/lib/api.ts', 'src/components/ui/button.tsx']) expect(seen).toContain(must);
  expect(seen.some((f) => f.startsWith('dist') || f.includes('node_modules'))).toBe(false);
});

// Content reaches the DOM as text, never markup. This scan is a backstop over source text, not a security boundary.
test('no raw-markup or dynamic-code escape hatch', () => {
  expect(offenders(/dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setHTMLUnsafe|createContextualFragment|DOMParser/)).toEqual([]);
});

test('no href, src or style built from data', () => {
  expect(offenders(/\bhref=\{|\bsrc=\{|\bstyle=\{/, all.filter((f) => !f.includes(`${path.sep}components${path.sep}ui${path.sep}`)))).toEqual([]);
});

test('no root-relative fetch or EventSource URL (it would reach cc, not this plugin)', () => {
  expect(offenders(/(?:fetch|EventSource)\(\s*['"`]\//)).toEqual([]);
  expect(offenders(/\bapi(?:<[^>]*>)?\(\s*['"`]\//)).toEqual([]);
});

test('never navigates by location.hash', () => {
  expect(offenders(/location\.hash\s*=[^=]/)).toEqual([]);
});

test('localStorage is used only by lib/storage.ts', () => {
  expect(offenders(/localStorage/)).toEqual([path.join('src', 'lib', 'storage.ts')]);
});

test('colours come from tokens: no literal colours and no Tailwind palette colour classes', () => {
  expect(offenders(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/)).toEqual([]);
  const palette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
  expect(offenders(new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide)-${palette}-\\d`))).toEqual([]);
});

test('no theme toggle of its own', () => {
  const files = all.filter((f) => path.relative(frontend, f) !== path.join('public', 'theme-init.js'));
  expect(offenders(/toggle[-_ ]?theme|theme[-_ ]?toggle|setTheme|classList\.(?:toggle|add)\(\s*['"]dark/i, files)).toEqual([]);
});

test('index.html loads the bridge first and blocking, then the host theme and theme-init', () => {
  const html = readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const tags = [...head.matchAll(/<(script|link)\b[^>]*>/g)].map((m) => m[0]);
  expect(tags[0]).toBe('<script src="/pluginBridge.js" vite-ignore>');
  expect(tags[1]).toBe('<link rel="stylesheet" href="/pluginTheme.css" vite-ignore />');
  expect(tags[2]).toBe('<script src="theme-init.js" vite-ignore>');
  expect(head).not.toMatch(/pluginBridge\.js"[^>]*(defer|async)/);
});
