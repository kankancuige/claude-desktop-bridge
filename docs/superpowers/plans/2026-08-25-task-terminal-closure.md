# Task Terminal Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every normal task completion path observes the live Task Workbench instance and reaches a truthful terminal state without `active_agents` or `agent_result_missing` caused by startup-order dependency capture.

**Architecture:** Runtime modules created before PostgreSQL startup will consume late-bound dependencies through getter ports. The SDK stream result path will record the primary Agent against the live Workbench before completion effects evaluate the coordinator gate. Final review and completion effects will use the same live Workbench port for reports and review projections.

**Tech Stack:** Node.js ES modules, Node test runner, PostgreSQL-backed Gateway state, Electron/Vue runtime smoke test.

## Global Constraints

- Preserve all existing dirty worktree changes; do not commit or push.
- Keep public HTTP/WebSocket contracts unchanged.
- Do not weaken completion gates or mark tasks completed without truthful Agent/result evidence.
- Keep startup-order compatibility explicit and testable.

---

### Task 1: Reproduce the startup-order regression

**Files:**
- Modify: `gateway/runtime/sdk-stream-runtime.test.mjs`

- [ ] Add a test fixture where `getTaskWorkbench()` returns a Workbench only after runtime construction, then feed a result through the stream pump and assert `recordPrimaryResult` is called.
- [ ] Run the focused test and verify it fails because the runtime captured the initial `null` Workbench.

### Task 2: Late-bind Workbench in SDK stream runtime

**Files:**
- Modify: `gateway/runtime/sdk-stream-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/runtime/sdk-stream-runtime.test.mjs`

- [ ] Add `getTaskWorkbench` as an injected port with a fallback to the existing direct value for isolated tests.
- [ ] Resolve the Workbench at result handling time before calling `recordPrimaryResult` or `recordFailure`.
- [ ] Inject `getTaskWorkbench: () => taskWorkbench` from the composition root.
- [ ] Run the focused stream and composition tests.

### Task 3: Late-bind Workbench in completion and review effects

**Files:**
- Modify: `gateway/runtime/task-completion-effects-runtime.mjs`
- Modify: `gateway/runtime/final-review-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: corresponding runtime tests

- [ ] Add getter ports and resolve the current Workbench inside effect handlers.
- [ ] Preserve existing behavior when a direct Workbench is supplied by unit tests.
- [ ] Add regression assertions that delayed initialization is visible to completion/report and review paths.
- [ ] Run the focused runtime tests.

### Task 4: Full verification and real Electron acceptance

**Files:**
- No additional source files unless a failing regression identifies a required narrow fix.

- [ ] Run `node --test gateway` and record the complete pass count.
- [ ] Run `pnpm exec vue-tsc --noEmit`, `pnpm exec vite build`, and `git diff --check`.
- [ ] Restart only the project Electron/Gateway processes so the new composition root is loaded.
- [ ] Send a controlled no-tool/no-file message and assert AI reply, `task_completed`, completed task state, restored input, and no `active_agents`/`agent_result_missing` blocker.
