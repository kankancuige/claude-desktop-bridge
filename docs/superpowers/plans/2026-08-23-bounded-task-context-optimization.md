# 有界任务执行与分层上下文优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户可以明确要求 Bridge 按计划执行到最后一个 Task，同时控制自动续跑、Agent 协作和上下文 Token 成本；默认仍保持一次用户请求对应一次受控任务，不引入常驻自主 Agent。

**Architecture:** `Task Coordinator` 是父任务和完成状态的唯一权威；固定任务链使用有依赖的 Workflow，只有用户明确选择 `mission` 时才允许有限动态续跑。上下文由 `light/focused/full` 档位进一步拆成 L0 摘要、L1 概览、L2 按需正文，Memory、项目缓存和检索轨迹通过统一 Context Planner 生成有界 Context Envelope。Agent 协作采用事件触发的 Mailbox，不轮询、不自动生成无来源任务，所有续跑、唤醒、重试和消息跳数均有硬上限。

**Tech Stack:** Node.js ESM、Claude Agent SDK、PostgreSQL/StorageGateway、现有 Workflow DSL、Vue 3 + TypeScript + Vite、Node `node:test`。

## 当前执行状态（2026-08-24）

代码实现已覆盖 Task 1-8 的本地闭环：固定 `session/workflow/mission` 模式、Coordinator 有界推进、自动续跑预算、L0/L1/L2 Context Planner、Memory 作用域与候选审批、事件触发 Mailbox、Workbench 投影和 fake Provider Smoke。新增 Mailbox 通过现有 PostgreSQL `state_entries` 持久化，Workflow Dispatcher 每次 Agent 运行最多消费一次新消息；Memory candidate 使用现有 `content_documents.status=candidate`，审批前不会进入 active 注入。

本轮门禁：Gateway 排除 `builtin-resources` 后 `727/727`，新增定向测试 `18/18`，`vue-tsc --noEmit`、Vite build、JavaScript 语法检查和 `git diff --check` 通过。真实 Provider 账单/cache 计费、IM 事件唤醒、PostgreSQL 断电恢复、桌面交互和 Electron 安装升级仍属于外部验收，fake Smoke 不替代这些证据。

### Checklist closure

- [x] Task 1-3：执行模式、计划依赖、Coordinator 推进、自动续跑和预算边界。
- [x] Task 4-5：L0/L1/L2 Context、Memory 作用域、检索轨迹和 candidate 审批生命周期。
- [x] Task 6：Mailbox 幂等、TTL、Hop、消息上限、`state_entries` 持久化和 Dispatcher 单次消费。
- [x] Task 7-8：Workbench 投影、fake Provider Smoke、ADR、全量 Gateway/前端门禁。
- [ ] 外部验收：真实 Provider/IM、PostgreSQL 故障恢复、桌面交互、供应商账单和 Electron 发布。

## Global Constraints

- 默认执行模式必须是 `session`；用户明确选择“执行到计划结束”时使用 `workflow`；动态发现任务的 `mission` 必须显式开启。
- 不创建常驻 GOD Agent；没有新用户输入、计划步骤、Mailbox 消息或外部事件时，Agent 必须进入休眠。
- Coordinator 是任务状态唯一事实源；Workflow、Agent、Workbench 和 IM 只能写入结构化结果或事件，不创建第二套终态判断。
- 不持久化 Prompt、凭据、完整 transcript、完整工具输出或绝对路径；协作消息只保留有界摘要和结构化引用。
- 上下文总预算、自动续跑次数、消息 Hop、重试次数、单任务时长和 Agent 数量必须可测量、可持久化、可在 Workbench 查看。
- Memory 的长期写入默认仍需用户明确操作或完成门禁后的候选确认；失败推测不能自动成为长期事实。
- 不新增外部运行时依赖，不复制 OpenViking/Munder Difflin 的代码或资源，不改变现有 HTTP/WebSocket、Claude transcript 和 IM 公开契约。
- 不执行 `git commit`、`git push`、依赖安装或外部服务变更；每个任务使用测试和 `git diff --check` 作为交付门禁，提交须另行授权。

