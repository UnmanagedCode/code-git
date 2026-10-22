> The feature reference the code-git roadmap cards plan against.

# GitKraken Desktop (v11.x–12.6.x) — local repository-management feature inventory

Reference for the code-git plugin. Sourced from help.gitkraken.com (current docs through Desktop 12.6.x) and gitkraken.com feature/learn pages. Hosting-provider integrations (PRs, issues, Jira, Launchpad, Cloud Workspaces/Patches, Teams, Agent Sessions) are out of scope.

**Out of scope for code-git, deliberately:** clone/init/arbitrary open (code-git manages cc projects only), in-app terminal, external diff/merge tools, profiles/credentials/SSH & GPG key generation, a general file editor, worktree create/remove (cc owns worktrees), AI features.

**AI (note only):** GitKraken AI generates commit/stash messages, explains commits/WIP/branches, auto-resolves conflicts (preview) and recomposes commits. Not in scope.

---

## 1. Repo management (open / init / clone / tabs)
- Repository Management tab: Browse / Clone / Init, lists of open, favorite and recent repos by group; groups can be reordered, coloured, hidden; column widths persist.
- New Tab page (+ or Ctrl/Cmd+T): Open/Clone/Init, recent/favorite repos, search (Ctrl/Cmd+Alt+F).
- Open: Ctrl/Cmd+O (system dialog), Ctrl/Cmd+Shift+O (via Command Palette), Ctrl/Cmd+Alt+O (Repo Management); a non-repo folder is searched for repos in subfolders.
- Clone: URL or provider; shallow (branch, depth, since date, custom flags), sparse checkout (one path per line); prompts to init submodules; auto `git lfs pull`.
- Init: path, `.gitignore` template, LICENSE, README, "Initialize with LFS"; default branch name from Preferences (default `main`).
- Multiple repo tabs: Ctrl/Cmd+1..9, Ctrl+Tab cycle, middle-click/Ctrl+W close, drag to reorder, tab dropdown, hover shows path, right-click "Alias repository"; worktrees of one repo grouped; "Remember Tabs" restores on restart.
- Toolbar repo / branch breadcrumb dropdowns, both searchable; picking a branch checks it out (worktrees listed first).
- Favorites (star repos).
- Open in file manager / terminal / editor / IDE / external diff tool (Ctrl/Cmd+D).
- "Perform Repo Maintenance" → `git maintenance run`.
- Activity Logs (footer): Application tab and Repository tab (per-repo git ops with timestamp, duration, hook output; extended logging adds raw git commands).

## 2. Commit graph
- DAG, newest on top, coloured branch lanes; labels take their lane colour; avatar or initials on nodes.
- Node types: commit, merge commit, WIP, branch label, stash node.
- `// WIP` node at the top when the tree is dirty; type a stash or commit summary directly into it. One WIP row per worktree with changes (shows its branch or detached commit) plus "Open worktree". Checking out auto-selects WIP.
- Columns: Branch/Tag, Graph, Commit Message by default; optional Author, Date/Time, SHA, Changes (file count plus green/red bar). Drag to reorder, drag dividers to resize, toggle via header right-click or gear. Saved per repo.
- Options: compact graph column, inline commit descriptions, emoji, avatars vs initials, dim merge commits, host icons; date format follows OS or custom.
- AUTHOR column filter (by author / team member; email-case-insensitive).
- Hovering a branch/tag highlights its commits and fades the rest (toggleable). Hover or select shows a "ghost branch" label for the nearest containing branch; double-clicking the ghost label checks it out.
- Pin to left (right-click branch); a pin icon jumps to it.
- Hide (eye icon / right-click) and Solo (orange icon; hides all else); whole remotes; bulk Hide all / Show all per section. "Smart Branch Visibility" shows only the checked-out branch, its target and their upstreams.
- Loading: 2000 commits initially (minimum 500), "Show All Commits", lazy loading; search only covers loaded commits.
- Selection: click opens the Commit Panel; clicking it again deselects. Shift-click selects a range; Ctrl/Cmd-click multi-selects or adds WIP.
- Keyboard: j/k or arrows move up/down; h/l or left/right go between commit and its first file; Shift+j/k move to the next commit on the same branch; Ctrl+Home/End jump to the first/last commit ("first" selects WIP or a conflict if present).
- Commit context menu:
  - checkout (detached), create branch here, create worktree;
  - cherry pick, revert;
  - "Reset <branch> to this commit" › Soft/Mixed/Hard;
  - create tag / annotated tag here;
  - interactive rebase, "Rebase onto this commit" (commits with no branch label);
  - compare against working directory, copy SHA, create patch, solo/hide.
