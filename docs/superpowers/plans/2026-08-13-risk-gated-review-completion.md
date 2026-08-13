# Risk-Gated Review Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让父任务只在必需审查通过后完成，并按风险减少不必要审查，在阻断发现后自动修复一次并复核一次。

**Architecture:** Gateway 新增纯函数完成协调器和结构化审查结果归一化模块，`startStreamPump` 只上报主结果，Workflow 终态回调驱动协调器。Desktop 仅消费父任务状态事件，IM 最终回复由协调器统一触发。低风险跳过 Agent 审查，中风险单 Agent 定向审查，高风险 Power 门禁审查。

**Tech Stack:** Node.js ESM、Node test runner、Claude Agent SDK、Workflow Runner、Vue 3、TypeScript、WebSocket。

## Global Constraints

- 保留当前 dirty worktree 和现有模型路由改动，不提交、不推送、不重启应用。
- 主会话是唯一写入者；最终审查始终使用 `plan` 权限。
- 最多一次自动修复和一次自动复核，禁止无限循环。
- 只有 Gateway 产生的最终完成事件才能触发桌面成功状态和 IM 最终回复。
- 代码注释使用中文并解释 WHY。

---

### Task 1: Review Policy And Completion Coordinator

**Files:**
- Create: `gateway/task-completion.mjs`
- Create: `gateway/task-completion.test.mjs`
- Modify: `gateway/workflow-model-routing.mjs`
- Modify: `gateway/workflow-model-routing.test.mjs`

**Interfaces:**
- Produces: `resolveFinalReviewPlan({decision, checkpoint}) -> {required, tier, mode, riskDomains}`。
- Produces: `normalizeReviewOutcome(result, plan) -> ReviewOutcome`。
- Produces: `transitionTaskCompletion(state, event) -> {state, effects}`，effects 仅包含 `start_review`、`request_fix`、`complete`、`fail`、`pause`。

- [x] **Step 1: Write failing policy tests**

覆盖无差异、低风险、中风险、高风险、显式全面审计，以及 high finding 阻断而 medium finding 只建议。

- [x] **Step 2: Run focused tests and confirm failure**

Run: `node --test gateway/task-completion.test.mjs gateway/workflow-model-routing.test.mjs`

- [x] **Step 3: Implement pure policy and coordinator**

协调器状态包含 `phase`、`primaryResult`、`reviewPlan`、`reviewRound`、`fixAttempts`、`reviewOutcome`、`completionEmitted` 和 `notificationEmitted`。

- [x] **Step 4: Run focused tests**

Run: `node --test gateway/task-completion.test.mjs gateway/workflow-model-routing.test.mjs`

### Task 2: Persisted Task State Contract

**Files:**
- Modify: `gateway/task-state.mjs`
- Modify: `gateway/task-state.test.mjs`

**Interfaces:**
- Consumes: coordinator phases。
- Produces: task state statuses `running | reviewing | changes_required | succeeded | incomplete | failed | stopped | interrupted`，以及有界 `review` 投影。

- [x] **Step 1: Write failing persistence and recovery tests**

覆盖 `reviewing` 重启恢复为可继续状态、`changes_required` 保留摘要、客户端投影不泄漏 SDK identity。

- [x] **Step 2: Run tests and confirm failure**

Run: `node --test gateway/task-state.test.mjs`

- [x] **Step 3: Implement additive v3 normalization**

保留 v1 读取兼容；中间态不可归类为 succeeded。

- [x] **Step 4: Run tests**

Run: `node --test gateway/task-state.test.mjs`

