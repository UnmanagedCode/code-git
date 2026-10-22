# Gotcha: tests and harnesses

- **The fake cc runs real git** (`tests/_fakeCc.js`). It validates the exec body like cc and spawns git in the project's directory, so runner/op tests exercise real porcelain output, hooks and exit codes. A `system: 'docker'` project in the fake still runs locally — the point is that code-git addresses it by name alone.
- **Hermetic git env** (`hermeticEnv` in `tests/_git.js`): temp `HOME`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` = a temp file with identity, `commit.gpgsign=false`, `init.defaultBranch=main`, `protocol.file.allow=always`. Without it, a developer's own config (signing, hooks path, default branch) leaks in.
- **`execHook` returning `'hold'`** parks a request until `release()`; `nextHeld()` waits for it without sleeping. Use it for lock-ordering, cancel and disconnect tests. `held.disconnected` tells a client abort from a normal answer.
- **`fakeCc` sets `process.env.CONDUCTOR_URL`** and restores it on `close()`; `node --test` runs each file in its own process, so files don't collide.
- **UI stores are module singletons**: every new store needs a reset in `frontend/src/test/setup.ts`, or state leaks between tests.
- **In happy-dom, Radix menus open with `userEvent.click`** on the trigger; a right-click is `fireEvent.contextMenu`. Testing Library's ByRole `name` string is already exact (no `exact` option there); Playwright's `getByRole` name *is* substring by default — pass `exact: true`.
- **To send a path like `/api/repos/%2E%2E/x` unnormalised, use `http.get({hostname, port, path})`.** `fetch` and `http.get(urlString)` parse a WHATWG URL and collapse `%2E%2E` client-side, so the server never sees it.
- **The colour guard exempts `components/ui/`** (copied cc components keep `bg-black/40`, `text-white`); a test feeds the patterns known-bad and known-good classes so the guard cannot silently stop matching.
- **Harnesses need `CC_PROJECTS_ROOT`** (exported by cc into workers; export it yourself elsewhere) to find code-playwright and code-mutant. Never search for them.
- **`harness/playwright/live.mjs` is read-only by contract**: only the picker and `repo.summary`. Never Rescan/Enable the plugin in a live cc from a worker; find the live cc's URL from the session's `--mcp-config`, never by port scan (scratch ccs listen too). See `harness/playwright/README.md`.
- **Mutation harness isolation is `copy`**: tests never run git inside the project tree (only in temp repos), so the copy's missing `.git` doesn't matter.