- Multi-select context menu: cherry pick N commits, squash N commits, create patch; combined diff.
- **Drag and drop**: a branch onto a branch opens an action menu (Merge / Rebase / Interactive Rebase / Fast-forward / Reset); a branch onto a remote branch pushes.
- A warning icon on the REMOTES header when auto-fetch fails silently.

## 3. Commit panel / details (right panel)
- Selected commit: summary and description, author and co-authors, timestamp, SHA, parents, signature badge (hover shows GPG status). Files colour-coded: modified, added, deleted, renamed.
- File list: Path view / Tree view toggle; "View all files" switches to the full repo tree with a Filter Files bar.
- File context menu:
  - File History, Blame;
  - "Restore file from this commit" (multi-select too; restored files land staged);
  - open in external editor or diff tool, edit, delete, create patch.
- Multi-commit: a combined diff of consecutive commits (can include WIP). More than two non-consecutive commits shows a message instead.
- Ctrl/Cmd+K toggles the panel; resizable; Esc closes.

## 4. Working tree & staging
- Unstaged Files, Staged Files, then the message box; Commit and Stash tabs.
- Stage/Unstage per file on hover, or S / U for the current file; stage all (Ctrl/Cmd+Shift+S), unstage all (Ctrl/Cmd+Shift+U).
- Partial staging: select lines in the diff › "Stage selected lines"; Stage Hunk / Unstage Hunk buttons.
- Discard: all (trash icon), "Discard selected", per hunk or per line in the diff. Discard all is undoable.
- Ignore: right-click › Ignore › this file / all `*.ext` / this directory. Writes the root `.gitignore`; nested `.gitignore` files aren't parsed. Tracked files also offer "Ignore and Stop Tracking" (removes from the index).
- Create file (`dir/file.ext` creates folders), delete file; rename detection is kept when staging.
- In-app editor: Edit file, Ctrl/Cmd+S, unsaved-changes dot, "Save and stage", markdown preview, per-file encoding with "Guess Encoding".
- LFS tag on LFS files; right-click › LFS › Track file pattern.
- Detached-HEAD warning banner.

## 5. Commit & amend
- Summary and Description fields, resizable box; Ctrl/Cmd+Shift+M focuses it.
- Ctrl/Cmd+Enter commits staged; Ctrl/Cmd+Shift+Enter stages all and commits.
- "Push after committing" checkbox, with a per-repo default; the button becomes "Commit changes to N files and Push".
- "Amend previous commit" checkbox. Message-only amend: select HEAD, edit, then "Update Message" / "Cancel Amend".
- "Skip Git hooks" checkbox.
- Commit template: reads `commit.template` (local, then global), else writes `.git/gkcommittemplate.txt`; "Apply this template"; "Remove comments" respects `core.commentChar`.
- `Co-authored-by:` trailers shown in details.
- Squash N commits: multi-select a straight ancestor line (no merges; the oldest must have a parent) › right-click; edit the combined message.
- Older commits are reworded through interactive rebase. Ctrl/Cmd+Z undoes a commit.

## 6. Diff viewing
- Modes:
  - Hunk: changed blocks only, with a per-hunk Revert that applies the inverse as unstaged changes.
  - Inline: the full file.
  - Split: side by side.