---

### Task 1: 固定任务链与执行模式契约

**Files:**
- Modify: `gateway/tasks/task-contract.mjs`
- Modify: `gateway/tasks/task-plan.mjs`
- Modify: `gateway/tasks/task-decision.mjs`
- Modify: `gateway/tasks/task-plan.test.mjs`
- Modify: `gateway/tasks/task-decision.test.mjs`
- Create: `gateway/tasks/task-execution-mode.mjs`
- Create: `gateway/tasks/task-execution-mode.test.mjs`
- Modify: `docs/architecture/target-design.md`

**Interfaces:**
- `normalizeExecutionMode(value) -> 'session' | 'workflow' | 'mission'`
- `normalizeContinuationPolicy(value) -> {enabled: boolean, maxPlanSteps: number, maxRounds: number, maxTokens: number, maxDurationMs: number, maxRetries: number}`
- `createTaskPlan(input) -> {version, taskId, executionMode, continuationPolicy, steps[]}`
- 每个 Step 至少包含 `{stepId, phase, dependsOn, status, acceptanceCriteria, required}`。

- [ ] **Step 1: 写失败测试**
  - 验证缺省模式为 `session`。
  - 验证用户选择执行到计划结束时得到 `workflow`，不会得到 `mission`。
  - 验证非法模式、负数预算、超过步骤/重试上限时被规范化为安全边界。
  - 验证循环依赖和不存在的 `dependsOn` 被拒绝。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/tasks/task-plan.test.mjs gateway/tasks/task-decision.test.mjs gateway/tasks/task-execution-mode.test.mjs
```

- [ ] **Step 3: 实现最小契约**
  - 在 `task-execution-mode.mjs` 集中实现模式和预算规范化，所有数字限制使用固定上下界。
  - 在 `task-plan.mjs` 为现有 phases 增加顺序依赖和执行模式，不改变旧计划的 `version: 1` 读取兼容。
  - 计划身份、步骤身份和 acceptance criteria 继续复用现有 `task-contract.mjs`，不复制 ID 生成逻辑。

- [ ] **Step 4: 运行定向测试与语法检查**

```powershell
node --test gateway/tasks/task-plan.test.mjs gateway/tasks/task-decision.test.mjs gateway/tasks/task-execution-mode.test.mjs
node --check gateway/tasks/task-execution-mode.mjs
node --check gateway/tasks/task-plan.mjs
```

验收：旧请求仍按 `session` 执行；“执行到最后一个 Task”只生成有限 `workflow` 计划。

---

### Task 2: Coordinator 按完成门禁推进到最后一个 Task

**Files:**
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/tasks/task-workbench-runtime.mjs`
- Modify: `gateway/tasks/task-lifecycle.mjs`
- Modify: `gateway/tasks/task-completion.mjs`
- Modify: `gateway/tasks/task-coordinator.test.mjs`
- Modify: `gateway/tasks/task-workbench-runtime.test.mjs`
- Modify: `gateway/tasks/task-lifecycle.test.mjs`
- Modify: `gateway/tasks/task-completion.test.mjs`

**Interfaces:**
- `startPlannedTask({taskId, plan, signal}) -> Promise<TaskSnapshot>`
- `advancePlannedTask({taskId, stepId, result, evidence}) -> {nextStepId, status, reasons[]}`
- `pausePlannedTask({taskId, reason}) -> TaskSnapshot`
- `resumePlannedTask({taskId}) -> TaskSnapshot`
- `TaskSnapshot.coordinator.execution = {mode, currentStepId, completedStepCount, totalStepCount, continuationCount, budget}`

- [ ] **Step 1: 写失败测试**
  - Task 2 未通过 acceptance criteria 时不得启动 Task 3。
  - Task 2 为 `blocked` 或 `waiting_for_event` 时，父任务暂停而不是继续下一个步骤。
  - 重启后从已持久化的 `currentStepId` 继续，不重复已完成步骤。
  - 重复收到同一个 Agent/Workflow 完成事件不会推进两次。
  - 最后一个 Task 完成前，父任务不能进入 `completed`。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/tasks/task-coordinator.test.mjs gateway/tasks/task-workbench-runtime.test.mjs gateway/tasks/task-lifecycle.test.mjs gateway/tasks/task-completion.test.mjs
