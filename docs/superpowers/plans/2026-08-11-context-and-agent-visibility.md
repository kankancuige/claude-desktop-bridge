# 上下文与 Agent 可见性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端使用 SDK 实际上下文窗口，接近 90% 时由 SDK 自动压缩，并让 Agent 卡片同时显示固定职责与本次具体任务，避免压缩摘要污染聊天气泡。

**Architecture:** Gateway 负责读取 SDK context usage、转发标准化生命周期事件并过滤 synthetic compact summary；Vue 只消费标准化事件并持有展示状态。模型窗口采用“SDK 实际值优先、供应商元数据次之、未知则 unknown”的单向策略，用户配置只能作为更小安全上限。

**Tech Stack:** Node.js ESM、Claude Agent SDK 0.3.206、Vue 3、TypeScript、WebSocket、Node `node:test`。

## Global Constraints

- 保留当前 dirty worktree，不执行 reset、checkout、commit、push 或依赖安装。
- 所有回复和新增注释使用简体中文；注释解释 WHY。
- 不把未知模型伪造成 1M，不让 compact summary 进入普通用户气泡。
- 90% 自动压缩优先使用 Claude Agent SDK 原生 `autoCompactEnabled`，运行中的 Agent/工具调用不插入并发 `/compact`。

---

### Task 1: 上下文纯函数与失败测试

**Files:**
- Create: `gateway/context-lifecycle.mjs`
- Create: `gateway/context-lifecycle.test.mjs`
- Create: `desktop-ui/src/context-usage.ts`
- Create: `desktop-ui/src/context-usage.test.mjs`

- [ ] 写测试覆盖 `256K` 解析、实际窗口优先级、未知模型、SDK usage 百分比、compact boundary 和 synthetic summary 过滤。
- [ ] 运行 `node --test gateway/context-lifecycle.test.mjs desktop-ui/src/context-usage.test.mjs`，确认新增测试先失败。
- [ ] 实现无副作用的标准化函数，供 Gateway 与 Vue 共用语义。
- [ ] 重新运行上述测试，确认通过。

### Task 2: Gateway SDK 生命周期

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/session-init-event.mjs`
- Modify: `gateway/session-history.mjs`
- Modify: `gateway/agent-tool-lifecycle.mjs`
- Modify: `gateway/agent-tool-lifecycle.test.mjs`

- [ ] 为 Agent descriptor 增加 `purpose/task/scope/currentAction/descriptionSource`，并测试具体任务不会被 builtin purpose 覆盖。
- [ ] 在 query options 开启 SDK 原生自动压缩并加入 PreCompact/PostCompact hooks。
- [ ] 在 `system_init`、每个 `result` 后调用 `query.getContextUsage()`，广播 `context_usage`。
- [ ] 转发 `compact_boundary/context_compacting/context_compacted`，过滤 compact summary user 消息。
- [ ] 运行全部 Gateway 测试和 `node --check gateway/index.mjs`。

### Task 3: Vue 状态与显示

**Files:**
- Modify: `desktop-ui/src/components/types.ts`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/components/RightPanels.vue`

- [ ] 接入 `context_usage`，圆环使用 SDK percentage 和实际 maxTokens。
- [ ] 80% 显示提醒，90% 显示自动压缩状态；压缩期间消息进入队列。
- [ ] 用紧凑系统条显示压缩前后 token 与耗时，摘要只在展开查看时显示。
- [ ] Agent 卡片分区显示类型、固定职责、本次任务、当前操作、状态与耗时。
- [ ] 运行 `pnpm exec vue-tsc --noEmit` 和 Vite build。

### Task 4: 回归门禁

**Files:**
- No new files.

- [ ] 用 compact summary JSONL fixture 验证实时与历史显示均无巨大用户气泡。
- [ ] 运行 `node --test gateway/*.test.mjs desktop-ui/src/*.test.mjs`。
- [ ] 运行 `git diff --check`，记录 SDK 自动压缩和真实桌面渲染仍需 smoke 的证据边界。
