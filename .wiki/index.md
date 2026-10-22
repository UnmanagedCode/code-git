# code-git wiki

Durable knowledge that is hard to re-derive from the code: gotchas, decisions, glossary. Reference docs live in `docs/`.

- [overview](overview.md) — what code-git is, its shape, and the glossary (target, op, op run, activity entry, tabKey, form A)
- [gotchas/exec-contract](gotchas/exec-contract.md) — cc's `POST /api/exec`: buffered, capped, strict keys; cancel = disconnect; form A only
- [gotchas/git-hardening](gotchas/git-hardening.md) — `--`, literal pathspecs, leading `-`, `--end-of-options`, editors set to `false`, `LC_ALL=C`
- [gotchas/host-contract](gotchas/host-contract.md) — CSP on every response, relative URLs, no hash routing, storage prefix, palette snapshot
- [gotchas/testing-and-harnesses](gotchas/testing-and-harnesses.md) — the fake cc runs real git; hermetic git env; `CC_PROJECTS_ROOT`; live check is read-only
- [architecture/extension-points](architecture/extension-points.md) — where a later card plugs in, and the decisions behind each registry
