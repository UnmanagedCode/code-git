# Visual-verification harness

Built on the shared code-playwright helpers (`withPage`, `bootServer`), resolved by `resolve.mjs` from
`$CC_PROJECTS_ROOT/.plugins/code-playwright/browser.mjs`. A shell that code-conductor did not spawn must export
`CC_PROJECTS_ROOT` (the absolute projects root) first.

Build the UI first: `npm install` (or `npm run prepare`) so `frontend/dist` exists. Screenshots land in the gitignored `out/`.

| Script | Run | What it does |
|---|---|---|
| `seed.mjs` | imported | One deterministic world: temp repos behind the test fake cc (`tests/_fakeCc.js`, real git), the backend booted against it. Projects: `app` (ahead 2 / behind 1 of a bare origin, staged + unstaged + untracked changes, worktree `feat` locked in cc), `box` (System `docker`/`cc-box`), `plain` (not a repo), `gone` (System unreachable), `notes` (claims git but is not a repo: its summary fails), `diffs` (`tests/_diffRepo.js`: every diff source and file state under a hostile `.git/config`) |
| `snap.mjs` | `node harness/playwright/snap.mjs` | Screenshots the empty shell, the open picker, two tabs + header, and the activity panel with an expanded failed entry — light and dark, 1280×800 and 390×844. Fails on a console error or a ≥400 response other than the two host URLs |
| `golden.mjs` | `node harness/playwright/golden.mjs` | Asserts the golden path: picker → open `app` → open worktree `feat` → Ctrl+1 / Ctrl+2 → activity shows the `git status` argv → a held op is cancelled from the panel |
| `diff.mjs` | `node harness/playwright/diff.mjs` | Asserts the diff path on `diffs`, in light then dark: a bad ref refused inline → `HEAD~1` from Compare → Hunk (syntax tokens, word emphasis, hunk headers) → Inline (file lines + deleted lines) → Split (both sides, Wrap at phone width) → File view → Ctrl+F / Alt+↓ → binary, rename, LFS, oversized, submodule states → untrusted `<img>` text and `window.Prism.manual` → patch download (name, `From <oid>`) → unstaged / staged / `main..side` vs `main...side` → Esc. Screenshots `out/diff-*-{light,dark}.png`, Hunk and Split also at phone width (opened on desktop, then resized). Fails on a console error or a ≥400 response other than the one deliberate `REV_UNKNOWN` |
| `live.mjs` | `CONDUCTOR_URL=http://127.0.0.1:<port> node harness/playwright/live.mjs [project[/worktree] …]` | **Read-only** check against a live cc (below) |
| `graphSeed.mjs` | imported | The commit graph's own world (separate from `seed.mjs`): `lanes` — a small merge/branch topology with tags, a stash, a dirty main checkout, cc worktree `wt` (dirty, on `feature/b`) and `side` (clean), a `Co-authored-by` commit and an HTML-looking subject (the header comment of `graphSeed.mjs` has the exact shape); `big` — the perf fixture (`tests/_graphFixture.js` defaults) |
| `graph.mjs` | `node harness/playwright/graph.mjs` | Asserts the graph on `lanes` through data attributes (lanes, WIP rows, labels, stash placement, hide/solo/pin persisted, columns persisted and aligned, search modes, keyboard, selection, details, menus, hover dimming, drag target, untrusted text, the refs panel above the Compare panel in the left slot, a details file opening its diff and Esc returning to the graph), then screenshots light/dark × 1280×800/390×844 plus the phone dialogs (Refs, Compare, Details) into `out/graph/`. Fails on a console error or a ≥400 response other than the two host URLs |
| `graph-perf.mjs` | `node harness/playwright/graph-perf.mjs` | The scroll measurement on `big` (conditions and gates: [docs/graph.md → Performance](../../docs/graph.md#performance)); writes `out/graph-perf.json` |
| `live-graph.mjs` | `CONDUCTOR_URL=http://127.0.0.1:<port> node harness/playwright/live-graph.mjs [project[/worktree]]` | **Read-only** scroll measurement of a live checkout's graph (default `code-conductor`); gate: the DOM bound only; writes `out/live/graph-perf.json` and `out/live/graph.png` |

## `live.mjs` — read-only against a live cc

- Boots this checkout's backend with `CONDUCTOR_URL` set (`bootServer` picks the free port and passes `PORT`) and drives only the UI's read path: the picker and `repo.summary` (`git status` with `GIT_OPTIONAL_LOCKS=0`).
- Never calls a write route, never registers, rescans or enables the plugin in cc.
- Refuses to run without `CONDUCTOR_URL`, and checks that `$CONDUCTOR_URL/api/health` answers `"app":"code-conductor"`.
- Default checkouts: `code-git`, `code-git/c1-foundation`, `test`, `test/review-demo`; name others as arguments.
- Asserts: the picker lists exactly the names of `GET $CONDUCTOR_URL/api/projects`; every `isGitRepo === false` row is disabled; each checkout's header loads without an error and shows HEAD as a branch, or the detached or unborn badge (for a worktree on a branch, whether it is the branch cc recorded is printed as a note, not required: HEAD may have moved since); the activity panel has a `status --porcelain=v2` entry with exit 0 per checkout; Ctrl+1 / Ctrl+2 switch tabs. Screenshots: `out/live/`.

**Finding `CONDUCTOR_URL` from a cc worker session.** The session's environment has no `CONDUCTOR_URL`, but its Claude process was started with an `--mcp-config` naming cc's MCP URL. Walk up from the shell's own process and take the origin, then confirm it:

```bash
p=$$; while [ "$p" -gt 1 ]; do u=$(tr '\0' ' ' < /proc/$p/cmdline | grep -oE '"url":"http://127\.0\.0\.1:[0-9]+' | head -1 | sed 's/"url":"//'); [ -n "$u" ] && break; p=$(awk '/^PPid:/{print $2}' /proc/$p/status); done; echo "$u"
curl -s "$u/api/health"   # → "app":"code-conductor"
```

Other cc instances (scratch ccs) may listen on other ports: never pick one by port scan.

## `live-graph.mjs` — read-only graph measurement

- Same refusals as `live.mjs`: no `CONDUCTOR_URL`, or `$CONDUCTOR_URL/api/health` not answering `"app":"code-conductor"`, stops it. Find the URL as above.
- Opens the checkout by URL (`?project=…`), so the picker is never used, and scrolls its graph to the end of the snapshot.
- What runs: `repo.summary` of each of the project's cc checkouts and the `graph.*` ops — all `kind: 'read'` with `GIT_OPTIONAL_LOCKS=0` — plus cc's project and worktree listings. The script fails if the page calls any other op or any non-read command lands in the activity log.
- Never Rescans, Enables or restarts anything.
