# Task Lifecycle Fixes Implementation Plan

**Goal:** Ensure task startup failures, reused-query stalls, and failed workflows always produce a clear terminal state instead of leaving a task stuck or falsely successful.

**Architecture:** Keep lifecycle ownership in the existing task/session runtimes. Add one task-start failure finalizer, explicitly re-arm the session watchdog when accepting input into an existing query, and make failed workflows a completion-gate blocker.

**Tech Stack:** Node.js ESM, Node test runner, Vue 3 desktop client.

## Global Constraints

- Preserve unrelated dirty worktree changes.
- Do not add dependencies or change public WebSocket message contracts unnecessarily.
- Keep task states resumable and include a bounded, user-visible Chinese error detail.

### Task 1: Startup and rebuild failure closure

**Files:**
- Modify: `gateway/runtime/task-command-runtime.mjs`
- Test: `gateway/runtime/task-command-runtime.test.mjs`

- [x] Add a focused failure test covering Workbench/query setup rejection and asserting task state cleanup plus lifecycle error emission.
- [x] Add a local finalizer that transitions the parent task through `runtime_failed`, clears active execution flags, drains pending inputs, persists an error task state, and broadcasts the terminal error/lifecycle.
- [x] Route initialization, state persistence, and asynchronous rebuild failures through that finalizer without double-emitting after a newer query takes ownership.
- [x] Run the focused runtime tests.

### Task 2: Re-arm watchdog for reused queries

**Files:**
- Modify: `gateway/runtime/task-command-runtime.mjs`
- Test: `gateway/runtime/session-input-runtime.test.mjs` or `gateway/runtime/task-command-runtime.test.mjs`

- [x] Add a regression test proving an idle existing query receives a new watchdog after a new input is accepted.
- [x] Inject the watchdog arm callback into the command runtime and call it after pushing input to an existing query.
- [x] Run focused watchdog and command tests.

### Task 3: Failed Workflow completion gate

**Files:**
- Modify: `gateway/tasks/task-coordinator.mjs`
- Test: `gateway/tasks/task-coordinator.test.mjs` or `gateway/tasks/task-completion.test.mjs`

- [x] Add a regression test showing a failed workflow blocks completion even when all required steps and notification intents are otherwise ready.
- [x] Include failed/interrupted workflow projections in `canCompleteTask` reasons.
- [x] Run the coordinator and completion tests.

### Task 4: Full verification

- [x] Run `node --test gateway desktop-ui/src desktop-ui/electron`.
- [x] Run `pnpm exec vue-tsc --noEmit` and `pnpm exec vite build` in `desktop-ui`.
- [x] Run `git diff --check` and report remaining runtime/provider blockers separately from code evidence.