### Task 3: Gateway Lifecycle And Review Follow-Up

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/workflow-runner.mjs`
- Modify: `.claude/workflows/code-review.mjs`
- Test: `gateway/task-completion-integration.test.mjs`

**Interfaces:**
- Consumes: `transitionTaskCompletion` effects。
- Produces: WebSocket events `task_reviewing`、`task_changes_required`、`task_completed`、`task_failed`、`task_review_paused`。
- Produces: Workflow terminal callback carrying `workflowId`、`purpose`、`result`、`status`。

- [x] **Step 1: Write failing lifecycle tests**

覆盖主成功加审查运行中不完成、审查通过只完成一次、审查阻断只回灌一次、复核仍失败停止、暂停和错误不成功。

- [x] **Step 2: Run focused tests and confirm failure**

Run: `node --test gateway/task-completion-integration.test.mjs`

- [x] **Step 3: Route SDK result through coordinator**

从主 `result` 分支移除提前 `succeeded` 和提前 `maybeMirror`；保存主回复文本直到最终 effect。

- [x] **Step 4: Route Workflow terminal events through coordinator**

最终审查使用结构化结果；`workflow_done` 不直接等于通过。阻断时向主 `pushStream` 注入有界修复请求，并标记内部回合避免启动重复普通 Workflow。

- [x] **Step 5: Implement review round limits and final mirror**

只在 `complete` effect 中调用 `maybeMirror`，并用幂等标记防重。

- [x] **Step 6: Run lifecycle and coordinator tests**

Run: `node --test gateway/task-completion-integration.test.mjs`

### Task 4: Desktop Parent Task Presentation

**Files:**
- Create: `desktop-ui/src/task-completion.ts`
- Create: `desktop-ui/src/task-completion.test.ts`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/i18n.ts`

**Interfaces:**
- Consumes: Gateway parent task events and persisted task state。
- Produces: one final success bubble, reviewing/repairing status, review failure or pause notice, and queue release only at terminal parent state。

- [x] **Step 1: Write failing UI state tests**

覆盖 SDK `result` 只结算统计、`task_reviewing` 不成功、`task_completed` 只生成一次成功语义。

- [x] **Step 2: Run focused tests and confirm failure**

Run: `node --test desktop-ui/src/task-completion.test.ts`

- [x] **Step 3: Implement reducer and connect WorkspaceView**

移除 `case 'result'` 中的最终成功推断；宠物、队列和 checkpoint 刷新由父任务终态触发。

- [x] **Step 4: Run UI tests and type check**

Run: `node --test desktop-ui/src/task-completion.test.ts`
Run: `desktop-ui/node_modules/.bin/vue-tsc.cmd --noEmit -p desktop-ui/tsconfig.app.json`

### Task 5: Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all prior tasks。
- Produces: build/test/runtime evidence and residual blockers。

- [x] **Step 1: Run all Gateway tests**

Run the repository's existing Gateway test command or all `gateway/*.test.mjs` with Node test runner.

- [x] **Step 2: Run Desktop tests and Vite build**

Run Desktop unit tests, `vue-tsc --noEmit`, and `pnpm build` equivalent that does not package Electron unless required by existing gates.

- [x] **Step 3: Run syntax and diff checks**

Run `node --check` on changed `.mjs` files and `git diff --check`.

- [x] **Step 4: Inspect final diff**

Confirm no provider credentials, no unrelated formatting, no duplicate completion path, and no automatic loop beyond one fix plus one re-review.

### Task 6: Large Project Session Open Performance

**Files:**
- Modify: `gateway/index.mjs`
- Modify: Gateway snapshot/project file scan modules selected from current call graph
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: focused session-open and stale-request tests

**Interfaces:**
- Produces: session creation response before optional file-tree and Git scans finish。
- Produces: cancellable/versioned background scan result，旧会话扫描不得覆盖当前 tab。

- [x] **Step 1: Add timing and stale-result tests**

分别断言会话身份/消息恢复不等待文件扫描，切换会话后旧扫描结果被丢弃。

- [x] **Step 2: Move optional scans off the session critical path**

文件树、Git 状态、project cache 和大型 snapshot 使用异步增量路径；排除 `.git`、`node_modules`、构建产物和缓存目录。

- [x] **Step 3: Add staged loading presentation**

区分“恢复会话”“加载消息”“加载文件状态”，复用 tab 缓存，不清空已有气泡。

- [ ] **Step 4: Verify performance**

记录 session create、history load、file scan 和 Git scan 的独立耗时，并用大项目复测。

