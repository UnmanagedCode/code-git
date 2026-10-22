# Gotcha: living inside cc's frame

Source of truth: cc's `docs/plugin-ui.md`. What code-git does about it, and why it matters:

- **CSP + nosniff on every response**, the 404, 503, API errors and parser-rejected requests included (`server.on('clientError')` in `server.js`, since Node answers those before Express). Express's default 404/error pages would replace the CSP, hence the explicit terminal handlers in `src/app.js`.
- **`style-src 'unsafe-inline'`** is there only for Radix (dropdown, dialog). Consequence: never put a `style` attribute or `<style>` built from content — injected CSS is live. `guards.test.ts` scans for `style={`, `href={`, `src={`.
- **Dynamic geometry goes through `setCssPx`** (`frontend/src/lib/cssVars.ts`): a custom property set to a finite px number, read by a Tailwind class (`h-(--graph-total)`, `translate-y-(--graph-offset)`, `w-(--col-author)`). It throws on a non-finite number or a name outside `--[a-z][a-z0-9-]*`, so no style is ever built from content; `guards.test.ts` fails on any other `.style`, `cssText` or `setAttribute('style'…)` outside `components/ui/`.
- **Colours derived from the theme**: the graph's lane colours are `oklch(from var(--primary) l c calc(h + N))` in `graph.css` — they follow cc's theme and add no literal colour (a test pins the classes).
- **Path-segment names:** `assertTarget` refuses `.` and `..`; a `..` project spliced into `/api/projects/<name>/worktrees` would normalise to another cc route.
- **Every URL is relative** (`api/…`, `api/activity/events`). A root-relative `/api/x` reaches *cc's* API, not ours. `api()` throws on a leading `/`; a guard test scans sources.
- **No hash routing.** A hash change adds a joint history entry the bridge cannot collapse. The active tab is in the query string, written with `pushState` (the bridge makes it `replaceState`), read on load and `popstate`.
- **`localStorage` keys are prefixed `code-git:`** and only `lib/storage.ts` touches storage: plugins share cc's origin.
- **Ctrl/⌘+digit only reaches us while focus is in our frame**; with focus in cc, cc handles the key. Documented, not fixable from the plugin.
- **Palette:** `cc-theme-fallback.css` is a one-time snapshot inside `@layer base`; embedded, cc's unlayered `/pluginTheme.css` wins regardless of order. Never "update" the snapshot to track cc. `palette.test.ts` pins it, so an edit is deliberate.
- **Static serving is an allowlist** (`ASSET_RE` in `src/http/static.js`), tested on the *decoded* path so `%2Emap` is refused; `sendFile` with a relative name, because an absolute one under a dot-directory (`.worktrees/`, `.plugins/`) trips `dotfiles: 'deny'`.
