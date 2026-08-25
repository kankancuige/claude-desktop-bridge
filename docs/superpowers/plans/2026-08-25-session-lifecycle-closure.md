# Session Lifecycle Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the task checkpoints below.

**Goal:** Ensure every task stop, completion, timeout, UI close, Gateway shutdown, and Workflow abort path reaches a persisted terminal or resumable state without active runtime resources.

**Architecture:** Keep the existing `primary`/`workflow` stop response contract, but route both scopes through idempotent cleanup. Completion effects become failure-safe and must convert unexpected exceptions into task terminal events. UI, scheduled runtime, and Gateway shutdown reuse the same lifecycle guarantees; startup recovery remains the final crash boundary.

**Tech Stack:** Node.js ESM, `node:test`, Vue 3/TypeScript, Electron IPC, existing task/workflow/session runtime modules.

## Global Constraints

- Do not add dependencies, change public API shape, commit, push, or start external services.
- Preserve user dirty/untracked files and existing `primary`/`workflow`/`none` stop scopes.
- A terminal task must have no active Query, Stream, Workflow Gate entry, pending input, or active Workflow handle.
- Backend state must be persisted before a successful stop response is returned.

### Task 1: Make Session Stop Idempotent and Complete

**Files:**
- Modify: `gateway/runtime/session-stop-runtime.mjs`
- Test: `gateway/runtime/session-stop-runtime.test.mjs`

**Interfaces:**
- Consume existing `getSessionStopScope`, `stopWorkflow`, `closeSessionRuntime`, and task-state ports.
- Produce a stop result with the existing scope field plus complete cleanup behavior.

- [ ] Add regression tests for Workflow-only stop, pending input cancellation, gate clearing, runtime closure, and repeated stop calls.
- [ ] Refactor stop cleanup so Workflow-only returns only after gate, pending inputs, coordinator, stream watchdog, and runtime resources are cleared.
- [ ] Keep parent task terminal state unchanged for standalone Workflow-only stops, but emit a lifecycle snapshot showing inactive state.
- [ ] Run the focused stop tests and then the full Gateway suite.

### Task 2: Convert Completion Effect Exceptions Into Terminal State

**Files:**
- Modify: `gateway/runtime/task-completion-effects-runtime.mjs`
- Modify: `gateway/runtime/sdk-stream-runtime.mjs`
- Modify: `gateway/runtime/session-input-runtime.mjs`
- Test: `gateway/runtime/task-completion-effects-runtime.test.mjs`

**Interfaces:**
- Preserve `applyTaskCompletionEffects(sessionId, effects)` as the injected async port.
- On unexpected effect failure, use `updateTaskCompletion(..., {type: 'runtime_failed'})`, update task state, emit `task_failed`, and broadcast lifecycle.

- [ ] Add a test where validation/review effect throws and assert `failed` state plus terminal event.
- [ ] Add one shared guarded invocation path for fire-and-forget callers so rejected effects cannot leave `reviewing` or `fixing` active.
- [ ] Preserve existing explicit `review_error`, `review_paused`, and notification behavior.
- [ ] Run focused completion tests and Gateway suite.

### Task 3: Close UI, Scheduled Runs, and Gateway Shutdown Through the Contract

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `gateway/runtime/scheduled-runtime.mjs`
- Modify: `gateway/runtime/shutdown-runtime.mjs`
- Test: `gateway/runtime/scheduled-runtime.test.mjs` and `gateway/runtime/shutdown-runtime.test.mjs` where present; add focused tests if absent.

**Interfaces:**
- UI continues using `POST /api/sessions/:id/stop`.
- Scheduled and shutdown runtimes receive an injected `stopSessionGeneration` port and must not duplicate partial cleanup.

- [ ] Stop active tabs for all active task/workflow statuses before removing them from UI state.
- [ ] Keep a tab when stop fails; handle `workflow` scope by refreshing lifecycle state rather than pretending primary input was restored.
- [ ] Route scheduled timeout through Session stop and delete only auto-created sessions after terminal cleanup.
- [ ] Write `interrupted` shutdown state before the existing bounded process exit.
- [ ] Run UI type-check/build and focused runtime tests.

### Task 4: Clean Workflow Starting State and Verify Recovery Invariants

**Files:**
- Modify: `gateway/workflows/workflow-runner.mjs`
- Test: `gateway/workflows/workflow-runner.test.mjs` or the nearest existing Workflow test file.

**Interfaces:**
- Preserve `stopWorkflow(nameOrRunKey)` return type and resume behavior for running Workflows.

- [ ] Schedule run-state cleanup when a `starting` Workflow is stopped and remove stale `_activeByName` mappings.
- [ ] Add tests for stop-before-runner, duplicate-start rejection after stop, and persisted terminal projection.
- [ ] Verify all acceptance invariants with the full Gateway suite, frontend checks, and `git diff --check`.

## Acceptance Checklist

- [ ] Repeated stop requests are idempotent.
- [ ] Workflow-only stop leaves `taskWorkflowPending=false`.
- [ ] Exceptions in validation/review/notification produce a terminal task event.
- [ ] Closing a tab or Gateway does not hide active work without a stop/interrupt record.
- [ ] Scheduled timeout does not leave an auto-created Session in `sessions`.
- [ ] Gateway restart does not resurrect a dead `running` task.