- Word-level highlighting, syntax highlighting (toggleable), minimap, word wrap, next/previous change arrows.
- Diff View ↔ File View (full file content plus blame). Ctrl/Cmd+F searches within the file.
- Sources:
  - a WIP file (unstaged or staged);
  - a commit file;
  - two commits (Shift-click), giving a direct comparison;
  - a consecutive range, giving a combined diff;
  - WIP plus a commit (Ctrl-click), or "Compare commit against working directory".
- External diff/merge tools: Beyond Compare, FileMerge, Kaleidoscope, KDiff, Araxis, P4Merge, or Git Config Default.
- Patches: create from a commit, a selection or WIP; apply a `.patch` file. No binary files.
- LFS diffs show pointer metadata (URL, SHA, size).
- Editor prefs: font, size, tab width, EOL, line numbers, wrap.

## 7. Branches
- Create: toolbar Branch button / Ctrl/Cmd+B (from HEAD); right-click a commit, tag or detached HEAD › Create branch here.
- Checkout: double-click the label (graph or left panel), or right-click › Checkout. A remote branch becomes a local tracking branch, fast-forwarded if possible. Checkout is undoable.
- Rename (right-click or palette); delete, including multi-select bulk delete and remote branch delete (undoable for local branches).
- Set upstream; the first push prompts for a remote branch name. Ahead/behind counts in the left panel.
- Fast-forward a branch that isn't checked out.
- Pin/unpin left, hide/solo, copy branch name, create worktree from a branch.
- Left panel:
  - Sections: Local, Remote (grouped per remote, with folders by `/` prefix), Tags, Stashes, Submodules, Worktrees, Gitflow.
  - Each section is collapsible, resizable and can be hidden; double-click maximises it.
  - The filter (Ctrl/Cmd+Alt+F) also matches `origin/x`.

## 8. Tags
- Lightweight ("Create tag here") and annotated ("Create annotated tag here", or "Annotate tag" on an existing one); also via the palette.
- The annotation message shows on hover.
- Push tag; "Delete <tag> locally"; "Delete <tag> from <remote>" (runs pre-push).
- Double-click jumps to the tag's commit; check out the tag's commit (detached); create branch here.
- Move a tag with right-click › Fast-forward.
- "Sign Tags by Default"; Tags filter bar; hide/solo; hide remote tags.
- Gitflow release finish tags automatically, with a prefix (e.g. `v`).

## 9. Remotes (fetch / pull / push)
- Pull dropdown:
  - Fetch All (Ctrl/Cmd+L);
  - Pull (fast-forward if possible, else merge);
  - Pull (fast-forward only), i.e. `fetch && merge --ff-only`;
  - Pull (rebase), i.e. `fetch && rebase`.
- The icon next to a pull option sets the default strategy. Pull All. Pulling a branch that isn't checked out fast-forwards it.
- Auto-fetch every 0–60 min (0 = off; default 1 min); Auto-Prune.
- Push from the toolbar, right-click, or drag onto a remote branch; prompts to create the remote branch if missing.
- Force push:
  - offered when the push is rejected as not fast-forward;
  - uses `--force-with-lease` and warns if the tracking ref is stale;
  - the confirmation can be turned off in settings.
- Remotes: add (URL or a provider fork), edit, remove (undoable), hide/solo a whole remote, icons by host.
- Credentials: SSH keys (generate or use the agent), Git Credential Manager, "Forget All Credentials".

## 10. Merge
- Drag a branch onto the target › Merge, or right-click › "Merge <a> into <b>"; fast-forwards when possible.
- Squash merge preference stages the result without a merge commit.
- Conflicted files are listed in the Commit Panel and open the Merge Tool (§12).
- "Delete .orig files" setting; the post-merge hook runs.
- Conflict Prevention:
  - compares the current branch with its target branch;
  - toolbar indicator ("Up to Date with Merge Target" or an alert) with merge/rebase buttons;
  - per-repo base-branch include/exclude globs.