```

- [ ] **Step 3: 实现最小推进器**
  - Coordinator 只根据依赖、结构化结果和完成门禁选择下一个步骤。
  - 将当前步骤、已完成步骤、阻塞码和预算快照写入现有 Coordinator 投影。
  - 与现有 `task-auto-continuation.mjs` 对接：SDK 达到 `max_turns` 只能续当前步骤，不得跳过步骤或重新生成父任务。
  - 续跑请求必须携带原会话 ID和当前计划摘要；不得重新注入完整历史。

- [ ] **Step 4: 验证正常、失败、重复和恢复路径**

```powershell
node --test gateway/tasks/task-coordinator.test.mjs gateway/tasks/task-workbench-runtime.test.mjs gateway/tasks/task-lifecycle.test.mjs gateway/tasks/task-completion.test.mjs
node --check gateway/tasks/task-coordinator.mjs
node --check gateway/tasks/task-workbench-runtime.mjs
```

验收：用户明确选择 Workflow 后，系统能稳定执行到最后一步；任一步阻塞都可暂停、查看原因并继续。

---

### Task 3: 自动续跑、重试和 Mission 模式预算

**Files:**
- Modify: `gateway/tasks/task-auto-continuation.mjs`
- Modify: `gateway/tasks/task-repair-loop.mjs`
- Modify: `gateway/tasks/task-workflow-gate.mjs`
- Modify: `gateway/tasks/task-auto-continuation.test.mjs`
- Modify: `gateway/tasks/task-repair-loop.test.mjs`
- Modify: `gateway/tasks/task-workflow-gate.test.mjs`
- Create: `gateway/tasks/task-run-budget.mjs`
- Create: `gateway/tasks/task-run-budget.test.mjs`

**Interfaces:**
- `createTaskRunBudget(policy) -> {maxRounds, maxTokens, maxDurationMs, maxRetries, maxMessageHops, maxAgents}`
- `consumeTaskRunBudget(budget, usage) -> {allowed, remaining, reason}`
- `resolveContinuation({mode, result, budget, progress}) -> {action: 'continue' | 'pause' | 'complete' | 'fail', reason}`

- [ ] **Step 1: 写失败测试**
  - `session` 模式永不自动续跑。
  - `workflow` 模式只允许当前计划中的下一步或当前步骤有限续跑。
  - `mission` 模式也必须受最大轮次、Token、时间、Agent 数和 Hop 限制。
  - 连续相同失败指纹、无文件/测试/状态进展和重复消息触发熔断。
  - `cache_read` 不被当作零成本；未知用量保持 `null` 而不是写成 0。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/tasks/task-auto-continuation.test.mjs gateway/tasks/task-repair-loop.test.mjs gateway/tasks/task-workflow-gate.test.mjs gateway/tasks/task-run-budget.test.mjs
```

- [ ] **Step 3: 实现预算和有限状态转换**
  - 将现有按档位续跑次数迁移到父任务预算中，同时保持现有 `light/balanced/power` 默认上限兼容。
  - `progress` 必须来自结构化结果：changed file count、test count、verification status 或新事件数。
  - 没有新进展时暂停并记录 `no_progress`，不能继续请求模型。
  - 所有外部等待使用 `waiting_for_event`，不能使用固定时间轮询。

- [ ] **Step 4: 运行测试、语法和差异检查**

```powershell
node --test gateway/tasks/task-auto-continuation.test.mjs gateway/tasks/task-repair-loop.test.mjs gateway/tasks/task-workflow-gate.test.mjs gateway/tasks/task-run-budget.test.mjs
node --check gateway/tasks/task-auto-continuation.mjs
node --check gateway/tasks/task-run-budget.mjs
git diff --check
```

