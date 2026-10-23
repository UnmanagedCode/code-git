> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md) · [architecture](architecture.md) · [refs](refs.md)

# Undo and redo

Undo and redo of the last registered op on a checkout. The user-facing summary is in [features](features.md); this page is the reference: the registry, the journal, the plans and their steps, the rules that refuse an undo, and the residual risks. Gotchas behind the design: `.wiki/gotchas/undo.md`.

## Registering an op

A write opts in with an `undo` field on its own op definition (`src/git/ops/<feature>.js`):

```
undo(params, result) → UndoPlan | null
```

- Checked by `buildRegistry` at load: a non-function, or an `undo` on a read, throws.
- It reads the op's `params` and `result` (`result.undo`, the record of [refs → Undo record](refs.md#undo-record)); it never runs git.
- `null`, or a plan without steps, records nothing (an outcome that stopped on conflicts, a no-op).
- A later card registers its op the same way; it adds a step kind only when none of the existing ones fits.

## Journal

`createJournal()` in `src/git/undo/journal.js`; `createApp({journal?})` makes one per backend process (injectable for tests) and passes it to the ops route.

| Fact | Value |
|---|---|
| Where | In memory, per backend process. A restart empties it |
| Key | `targetKey(target)`: project, worktree, submodule chain — the frontend's `tabKey` |
| Slots | One undo slot and one redo slot per checkout |
| Entry | `{id, op, plan}`; `id` is a process-wide counter, never reused |

What the ops route does around every op (`journalAround` in `src/git/undo/record.js`):

| Op | Before it runs | After |
|---|---|---|
| A read | nothing | nothing |
| `undo.*` | nothing | the undo op moves its own entry (below) |
| Any other write | **both slots cleared** | success with a plan: the plan goes in the undo slot (redo stays empty). Failure, `null` or an empty plan: the slots stay empty |

- A write not registered for undo clears the slots too: `stash.push` leaves every ref where it was, so a compare-and-swap on refs alone could not tell that an undo would now lose work.
- A plan builder that throws is a code-git bug: logged, the op's result still answered, nothing recorded.
- **Generations**: each clear bumps the checkout's generation. A write records only under the generation its own clear returned, and an undo moves its entry only if no write cleared the slots while it ran — so two writes racing on one checkout never leave an older one's plan in the slot.
