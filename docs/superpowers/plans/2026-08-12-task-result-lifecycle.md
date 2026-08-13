# Task Result Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an SDK turn that stops at `maxTurns` or another non-success result is shown as incomplete and can be continued from the same session.

**Architecture:** Keep Claude SDK JSONL as the conversation source of truth. Gateway classifies SDK result subtypes into an explicit task outcome and broadcasts the outcome unchanged. The desktop maps that outcome to user-visible status and sends a deliberate continuation prompt through the existing session WebSocket.

**Tech Stack:** Node.js 20 ESM, Claude Agent SDK 0.3.x, Vue 3, TypeScript, Node test runner.

## Global Constraints

- Preserve all existing dirty worktree changes and do not restart the running Gateway/Electron processes.
- Do not add dependencies, alter provider contracts, or delete transcript/checkpoint data.
- `success` is the only outcome that may trigger a success notification.
- `error_max_turns`, budget limits, execution errors, and cancellation remain resumable only when the SDK conversation identity exists.

---

### Task 1: Normalize SDK result outcomes

**Files:**
- Create: `gateway/task-result-outcome.mjs`
- Create: `gateway/task-result-outcome.test.mjs`
- Modify: `gateway/index.mjs:2054-2065,2545-2551`

**Interfaces:**
- Consumes: raw SDK `result` messages.
- Produces: `classifyTaskResult(sdkMsg)` and WebSocket fields `outcome`, `resumable`, `continuationReason`.

- [ ] Add tests for `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, and unknown error subtypes.
- [ ] Make Gateway preserve the raw subtype while adding the normalized outcome.
- [ ] Only clear active generation as a terminal event; preserve resumable metadata for incomplete outcomes.

### Task 2: Render incomplete outcomes correctly

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue:2860-2930`
- Modify: `desktop-ui/src/i18n.ts`
- Create: `desktop-ui/src/task-result-outcome.ts`
- Create: `desktop-ui/src/task-result-outcome.test.mjs`

**Interfaces:**
- Consumes: Gateway result `outcome`, `subtype`, `resumable`, and `result`.
- Produces: stable system message text and `partial`/`failed`/`idle` UI status.

- [ ] Add pure frontend mapping tests for each outcome.
- [ ] Prevent `error_max_turns` and other errors from using success pet state or “Done” text.
- [ ] Preserve the existing token/cost accounting for every result.

### Task 3: Continue an incomplete turn

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/session-drafts.ts`
- Modify: `desktop-ui/src/i18n.ts`
- Modify: `gateway/index.mjs` only if continuation metadata needs an explicit server acknowledgement.

**Interfaces:**
- Consumes: the existing `historySessionId`, last user task, and incomplete result metadata.
- Produces: a deliberate `continue` action that reuses the same Gateway/SDK session.

- [ ] Store the incomplete task text as an interrupted draft before rendering the result.
- [ ] Add a visible “继续执行” action only for resumable incomplete outcomes.
- [ ] Send a structured continuation instruction instead of only `Continue from where you left off.`.
- [ ] Clear the draft only after `message_accepted`.

### Task 4: Verify the closed loop

- [ ] Run focused Gateway and desktop unit tests.
- [ ] Run `node --check gateway/index.mjs`.
- [ ] Run `pnpm exec vue-tsc --noEmit` and the production Vite build.
- [ ] Run `git diff --check`.
- [ ] Report runtime provider and existing-process smoke tests separately because the current Gateway must not be restarted in this turn.