验收：默认不会后台消耗 Token；明确的 Workflow/Mission 超过任何预算都会进入可解释的暂停或阻塞状态。

---

### Task 4: 分层 Context Planner 与上下文预算

**Files:**
- Modify: `gateway/context/context-profile.mjs`
- Modify: `gateway/context/context-envelope.mjs`
- Modify: `gateway/context/context-cache-policy.mjs`
- Modify: `gateway/context/context-lifecycle.mjs`
- Modify: `gateway/projects/project-cache.mjs`
- Modify: `gateway/context/context-profile.test.mjs`
- Modify: `gateway/context/context-envelope.test.mjs`
- Modify: `gateway/context/context-cache-policy.test.mjs`
- Modify: `gateway/context/context-lifecycle.test.mjs`
- Create: `gateway/context/context-planner.mjs`
- Create: `gateway/context/context-planner.test.mjs`

**Interfaces:**
- `planContext({profile, task, projectSummary, memoryCandidates, previousEnvelope, budget}) -> ContextPlan`
- `ContextPlan = {profile, layers: {l0, l1, l2}, references[], estimatedInputTokens, maxInputTokens, omitted[], fingerprint}`
- `materializeContextLayer({plan, layer: 'l0' | 'l1' | 'l2', reference, signal}) -> ContextPart`
- `recordContextUse({taskId, reference, layer, selected, bytes, reason}) -> ContextUseEvent`

- [ ] **Step 1: 写失败测试**
  - `light` 无工具、无 Memory、无项目扫描，且预算为最小值。
  - `focused` 只允许 Read/Grep/Glob，并只加载 L0/L1。
  - `full` 默认也不加载所有全文；只有明确命中的 L2 reference 才读取正文。
  - 预算不足时按 `L2 -> L1 -> L0` 顺序裁剪，并记录 `omitted` 原因。
  - 相同 Provider、模型和稳定 Context Envelope 的续跑复用引用，不重复拼接完整历史。
  - 模型或 Provider 改变时要求重新选择 full history、handoff 或 fresh，不伪造缓存命中。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/context/context-profile.test.mjs gateway/context/context-envelope.test.mjs gateway/context/context-cache-policy.test.mjs gateway/context/context-lifecycle.test.mjs gateway/context/context-planner.test.mjs
```

- [ ] **Step 3: 实现 L0/L1/L2 规划**
  - L0：任务目标、当前步骤、项目技术栈摘要、Memory 摘要、阻塞状态；默认极小且可审查。
  - L1：项目结构摘要、命中的 Memory 概览、上一步结构化结果和验证摘要。
  - L2：仅按 reference 读取指定文件片段、Memory 正文或工具结果，不复制完整 transcript。
  - 使用稳定 `Context Envelope` 计算指纹；Envelope 不得包含 Prompt、凭据、绝对路径或思考正文。
  - 把估算 Token 与 Provider 实际 usage 分开保存；估算只用于预算，实际账单只接受 Provider response usage。

- [ ] **Step 4: 验证正常、预算不足、切换模型和续跑**

```powershell
node --test gateway/context/context-profile.test.mjs gateway/context/context-envelope.test.mjs gateway/context/context-cache-policy.test.mjs gateway/context/context-lifecycle.test.mjs gateway/context/context-planner.test.mjs
node --check gateway/context/context-planner.mjs
git diff --check
```

验收：同一任务的后续步骤不重复注入全量上下文；每次被裁剪的上下文都有原因码。

---

### Task 5: Memory 作用域、分层摘要和检索轨迹

**Files:**
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/context/memory-admin.mjs`
- Modify: `gateway/context/memory-quality-gate.mjs`
- Modify: `gateway/context/embedding-provider.mjs`
- Modify: `gateway/storage/repositories/memory-repository.mjs`
- Modify: `gateway/storage/postgres-schema.mjs`
- Modify: `gateway/context/memory-service.test.mjs`
- Modify: `gateway/context/memory-admin.test.mjs`
- Modify: `gateway/context/memory-quality-gate.test.mjs`
- Create: `gateway/context/memory-candidate.mjs`
- Create: `gateway/context/memory-candidate.test.mjs`

