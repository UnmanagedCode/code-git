# code-git wiki

Durable knowledge that is hard to re-derive from the code: gotchas, decisions, glossary. Reference docs live in `docs/`.

- [overview](overview.md) — what code-git is, its shape, and the glossary (target, op, op run, activity entry, tabKey, form A)
- [gotchas/exec-contract](gotchas/exec-contract.md) — cc's `POST /api/exec`: buffered, capped, strict keys; cancel = disconnect; form A only
- [gotchas/git-hardening](gotchas/git-hardening.md) — `--`, literal pathspecs, leading `-`, `--end-of-options`, editors set to `false`, protected env names, `LC_ALL=C`
- [gotchas/host-contract](gotchas/host-contract.md) — CSP on every response, relative URLs, no hash routing, storage prefix, palette snapshot, `setCssPx` for dynamic geometry
- [gotchas/testing-and-harnesses](gotchas/testing-and-harnesses.md) — the fake cc runs real git; hermetic git env; `CC_PROJECTS_ROOT`; live checks are read-only; menu mocks vs setup; leaked async; happy-dom layout; watcher/prefs reset order; `setGraphClock`
- [gotchas/diff-parsing](gotchas/diff-parsing.md) — hunks by count, the raw+numstat join, the config each diff command overrides, `--no-index` gate, gitlinks, empty tree
- [gotchas/prism](gotchas/prism.md) — `Prism.manual` before load, tokenize only, grammar order, per-side caps, lazy chunk
- [gotchas/graph-paging](gotchas/graph-paging.md) — `--skip` over frozen tips on stdin, `--shortstat` cost, `--no-show-signature` / `%G?`, `worktree list -z` (2.36), `--author` ANDs `--grep`, `--disambiguate`, version floors
- [architecture/extension-points](architecture/extension-points.md) — where a later card plugs in, and the decisions behind each registry (menus, ContextMenuHost hosts, the graph's stores)
- [architecture/graph-model](architecture/graph-model.md) — glossary (snapshot, generation, anchor, rows, lanes, checkout vs git worktree) and the graph's design decisions (store-owned triggers, remount restore, jumps)
