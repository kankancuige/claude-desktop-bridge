# Confirmation And Lifecycle Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every confirmation, IM command, scheduled task, workflow transition, and AI activity state has a stable lifecycle that remains visible, correctly correlated, cancellable, and resumable.

**Architecture:** Keep lifecycle ownership in the existing Gateway runtime ports and expose explicit state transitions through the current WebSocket/HTTP contracts. Generate confirmation identities with a persisted gateway instance prefix, correlate IM replies by request/tool identity, and make UI state derive from server snapshots rather than stale local request IDs. Preserve existing adapters and Vue components; add only focused helpers and regression tests.

**Tech Stack:** Node.js ESM, `node:test`, WebSocket runtime, existing IM adapters, Vue 3 + TypeScript + Vite.

## Global Constraints

- Preserve all existing dirty worktree changes; do not reset, checkout, commit, or push.
- Do not install dependencies or start real Gateway, Electron, Provider, or IM services.
- Keep IP, port, credentials, and tokens in existing configuration; do not hard-code them.
- Use existing `apiFetch`, WebSocket events, adapter interfaces, and Vue composition patterns.
- Every behavioral change must have a focused failing test first, then implementation and regression verification.
- Real Provider/IM/Electron behavior remains external acceptance evidence, not a local test substitute.

---

### Task 1: Confirmation Identity And Desktop Submission State

**Files:**
- Modify: `gateway/runtime/confirmation-runtime.mjs`
- Modify: `gateway/runtime/confirmation-runtime.test.mjs`
- Modify: `gateway/runtime/websocket-session-runtime.mjs`
- Modify: `gateway/runtime/websocket-session-runtime.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/task-activity.ts`
- Modify: `desktop-ui/src/task-activity.test.mjs`

**Interfaces:**
- Confirmation entries retain `requestId`, add a gateway-instance namespace and `toolUseId` when available.
- Desktop confirmation events include stable `requestId`, `toolUseId`, and server `expiresAt`.
- Reconnect snapshots clear stale submitting state and repopulate pending confirmations.

- [x] Write tests for request IDs remaining unique across two runtime instances, aborting an already-aborted signal, and reconnect clearing a stale submitting flag.
- [x] Run the focused Gateway and desktop tests and verify the new tests fail against current behavior.
- [x] Implement a per-runtime persisted/random instance prefix, pre-abort check, and explicit confirmation submission lifecycle event.
- [x] Change choice answer indexing to stable question indexes/IDs while retaining backward compatibility for existing question text answers.
- [x] Run focused tests, `node --check` for changed ESM files, and `git diff --check`.

### Task 2: IM Confirmation Correlation, Capacity, Timeout, And Cross-Channel Resolution

**Files:**
- Modify: `gateway/im/pending-confirm.mjs`
- Modify: `gateway/im/pending-confirm.test.mjs`
- Modify: `gateway/im/im-task-runner.mjs`
- Modify: `gateway/im/im-task-runner.test.mjs`
- Modify: `gateway/im/wechat.mjs`
- Modify: `gateway/im/feishu.mjs`
- Modify: `gateway/im/dingtalk.mjs`
- Modify: `gateway/runtime/confirmation-runtime.mjs`

**Interfaces:**
- Pending IM confirmations are addressed by explicit `requestId`/`toolUseId`; queue overflow returns an observable rejection/result.
- IM turn timeout calls `taskCommands.cancelTask()` before observer cleanup.
- Adapter hooks receive `onConfirmationResolved` so an IM user sees that desktop or another channel settled the request.

- [x] Add failing tests for ninth pending confirmation visibility, concurrent IM replies selecting the matching request, timeout cancellation, and cross-channel resolution notification.
- [x] Run only the affected IM/runtime tests and verify failure.
- [x] Implement bounded-queue error reporting, keyed lookup/acknowledgement, cancellation, and adapter resolution callbacks.
- [x] Verify duplicate/late replies remain idempotent and that no pending entry is silently lost.