## 11. Rebase & interactive rebase
- Rebase: drag › Rebase; right-click › "Rebase <a> onto <b>"; "Rebase onto this commit"; "Rebase N commits onto <branch>" (shift-select range).
- Interactive rebase from drag, a branch right-click, or a parent commit right-click.
- Editor:
  - one row per commit with an action dropdown: Pick (P), Reword (R), Squash (S, into the commit above), Drop (D); single-key shortcuts;
  - drag or move up/down to reorder; the first commit can be dropped;
  - Reword opens a summary/description modal;
  - Reset undoes edits; Start/Confirm runs it.
  - No Edit or Fixup actions are documented. **code-git adds Edit and Fixup.**
- Restrictions: no merge commits on the source, not the initial commit, not a parent onto its child; a rebase started in GitKraken must finish there.
- Interactive rebase, drop and reword are undoable (v11.7+).

## 12. Conflict resolution
- Conflicted files are listed in the Commit Panel; Ctrl+Home selects the conflict.
- Merge Tool:
  - Three panes: Current (left) and Target/Incoming (right) on top, an editable Output pane below.
  - Per-hunk and per-line checkboxes or + buttons copy lines into Output; "Select all" per side.
  - Type directly in Output; arrows jump between conflicts; Ctrl/Cmd+F; word wrap.
  - Save, then "Mark resolved" moves the file to staged; then commit or continue.
- Quick path: right-click a conflicted file › "Take current (<branch>)" / "Take incoming (<branch>)".
- External merge tools (same list as diff tools).
- Rebase and merge offer continue/abort from the commit panel. **No in-UI abort for cherry-pick or a conflicted merge** (an open feature request). **code-git provides abort for all of them.**

## 13. Cherry-pick / revert / reset
- Cherry pick a commit (onto the checked-out branch), or a branch's HEAD from the left panel.
- Multi-select › "Cherry pick N commits" opens an interactive editor (Pick/Reword/Squash/Drop, P/R/S/D, drag to reorder, Reset). Undoable.
- Revert creates an inverse commit; per-hunk revert from the Hunk diff view.
- "Reset <branch> to this commit" › Soft (keep staged), Mixed (keep working tree), Hard (discard). Drag-drop also offers Reset. Treat Hard as not undoable (the docs conflict).
- Restore files from any commit (§3).

## 14. Stash
- Toolbar Stash (everything) or the Stash tab in the Commit Panel. Name it by typing into the WIP row or summary field; multi-line descriptions.
- Partial stash: selected files or hunks.
- Stashes appear as graph nodes and in the left panel Stashes section.
- Context menu: Apply, Pop, Delete, Edit stash message (rename), Hide, Hide all / Show all. Toolbar Pop restores the latest stash. Apply per file: select the stash, then right-click a file.
- Include-untracked is not documented. **code-git provides include-untracked and keep-index.**

## 15. Submodules
- Left panel Submodules section, sorted alphabetically.
- Add: + on the section header, then URL and path; writes `.gitmodules`.
- Context menu: Initialize, Update (fetch and check out the recorded commit), Open, Edit, Delete.
- Changing the pointer: Open the submodule (it gets its own repo view), check out a new commit or branch, exit; GitKraken prompts to commit the new pointer in the parent.
- Status handling:
  - "out of sync": offers stash, commit or discard;
  - "added but not committed": commit the folder plus `.gitmodules`.
- "Keep submodules up to date", global or per repo; LFS pull runs on init.

## 16. Worktrees
GitKraken creates and removes worktrees; in cc that belongs to cc, so code-git only shows them and switches between them.
- Create from a branch or commit, or + on the section; new worktrees inherit view state.
- List: shows the folder name, hover path, WIP and ahead/behind; sort and filter.
- Context menu: open in place or in a new tab, lock/unlock, remove, "remove and delete branch".
- Graph: a worktree icon on branches checked out elsewhere; a WIP row per dirty worktree with "Open worktree".

