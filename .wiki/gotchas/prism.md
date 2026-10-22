# Gotcha: Prism in the diff

Code: `frontend/src/features/diff/highlight/`.

- **`Prism.manual` must be set before Prism evaluates.** Otherwise Prism schedules `highlightAll()` on load (DOMContentLoaded or the next frame), which rewrites every `language-*` element's markup. `highlight/prismManual.ts` sets `globalThis.Prism = {manual: true, disableWorkerMessageHandler: true}` and is the **first** import of `highlight/prism.ts`; ES modules evaluate in import order. `prismManual.test.ts` pins both the effect and the import order; `diff.mjs` checks `window.Prism.manual` in the built bundle.
- **Only `Prism.tokenize`.** `Prism.highlight`, `highlightElement` and `highlightAll` return or write HTML; a guard test refuses them in the sources. Tokens become `{text, cls}` segments with classes from `TOKEN_CLASS` only.
- **Grammar order matters**: components assume their base is loaded (`jsx` needs `markup` + `javascript`, `tsx` needs `jsx` + `typescript`, `cpp` needs `c`, `php` needs `markup-templating`). The import list in `prism.ts` is in dependency order.
- **Bounded per file side**: one long line, too many lines, or too many characters in total makes the side plain without calling the tokenizer (`HIGHLIGHT_MAX_*` in `highlight/index.ts`). Each side is tokenized as one text across its hunks, so the caps apply to the side as a whole.
- **Lazy chunk**: `prism.ts` is reached only through `import()` in `useTokenizer`, so the grammars stay out of the main bundle; until it loads, lines render plain.
