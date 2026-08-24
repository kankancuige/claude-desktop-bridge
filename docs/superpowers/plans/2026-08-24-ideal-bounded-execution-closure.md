# Ideal Bounded Execution Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将有界任务执行、分层 Context、Agent Mailbox 和 Memory candidate 收敛为可恢复、可操作、可审查的代码闭环。

**Architecture:** Coordinator 作为唯一任务事实源，通过显式计划推进 API 检查依赖、完成门禁和幂等事件。Context Planner 只在允许的层和 reference 上物化内容；Mailbox 使用已有 `state_entries` 持久化 claim/ack/recovery；Memory candidate 通过现有内容仓储和受控 HTTP/Workbench 操作进入 active。

**Tech Stack:** Node.js ESM、Node `node:test`、PostgreSQL/StorageGateway、现有 Gateway HTTP 路由、Vue 3 + TypeScript + Vite。

## Global Constraints

- 默认 `session` 不自动续跑；只有显式 `workflow/mission` 才允许有界续跑。
- 不新增常驻 Agent、轮询器、外部依赖或第二套事实源。
- 不持久化 Prompt、凭据、完整 transcript、完整工具输出或绝对路径。
- 所有消息、Context、重试、Agent、Token 和时长均有硬上限并可恢复。
- 不执行 `git commit`、`git push`、依赖安装或外部服务变更。

---

### Task 1: Coordinator Strict Plan Advancement

**Files:**
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/tasks/task-coordinator.test.mjs`

**Interfaces:**
- `startPlannedTask({taskId}) -> TaskSnapshot`
- `advancePlannedTask({taskId, stepId, result, evidence}) -> {nextStepId, status, reasons, snapshot}`
- `pausePlannedTask({taskId, reason}) -> TaskSnapshot`
- `resumePlannedTask({taskId}) -> TaskSnapshot`

- [x] **Step 1: Write failing tests**
  - Reject starting a step whose dependencies are incomplete.
  - Advance only the current step and refuse duplicate completion.
  - Pause on blocked or waiting results and resume from the same step.

- [x] **Step 2: Implement strict transition helpers**
  - Validate current step, dependency closure, structured result and completion evidence before changing status.
  - Preserve revision/event idempotency and never mark the parent completed before all required steps.

- [x] **Step 3: Run coordinator tests**

```powershell
node --test gateway/tasks/task-coordinator.test.mjs
```

### Task 2: Reference-Aware Context Budget

**Files:**
- Modify: `gateway/context/context-planner.mjs`
- Modify: `gateway/context/context-planner.test.mjs`
- Modify: `gateway/runtime/session-context-runtime.mjs`
- Modify: `gateway/runtime/session-context-runtime.test.mjs`

**Interfaces:**
- `planContext({references})` selects L2 only for requested references.
- `materializeContextLayer({plan, layer, reference})` never exposes unselected content.

- [x] **Step 1: Write failing tests**
  - L1 contains only Memory overview, not `memoryText` body.
  - Full profile with no explicit L2 reference omits details.
  - Selected reference is bounded and recorded; omitted references carry a reason.

- [x] **Step 2: Implement layer/reference selection**
  - Keep L0/L1 summaries separate from L2 bodies.
  - Apply budget trimming in `L2 -> L1 -> L0` order and keep estimates separate from Provider usage.

- [x] **Step 3: Run Context tests**

```powershell
node --test gateway/context/context-planner.test.mjs gateway/runtime/session-context-runtime.test.mjs
```

### Task 3: Durable Mailbox Claims and Recovery

**Files:**
- Modify: `gateway/agents/agent-message.mjs`
- Modify: `gateway/agents/agent-dispatcher.mjs`
- Modify: `gateway/agents/agent-message.test.mjs`
- Modify: `gateway/agents/agent-dispatcher.test.mjs`

**Interfaces:**
- `consume()` claims pending messages as `in_flight`.
- `ack(messageId, {status})` accepts `consumed|failed|expired|pending`.

- [x] **Step 1: Write failing tests**
  - Agent failure returns claimed messages to retryable pending state.
  - Expired in-flight messages do not wake an Agent.

- [x] **Step 2: Implement claim/ack/recovery**
  - Claim is bounded and idempotent; Dispatcher acknowledges only after execution result is normalized.
  - Terminal task wake handles are closed through the existing callback; no timer polling is added.

- [x] **Step 3: Run Mailbox tests**

```powershell
node --test gateway/agents/agent-message.test.mjs gateway/agents/agent-dispatcher.test.mjs
```

### Task 4: User-Operable Memory Candidate Approval

**Files:**
- Modify: `gateway/context/memory-candidate.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/http/memory-routes.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/context/memory-candidate.test.mjs`
- Modify: `gateway/http/memory-routes.test.mjs`

**Interfaces:**
- `GET /api/projects/:encodedDir/memory-candidates`
- `PUT /api/projects/:encodedDir/memory-candidates/:candidateId` with `{action:'approve'|'reject', actor, sourceEvidence[]}`.

- [x] **Step 1: Write failing route tests**
  - Candidate list excludes active Memory bodies.
  - Approve requires actor and evidence; reject never activates content.

- [x] **Step 2: Implement controlled approval**
  - Candidate records remain non-active until approval.
  - Approved content is materialized through the existing project Memory write path or remains explicitly marked as database-backed Memory; refresh must not delete it.

- [x] **Step 3: Run Memory route tests**

```powershell
node --test gateway/context/memory-candidate.test.mjs gateway/http/memory-routes.test.mjs
```

### Task 5: Full Verification Gate

- [x] Run Gateway tests excluding bundled vendor resources.
- [x] Run `pnpm --dir desktop-ui exec vue-tsc --noEmit`.
- [x] Run `pnpm --dir desktop-ui exec vite build`.
- [x] Run `git diff --check` and record external runtime blockers separately.
