# Mutation-verification harness

Driven by the shared code-mutant runner; this directory holds only its `config.json`. Run from the project root:

```bash
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline     # trust gates: clean tree, green baseline, canary
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" validate     # pre-flight a catalog, runs no tests
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" run --all    # run the catalog in .mutation/mutants.json
node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" --help       # everything else
```

A shell that code-conductor did not spawn must `export CC_PROJECTS_ROOT=<absolute projects root>` first. Run outputs land in the gitignored `.mutation/`.

## Config (`config.json`)

| Key | Value | Why |
|---|---|---|
| `routes` | `server` (runner `node-test`, `tests/*.test.js`) and `ui` (runner `vitest`, `frontend/src/**/*.test.ts` + `.tsx`) | The project has two test runners; each route's commands are `npm run test:server` / `test:ui` in the runner's reporting form. `baselineCommand` spans each runner's whole suite |
| `isolation` | `copy` | The suites are in-process: tests run git only in their own temp repos, never in the project tree, and boot servers only on temp ports. A copy has no `.git`, which nothing here needs |
| `preserve` | `["node_modules"]` | Symlinked into the copy |
| `baseBranch` | `master` | The integration branch |

The typecheck (`npm run typecheck`) is deliberately not in either command: a counted-grade command must exit 0 whenever no test failed.

## Verified baseline

`mutate.mjs baseline` (with the canary) on the committed tree, copy isolation:

| Gate | Result |
|---|---|
| clean-tree | PASSED |
| baseline | PASSED — 140 passed / 0 failed / 0 skipped (server 81/0/0, ui 59/0/0), exit 0 |
| canary | KILLED in every route (server via `tests/activity.test.js`, ui via `frontend/src/App.test.tsx`) |
