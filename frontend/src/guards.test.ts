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
    'src/features/repos/RepoPicker.tsx', 'src/features/repo/RepoHeader.tsx', 'src/lib/api.ts', 'src/components/ui/button.tsx',
    'src/features/diff/DiffPanel.tsx', 'src/features/diff/highlight/prism.ts', 'src/lib/download.ts',
    'src/features/graph/GraphPanel.tsx', 'src/features/graph/LaneSvg.tsx', 'src/features/graph/RefChip.tsx', 'src/features/graph/drag.ts',
    'src/features/graph/details/CommitDetails.tsx', 'src/shell/ContextMenuHost.tsx', 'src/lib/cssVars.ts',
    'src/features/workdir/WorkdirPanel.tsx', 'src/features/workdir/CommitBox.tsx', 'src/features/staging/SelectionBar.tsx', 'src/lib/confirm.ts']) expect(seen).toContain(must);
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

test('object URLs and download links are built only in lib/download.ts', () => {
  expect(offenders(/URL\.createObjectURL|\.download\s*=[^=]|\.href\s*=[^=]/)).toEqual([path.join('src', 'lib', 'download.ts')]);
});

// Prism's own highlight functions build markup from the text; only its data tokenizer may be used.
test("Prism's markup-building highlight functions are never called", () => {
  expect(offenders(/Prism\.highlight\b|highlightElement|highlightAll/)).toEqual([]);
});

test('never navigates by location.hash', () => {
  expect(offenders(/location\.hash\s*=[^=]/)).toEqual([]);
});

test('localStorage is used only by lib/storage.ts', () => {
  expect(offenders(/localStorage/)).toEqual([path.join('src', 'lib', 'storage.ts')]);
});

// Colour utilities that bypass the tokens: a palette shade, white/black, or an arbitrary value that is not a var().
const UTIL = '(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|shadow|accent|caret|placeholder)';
const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
const COLOUR_CLASS = new RegExp(`\\b${UTIL}-(?:${PALETTE}-\\d|(?:white|black)\\b|\\[(?!var\\()[^\\]]*\\])`);

test('the colour patterns catch what they claim to', () => {
  for (const bad of ['text-red-500', 'bg-white', 'text-black/40', 'bg-black/40', 'border-[#fff]', 'bg-[red]', 'text-[rgb(0,0,0)]', 'fill-[oklch(1_0_0)]']) {
    expect(COLOUR_CLASS.test(bad) || LITERAL_COLOUR.test(bad), bad).toBe(true);
  }
  for (const ok of ['bg-card', 'text-muted-foreground', 'fill-[var(--primary)]', 'bg-primary/15', 'text-destructive', 'border-border', 'max-h-[60dvh]', 'text-xs']) {
    expect(COLOUR_CLASS.test(ok) || LITERAL_COLOUR.test(ok), ok).toBe(false);
  }
});

// components/ui/ is exempt: copied cc components carry a few literal colours plugin-ui.md permits (bg-black/40, text-white).
test('colours come from tokens outside components/ui: no literal colours, white/black, palette or arbitrary colour classes', () => {
  const own = all.filter((f) => !f.includes(`${path.sep}components${path.sep}ui${path.sep}`));
  expect(own.length).toBeLessThan(all.length);
  expect(offenders(LITERAL_COLOUR, own)).toEqual([]);
  expect(offenders(COLOUR_CLASS, own)).toEqual([]);
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

// Dynamic geometry goes through lib/cssVars.ts (finite px numbers only); nothing else touches an element's style.
const STYLE_ACCESS = new RegExp([
  String.raw`\.style\b(?!-)`, // el.style.x, el.style[k]
  String.raw`\[\s*['"\`]style['"\`]\s*\]`, // el['style']
  String.raw`\battributeStyleMap\b`, // the typed-OM style map
  String.raw`\bsetAttribute(?:NS)?\([^)]*['"\`]style['"\`]`, // setAttribute('style', …), setAttributeNS(ns, 'style', …)
  String.raw`\bcssText\b`,
].join('|'));

test('the style-access pattern catches what it claims to', () => {
  for (const bad of [
    'el.style.setProperty("--x", v)', 'node.style.top = y', "el.setAttribute('style', s)", 'x.style.cssText = s', 'el.style[k] = v',
    "el['style'].top = y", 'el["style"] = s', 'el[ `style` ]', "el.attributeStyleMap.set('top', CSS.px(1))",
    "el.setAttributeNS(null, 'style', s)", 'el.setAttributeNS(SVG_NS, "style", s)', 'el.setAttribute( "style" , s)',
  ]) expect(STYLE_ACCESS.test(bad), bad).toBe(true);
  for (const ok of [
    'setCssPx(el, "--x", 3)', "className='border-style-dashed'", 'const styles = 1', 'list-style-none', 'stylesheet',
    "el.setAttribute('data-style', s)", "el['styles']", "setAttributeNS(null, 'class', s)",
  ]) expect(STYLE_ACCESS.test(ok), ok).toBe(false);
});

test('no .style access outside lib/cssVars.ts and components/ui', () => {
  const own = all.filter((f) => !f.includes(`${path.sep}components${path.sep}ui${path.sep}`));
  expect(offenders(STYLE_ACCESS, own)).toEqual([path.join('src', 'lib', 'cssVars.ts')]);
});
