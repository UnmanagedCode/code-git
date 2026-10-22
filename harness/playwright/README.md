# Visual-verification harness

Built on the shared code-playwright helpers (`withPage`, `bootServer`), resolved by `resolve.mjs` from
`$CC_PROJECTS_ROOT/.plugins/code-playwright/browser.mjs`. A shell that code-conductor did not spawn must export
`CC_PROJECTS_ROOT` (the absolute projects root) first.

Build the UI first: `npm install` (or `npm run prepare`) so `frontend/dist` exists. Screenshots land in the gitignored `out/`.

| Script | Run | What it does |
|---|---|---|
| `seed.mjs` | imported | One deterministic world: temp repos behind the test fake cc (`tests/_fakeCc.js`, real git), the backend booted against it. Projects: `app` (ahead 2 / behind 1 of a bare origin, staged + unstaged + untracked changes, worktree `feat`), `box` (System `docker`/`cc-box`), `plain` (not a repo), `gone` (System unreachable), `notes` (claims git but is not a repo: its summary fails) |
| `snap.mjs` | `node harness/playwright/snap.mjs` | Screenshots the empty shell, the open picker, two tabs + header, and the activity panel with an expanded failed entry — light and dark, 1280×800 and 390×844. Fails on a console error or a ≥400 response other than the two host URLs |
| `golden.mjs` | `node harness/playwright/golden.mjs` | Asserts the golden path: picker → open `app` → open worktree `feat` → Ctrl+1 / Ctrl+2 → activity shows the `git status` argv → a held op is cancelled from the panel |
| `live.mjs` | `CONDUCTOR_URL=http://127.0.0.1:<port> node harness/playwright/live.mjs [project[/worktree] …]` | **Read-only** check against a live cc (below) |

## `live.mjs` — read-only against a live cc

- Boots this checkout's backend with `CONDUCTOR_URL` set (`bootServer` picks the free port and passes `PORT`) and drives only the UI's read path: the picker and `repo.summary` (`git status` with `GIT_OPTIONAL_LOCKS=0`).
- Never calls a write route, never registers, rescans or enables the plugin in cc.
- Refuses to run without `CONDUCTOR_URL`, and checks that `$CONDUCTOR_URL/api/health` answers `"app":"code-conductor"`.
- Default checkouts: `code-git`, `code-git/c1-foundation`, `test`, `test/review-demo`; name others as arguments.
- Asserts: the picker lists exactly the names of `GET $CONDUCTOR_URL/api/projects`; every `isGitRepo === false` row is disabled; each checkout's header loads without an error; the activity panel has a `status --porcelain=v2` entry with exit 0 per checkout; Ctrl+1 / Ctrl+2 switch tabs. Screenshots: `out/live/`.

**Finding `CONDUCTOR_URL` from a cc worker session.** The session's environment has no `CONDUCTOR_URL`, but its Claude process was started with an `--mcp-config` naming cc's MCP URL. Walk up from the shell's own process and take the origin, then confirm it:

```bash
p=$$; while [ "$p" -gt 1 ]; do u=$(tr '\0' ' ' < /proc/$p/cmdline | grep -oE '"url":"http://127\.0\.0\.1:[0-9]+' | head -1 | sed 's/"url":"//'); [ -n "$u" ] && break; p=$(awk '/^PPid:/{print $2}' /proc/$p/status); done; echo "$u"
curl -s "$u/api/health"   # → "app":"code-conductor"
```

Other cc instances (scratch ccs) may listen on other ports: never pick one by port scan.
