# Agent rules

## Workflow

- **Build on a branch in a dedicated git worktree unless the user says otherwise.** Create it from
  `main` with `git worktree add ../eztext-<feature> -b <type>/<feature>` and do the edits, checks and
  commits there.
- The main worktree (`eztext`) may hold the user's own uncommitted work. Treat it as read-mostly:
  never edit it to implement a request, and never discard hunks that are not part of the task. If
  changes must be lifted out of it, move only the hunks that belong to the task.
- Record meaningful work and decisions in `PROGRESS.md` (see the project-progress skill), including
  the updated `npm run smoke` / `npm run ui-check` assertion counts after a change.