### Task 7: Context Compaction And Injection Budget

**Files:**
- Modify: `gateway/context-profile.mjs`
- Modify: `gateway/context-lifecycle.mjs`
- Modify: `gateway/index.mjs`
- Modify: Desktop compact-summary presentation
- Test: context profile, compaction and duplicate-injection tests

**Interfaces:**
- Produces:按任务使用 Light/Focused/Full 注入预算。
- Produces:压缩后只保留一份结构化摘要，不与完整旧上下文重复发送。

- [x] **Step 1: Add context composition tests**

覆盖简单问题不注入完整规则、Skill 按需加载、工具大输出只注入摘要、压缩后 token 重新计算。

- [x] **Step 2: Bound fixed and tool context**

规则、Agent 描述、工具 schema 和工具结果按本轮需求裁剪；大结果使用缓存引用和有界摘要。

- [x] **Step 3: Harden compact fallback**

RTK 不可用时使用内置结构化压缩，明确记录降级原因，不回退为无限原样注入。

- [x] **Step 4: Fix compact UI**

压缩摘要显示为可折叠系统块，不生成超宽或超高普通气泡；90% 阈值触发后按真实窗口重新计算占用。

### Task 8: Agent Model Routing And Visibility

**Files:**
- Modify: `gateway/model-routing.mjs`
- Modify: `gateway/workflow-model-routing.mjs`
- Modify: `gateway/workflow-runner.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/components/RightPanels.vue` when still used by current layout
- Test: model routing and Agent presentation tests

**Interfaces:**
- Produces:每个 Agent 的 `role`、`required`、`riskTier`、`requestedModelTier`、`actualModel` 和 `fallbackReason`。

- [x] **Step 1: Add routing boundary tests**

Explore 默认 Light、普通实现 Balanced、高风险设计和门禁 Power；固定模型覆盖自动路由；不可用模型受控失败或降级。

- [x] **Step 2: Propagate actual model metadata**

Gateway 从 Agent 启动到结束持续广播实际模型和职责，不由 UI 猜测。

- [x] **Step 3: Improve Agent cards**

展示职责、当前阶段、实际模型、风险档位、当前操作和是否属于父任务完成门禁。

- [ ] **Step 4: Verify mixed-model workflows**

证明同一 Workflow 可由 Light 枚举、Balanced 实现/定向审查、Power 裁决，且父状态等待必需 Agent。

### Task 9: Unified Events, Recovery And IM Acceptance

**Files:**
- Modify: Gateway task-state/event modules
- Modify: `gateway/wechat.mjs`
- Modify: `gateway/feishu.mjs`
- Modify: `gateway/dingtalk.mjs`
- Modify: Desktop event consumer
- Test: event contract, restart recovery and notification idempotency tests

**Interfaces:**
- Produces: `task_started`、`primary_completed`、`review_started`、`changes_required`、`task_completed`、`task_failed`、`task_paused`，均携带 `taskId/turnId/childId/required/status/outcome/sequence/timestamp`。

- [x] **Step 1: Add event-order and recovery tests**

覆盖乱序、重复事件、Gateway 重启、tab 重连和 adapter 重试。

- [x] **Step 2: Make Gateway the only event source**

Desktop 和 adapters 只展示或投递，不自行推断完成。

- [x] **Step 3: Verify notification outbox idempotency**

微信、飞书、钉钉在最终成功后各发送一次；失败可重试但不能产生重复成功消息。

- [ ] **Step 4: Run end-to-end acceptance**

从 IM 注入任务，经历实现、审查、一次修复、复核和最终通知；另测暂停、审查失败、重启恢复和模型不可用。

## Remaining Runtime Acceptance

- 大项目性能验收需在真实桌面端记录 session create、history load、file scan 和 Git scan 耗时。
- 混合模型验收需使用已配置的 Light、Balanced、Power 真实供应商模型运行同一 Workflow。
- IM 端到端验收需启动或重启 Gateway，并使用真实微信、飞书、钉钉绑定验证通知、暂停和重启恢复。