**Interfaces:**
- `retrieveAsync({workDir, encodedDir, agentType, text, layer, budget}) -> {text, items, trace, backend, reason}`
- `extractMemoryCandidates({taskId, projectKey, verifiedFacts, scope}) -> MemoryCandidate[]`
- `approveMemoryCandidate({candidateId, actor, sourceEvidence}) -> MemoryRecord`
- `MemoryRecord.scope = 'global' | 'project' | 'agent' | 'task'`
- `MemoryTraceItem = {sourceKey, scope, layer, score, reason, verifiedAt, selected, bytes}`

- [ ] **Step 1: 写失败测试**
  - 默认只召回当前项目和允许作用域，Agent 私有 Memory 不泄漏给其他 Agent。
  - 召回返回 L0 摘要时不读取正文；请求 L2 时才读取正文，并保持总字节上限。
  - 普通闲聊不触发 Memory；明确“不要记住”不读取也不写入。
  - 未验证任务结果只能生成 `candidate`，不能直接写入 active Memory。
  - 语义检索质量门禁失败时保留关键词检索，并返回 degraded/quality gate 原因。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/context/memory-service.test.mjs gateway/context/memory-admin.test.mjs gateway/context/memory-quality-gate.test.mjs gateway/context/memory-candidate.test.mjs
```

- [ ] **Step 3: 实现作用域和候选流程**
  - 在 PostgreSQL Memory repository 中增加 scope、abstract、overview、verifiedAt、retrieval metadata；Markdown 仍是用户可编辑副本。
  - 将现有关键词/embedding 结果统一转换为 `MemoryTraceItem`，并写入有界检索事件，不保存 Prompt 或完整正文。
  - 完成门禁通过后从结构化验证事实生成候选；用户明确操作或可信策略批准后才激活。
  - 保持现有 6 KB 默认注入上限、路径校验、删除/禁用和 degraded 语义。

- [ ] **Step 4: 运行 Memory 回归与结构检查**

```powershell
node --test gateway/context/memory-service.test.mjs gateway/context/memory-admin.test.mjs gateway/context/memory-quality-gate.test.mjs gateway/context/memory-candidate.test.mjs gateway/context/embedding-provider.test.mjs
node --check gateway/context/memory-service.mjs
node --check gateway/context/memory-candidate.mjs
git diff --check
```

验收：Memory 变得更像“可治理的上下文数据库”，但不会因自动续跑而自动沉淀未经验证的错误经验。

---

### Task 6: 事件触发的 Agent Mailbox 与有限协作

**Files:**
- Modify: `gateway/agents/agent-dispatcher.mjs`
- Modify: `gateway/agents/agent-registry.mjs`
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/storage/repositories/coordination-repository.mjs`
- Modify: `gateway/storage/postgres-schema.mjs`
- Modify: `gateway/agents/agent-dispatcher.test.mjs`
- Modify: `gateway/tasks/task-coordinator.test.mjs`
- Create: `gateway/agents/agent-message.mjs`
- Create: `gateway/agents/agent-message.test.mjs`

**Interfaces:**
- `createAgentMessage(input) -> {id, taskId, fromAgentRunId, toAgentRunId, act, subject, bodySummary, requiresReply, hops, expiresAt}`
- `deliverAgentMessage(message, repository) -> {status: 'delivered' | 'duplicate' | 'expired'}`
- `consumeAgentMailbox({taskId, agentRunId, limit}) -> AgentMessage[]`
- `shouldWakeAgent({message, agentState, budget}) -> {wake: boolean, reason}`

- [ ] **Step 1: 写失败测试**
  - 重复消息 ID 幂等；过期消息不唤醒 Agent。
  - 非 `request/query/propose` 消息不强制回复。
  - 超过 Hop、消息数、Token 或 Agent 数上限时进入 `coordination_budget_exceeded`。
  - 只有新消息到达时唤醒 Agent；没有定时轮询和空转 query。
  - 持久化消息不包含 Prompt、绝对路径和完整 Agent 结果正文。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/agents/agent-dispatcher.test.mjs gateway/agents/agent-message.test.mjs gateway/tasks/task-coordinator.test.mjs