### Task 3: Scheduler Unattended Defaults And HTTP Error Feedback

**Files:**
- Modify: `gateway/runtime/scheduled-runtime.mjs`
- Modify: `gateway/http/adapter-config-routes.mjs`
- Modify: corresponding scheduler/config tests.

**Interfaces:**
- Unattended scheduler tasks default to `permissionMode: 'bypassPermissions'` unless explicitly configured otherwise.
- HTTP create/update/start/stop/delete routes preserve non-2xx status and return the concrete conflict/error reason.

- [x] Add failing tests for default permission mode and 409/5xx error propagation.
- [x] Implement the minimum defaulting and route response changes.
- [x] Run scheduler and adapter-config route tests and syntax checks.

### Task 4: Workflow Snapshot Recovery, Response Checks, And Error Broadcast De-duplication

**Files:**
- Modify: `gateway/http/workflow-routes.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: workflow route/runner tests.

**Interfaces:**
- Reconnect workflow snapshots preserve each Agent's actual status and include all active workflows for the session.
- Control routes reject non-2xx responses with structured errors.
- A workflow failure is broadcast exactly once at the owning boundary.

- [x] Add failing tests for status-preserving snapshots, multiple workflow snapshots, non-2xx control responses, and single error broadcast.
- [x] Implement snapshot and response handling at the current ownership boundaries.
- [x] Run workflow tests and verify no duplicate lifecycle events.

### Task 5: AI Activity Accounting And Coordinator Resume Entry Point

**Files:**
- Modify: `gateway/http/usage-routes.mjs`
- Modify: `gateway/http/usage-routes.test.mjs`
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/tasks/task-coordinator.test.mjs`
- Modify: relevant runtime wiring/tests.

**Interfaces:**
- Usage history counts an active AI call only when a session has an actual active turn/stream, not merely an allocated push stream.
- Coordinator exposes a runtime-safe resume command for persisted `waiting_user` tasks and emits the next executable step.

- [x] Add failing tests for idle push streams not being counted and persisted waiting-user tasks resuming through the runtime entry point.
- [x] Implement activity predicate and resume wiring.
- [x] Run focused usage/coordinator/runtime tests.

### Task 6: Relay Contract Review And Full Verification

**Files:**
- Inspect only: `gateway/providers/codex-relay-proxy.mjs`, `gateway/providers/codex-relay-proxy.test.mjs`
- Modify only if official documentation establishes a required idempotency contract.

- [x] Search and open the current official OpenAI Responses API documentation for retry/idempotency behavior.
- [x] If no explicit contract supports a header or retry change, document the residual risk without changing relay behavior.
- [x] Run `node --test gateway`, `node --test desktop-ui/src desktop-ui/electron`, `pnpm exec vue-tsc --noEmit`, `pnpm exec vite build`, `node --check` on changed files, and `git diff --check`.
- [x] Record external acceptance gaps: real Provider billing/retry behavior, IM platform delivery, Electron reconnect UI, and authenticated end-to-end confirmation execution.

### Task 7: Remaining Provider And Frontend Stall Paths

**Files:**
- Modify: `gateway/providers/deepseek-proxy.mjs`, `gateway/providers/opencode-proxy.mjs`
- Add: `gateway/providers/provider-client-lifecycle.mjs`
- Modify: `gateway/im/im-task-runner.mjs`
- Modify: `desktop-ui/src/views/WorkflowTab.vue`, `desktop-ui/src/views/SettingsView.vue`
- Add/modify corresponding regression tests.

- [x] Cancel Provider requests when the downstream client disconnects.
- [x] Stream DeepSeek response chunks before upstream completion while preserving bounded thinking-cache capture.
- [x] Cancel an IM task accepted after its adapter observer already stopped.
- [x] Make Workflow/config mutations, module load failures, and QR polling failures visible and retryable.
- [x] Verify the new paths with focused tests and the full Gateway/UI suites.