## 17. History (file history, blame, reflog)
- File History: from a diff's History button, file right-click, palette "History <file>", or Ctrl/Cmd+Shift+H. Lists the commits that touched the file, each with its diff or full file.
- Blame: button, right-click or palette; lines colour-coded per author with author/date annotations; Diff/File view toggle.
- **No reflog UI** in GitKraken (feature request open). **code-git provides a reflog view.**
- Activity log covers operation history.

## 18. Undo / redo
- Toolbar Undo and Redo; Ctrl/Cmd+Z, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z; also in the palette.
- Undoable: checkout, commit, discard (including discard all), delete branch, remove remote, reset branch to a commit, interactive rebase, multi cherry-pick, drop/reword.
- Only the single most recent supported action can be undone. Pushed operations, and anything not safely tracked, are excluded. Undo does not abort an in-progress cherry-pick.

## 19. Git-flow
- Initialize in Preferences › Gitflow: `main`/`develop` names, feature/release/hotfix prefixes, version-tag prefix; creates branches if missing.
- Gitflow panel: a green start button for Feature / Release / Hotfix; branches grouped in folders.
- Finish:
  - Feature merges into develop and deletes the branch (optionally rebasing on develop first).
  - Release merges into main and develop, then tags (prompts for a message).
  - Hotfix merges into main and develop.

## 20. LFS
- Initialize (then commit `.gitattributes`), or "Initialize with LFS" on init.
- Track patterns in preferences or with right-click › LFS › Track file pattern; new patterns apply to new files only.
- Toolbar LFS menu: Pull and Prune (prune warns that it is destructive).
- LFS pull runs automatically after clone or submodule init; LFS file tag; pointer metadata in diffs.
- Requires Git ≥ 2.39.3 and git-lfs ≥ 3.0.

## 21. Hide / solo / focus
- Hide per ref (eye icon on hover), per remote, or per section (Local, Remote, Tags, Stashes). "Show All" appears only when something is hidden.
- Solo per ref (orange icon); clicking semi-transparent icons adds or removes soloed refs; a whole remote can be soloed.
- Smart Branch Visibility, Pin to left, hide remote tags/branches, author filter.

## 22. Signing
- GPG: program path, key dropdown, generate a key, copy the public key; auto-populated from gitconfig.
- SSH signing: GPG Format = SSH, a `.pub` key, an allowed_signers file.
- Sign commits/tags by default; honours `commit.gpgsign`.
- Verification badge next to the SHA; hover shows GOODSIG / EXPSIG / BADSIG / ERRSIG.

## 23. Hooks
- Hook triggers:
  - pre-commit and commit-msg: commit, amend, merge-resolve;
  - prepare-commit-msg: commit, amend, cherry-pick, merge, revert, squash;
  - post-commit, pre-rebase, post-checkout, post-merge, post-rewrite;
  - pre-push: pushes and remote deletes.
- Hooks path: `.git/hooks`, a per-repo custom path, or `core.hooksPath`.
- A non-zero exit blocks the action with an error toast linking to the output, which streams into the Activity Log. "Skip Git hooks" applies to commits.

## 24. Search / command palette / shortcuts
- Ctrl/Cmd+F searches commits by message, SHA or author, highlighting live in the graph (loaded commits only). Marketing also lists file, code-change, @me and date filters.
- Command Palette (Ctrl/Cmd+P), the successor to the Fuzzy Finder, live-filtered:
  - Repo: open, clone, init, close.
  - Settings: Gitflow, LFS, GPG; switch profile; theme.
  - View: zoom; toggle panels and syntax highlighting.
  - History and Blame `<file>`, Search Commits.
  - Undo and Redo.
  - Files: Create, Delete, Open, View, Edit; Stage, Unstage, Discard all.
  - Stash: Create, Apply, Pop.
  - Branches: Create, Rename, Checkout `<branch>`; tags; Fetch, Pull, Push; View Working Directory Changes.
  - Patch create/apply; logs.
- Ctrl/Cmd+/ lists all shortcuts; Ctrl/Cmd+Alt+F focuses the left panel filter; Ctrl/Cmd+J toggles the left panel; Ctrl/Cmd+K toggles commit details; zoom with Ctrl/Cmd +/−/0.