```

- [ ] **Step 3: 实现消息边界**
  - Mailbox 通过现有 StorageGateway/repository 写入，不新增 JSON 文件事实源。
  - Coordinator 负责路由、Hop、唤醒预算和终态；Agent 只产生结构化消息和结果。
  - 任务完成、阻塞、停止或超预算时关闭该任务的可唤醒句柄，迟到消息只能记录为 ignored。

- [ ] **Step 4: 验证协作和停止路径**

```powershell
node --test gateway/agents/agent-dispatcher.test.mjs gateway/agents/agent-message.test.mjs gateway/tasks/task-coordinator.test.mjs
node --check gateway/agents/agent-message.mjs
git diff --check
```

验收：Agent 可以因为明确消息继续工作，但不会因为“还能继续”而自发消耗 Token。

---

### Task 7: 用量、上下文轨迹和 Workbench 展示

**Files:**
- Modify: `gateway/context/model-usage.mjs`
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/storage/repositories/task-repository.mjs`
- Modify: `gateway/http/workbench-routes.mjs`
- Modify: `desktop-ui/src/views/workbench-view-model.ts`
- Modify: `desktop-ui/src/views/WorkbenchView.vue`
- Modify: `desktop-ui/src/views/workbench-view-model.test.mjs`
- Create: `gateway/context/context-usage.mjs`
- Create: `gateway/context/context-usage.test.mjs`

**Interfaces:**
- `ContextUsage = {estimatedInputTokens, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, source: 'provider' | 'estimated' | 'partial' | 'unknown'}`
- Workbench task projection 增加 `executionMode`、`currentStepId`、`budget`、`continuationCount`、`wakeCount`、`contextUsage`、`contextTrace`。
- `GET /api/workbench/tasks` 只返回上述白名单投影，不返回 Prompt、绝对路径或正文。

- [ ] **Step 1: 写失败测试**
  - Provider 缺失 usage 字段时显示 `unknown/null`，不显示 0。
  - Workbench 能区分计划执行、续跑、Mailbox 唤醒和人工继续。
  - 上下文来源按 L0/L1/L2 展示，正文仍不可直接从 Workbench 投影读取。
  - 预算达到 80% 显示告警，达到上限显示 paused/blocked 原因。

- [ ] **Step 2: 运行定向测试确认失败**

```powershell
node --test gateway/context/model-usage.test.mjs gateway/context/context-usage.test.mjs gateway/tasks/task-workbench-runtime.test.mjs
node --test desktop-ui/src/views/workbench-view-model.test.mjs
```

- [ ] **Step 3: 实现投影和 UI**
  - 从 Coordinator 单一状态生成用量与上下文投影，禁止 UI 自己推断任务终态。
  - Workbench 增加当前计划步骤、预算进度、续跑次数、唤醒次数、阻塞原因和检索轨迹摘要。
  - 保持现有只读 Workbench、窄屏布局、刷新/错误/空状态和会话跳转行为。

- [ ] **Step 4: 运行前端和接口验证**

```powershell
node --test gateway/context/model-usage.test.mjs gateway/context/context-usage.test.mjs gateway/tasks/task-workbench-runtime.test.mjs
node --test desktop-ui/src/views/workbench-view-model.test.mjs
pnpm --dir desktop-ui exec vue-tsc --noEmit
pnpm --dir desktop-ui exec vite build
```

验收：用户能够判断“为什么继续、用了多少 Token、还剩多少预算、加载了哪些上下文”，而不是只看到 Agent 仍在运行。

---

### Task 8: 端到端门禁、性能基线和渐进发布