## 25. Terminal
In-app terminal tabs per repo/worktree with git autocomplete; drag a file into it to insert its path. Out of scope for code-git.

## 26. Settings relevant to repo management
- General: auto-fetch interval, auto-prune, default branch name, initial commits in graph, show all commits, lazy load, delete `.orig`, keep submodules updated, remember tabs, conflict detection, extended logging.
- UI: theme, date locale/format, avatars vs initials, graph columns/metadata, hover highlight, ghost branches, toolbar labels, worktree tab grouping.
- Commit: templates, push-after-commit default, merge behaviour (squash).
- Editor: font, tab size, EOL, line numbers, wrap, syntax highlighting; encoding (default and per repo).
- Repo-specific: encoding, Gitflow, hooks path, LFS, commit, submodules, conflict prevention, sparse checkout rules.
- No general gitconfig editor or dedicated `.gitignore` editor.

---

## Signature UX worth copying
1. Drag a branch onto a branch for an action menu (Merge / Rebase / Interactive Rebase / Fast-forward / Reset); drag onto a remote branch to push.
2. The `// WIP` node as the top row of the graph: click to stage, type a message into it; one WIP row per dirty worktree.
3. One-click toolbar Undo/Redo (Ctrl+Z / Ctrl+Y) covering checkout, commit, discard, branch delete, reset and rebases.
4. Hide/Solo refs: eye icon on hover, orange solo icon, bulk per section; Smart Branch Visibility; Pin-to-left.
5. Double-click to check out (labels, left panel, ghost-branch label); hovering a branch highlights its commits and fades the rest.
6. Interactive rebase as a visual list: drag to reorder, P/R/S/D keys, Reset; the same editor serves multi-commit cherry-pick.
7. Multi-select commits for a combined diff (Shift/Ctrl-click, optionally with WIP), with a context menu to squash, cherry-pick or create a patch.
8. A three-pane merge tool: Current | Incoming on top, editable Output below, per-line/hunk checkboxes, conflict-to-conflict arrows; right-click "Take current/incoming" skips the tool.
9. Hunk / Inline / Split diff switch with per-hunk Revert, line-select staging, and a Diff ↔ File (blame) toggle.
10. Command Palette (Ctrl+P) as the universal entry: "History <file>", "Blame <file>", "Checkout <branch>", Undo, patches, settings.
11. Context-rich right-click menus everywhere, with names inlined (e.g. "Reset main to this commit ›" Soft/Mixed/Hard).
12. Repo tabs: Ctrl+1–9, aliases, worktree grouping, and a searchable branch breadcrumb that checks out on select.

## Sources
- help.gitkraken.com/gitkraken-desktop/:
  - home, interface, branching-and-merging, interactive-rebase, undo-and-redo;
  - diff, commits, staging, stashing, pushing-and-pulling, cherrypick, squash;
  - submodules, worktrees, tags, search, command-palette, keyboard-shortcuts;
  - preferences, open-clone-init, git-flow, git-lfs, commit-signing-with-gpg, githooks;
  - terminal, profiles, hiding-and-soloing, adding-and-removing, editing-files;
  - activity-logs, detached-head-state, conflict-prevention, experimental-features, tips;
  - current, 11x, 10x, 9x.
- gitkraken.com: features/commit-graph, features/merge-conflict-resolution-tool, learn/git/git-reset, learn/git/problems/git-rebase-branch, blog/review-file-history-git.
- feedback.gitkraken.com: suggestions/190836 (reflog support), 348581, 216992.

## Confidence notes
- The Merge Tool's "Select all" per side, and the merge/rebase continue/abort buttons, come from secondary sources.
- The docs conflict on whether a hard reset can be undone; treat it as not undoable.
- No Edit or Fixup actions are documented for the interactive rebase editor.
- The commit panel's Tree/Path toggle is confirmed only by older release notes.
- LFS locks and stash include-untracked are undocumented.