**Files:**
- Modify: `gateway/smoke/general-workbench-smoke.mjs`
- Create: `gateway/smoke/bounded-plan-context-smoke.mjs`
- Create: `gateway/smoke/bounded-plan-context-smoke.test.mjs`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `docs/architecture/current-state.md`
- Create: `docs/architecture/decisions/0015-bounded-task-continuation-and-context-budget.md`

**Interfaces:**
- Smoke fixture 使用本地 fake Provider，不访问真实 API、IM、设备或用户项目。
- Acceptance output 至少包含 `taskId`、步骤终态、continuation count、wake count、estimated/actual usage、context layers、blocker。

- [ ] **Step 1: 写失败 Smoke 测试**
  - 固定五步计划能从 Task 1 执行到 Task 5。
  - Task 3 阻塞时不执行 Task 4/5，恢复后只从 Task 3 继续。
  - 自动续跑达到预算时停止且不产生第六轮请求。
  - 上下文预算不足时裁剪 L2，并在报告中记录原因。
  - 重复事件、重复消息和强制停止后不会复活任务。

- [ ] **Step 2: 运行 Smoke 观察失败输出**

```powershell
node --test gateway/smoke/bounded-plan-context-smoke.test.mjs
```

- [ ] **Step 3: 实现 fake Provider 和验收脚本**
  - fake Provider 返回可控的 `max_turns`、结构化 Agent 结果、验证通过/失败和 usage。
  - Smoke 使用内存 StorageGateway stub 或临时 PostgreSQL schema，不读取真实用户数据。
  - 输出 JSON 报告，明确区分静态、host、runtime 和未验证项。

- [ ] **Step 4: 执行最小完整门禁**

```powershell
node --test gateway/tasks/task-*.test.mjs gateway/context/*.test.mjs gateway/agents/agent-*.test.mjs gateway/smoke/bounded-plan-context-smoke.test.mjs
node --check gateway/tasks/task-coordinator.mjs
node --check gateway/tasks/task-workbench-runtime.mjs
node --check gateway/context/context-planner.mjs
node --check gateway/agents/agent-message.mjs
pnpm --dir desktop-ui exec vue-tsc --noEmit
pnpm --dir desktop-ui exec vite build
git diff --check
```

- [ ] **Step 5: 记录 ADR 和发布开关**
  - 默认只发布 `session` 和显式 `workflow`。
  - `mission` 保持隐藏/实验开关，直到真实 Provider 下完成 Token、停止、恢复和长时间运行验收。
  - 记录未完成的真实 Provider、IM、桌面交互、备份恢复和外部等待验收，不把 fake Provider Smoke 当作产品完成证据。

## 验收标准

- 用户可以明确选择“执行到计划结束”，固定计划按依赖执行到最后一步。
- 任一步骤失败、阻塞、等待外部事件或超预算时，父任务暂停并可恢复，不静默跳过。
- 默认 Session 不产生后台自主请求；没有事件时 Agent 不被轮询唤醒。
- 自动续跑、Mailbox 唤醒和 Mission 都受 Token、轮次、时间、Hop、重试和 Agent 数限制。
- 上下文按 L0/L1/L2 规划，后续步骤不重复注入完整 transcript；每次裁剪有原因码。
- Memory 作用域、来源、新鲜度、验证状态和检索轨迹可审查；未经验证的候选不会自动成为长期事实。
- Workbench 能显示当前步骤、执行模式、预算、实际 usage、上下文层和阻塞原因，且不泄漏敏感正文。
- 通过定向测试、fake Provider Smoke、Vue 类型检查、Vite 构建、语法检查和 `git diff --check`；真实 Provider/IM/外部服务证据单独列为未验证或 blocker。

## 自检结论

- 计划覆盖固定任务链、有限自主续跑、Mailbox 协作、上下文分层、Memory 生命周期、用量观测和端到端验收。
- 计划复用当前已有的 `task-auto-continuation`、`light/focused/full`、Context Envelope、Memory quality gate、Coordinator 和 Workbench，不引入常驻 GOD Agent。
- 计划不要求直接安装或运行 OpenViking/Munder Difflin；只实现可验证的抽象思路。
