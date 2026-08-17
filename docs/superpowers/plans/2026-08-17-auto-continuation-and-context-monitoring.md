# 自动续跑与上下文监测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 达到单段 `maxTurns` 时按任务复杂度受控续跑，并在长任务执行中持续展示真实上下文占用和 SDK 自动压缩状态。

**Architecture:** `maxTurns` 继续作为单个 Claude Agent SDK query 的防失控边界；Gateway 把 `error_max_turns` 识别为可恢复的中间态，关闭旧 query 后使用同一 SDK session 重建 query 并注入内部继续指令。上下文用量通过 SDK `getContextUsage()` 节流采样，压缩由 SDK 的 `autoCompactEnabled/autoCompactWindow` 在安全边界执行，Bridge 不在工具运行中并发注入 `/compact`。

**Tech Stack:** Node.js ESM、Claude Agent SDK 0.3.x、Vue 3、Node test runner、Vite。

## Global Constraints

- 保留用户已有 dirty worktree，不修改无关文件。
- 自动续跑必须有复杂度分级上限，不能形成无限循环。
- 用户停止、预算耗尽、执行错误和不可恢复状态不得自动续跑。
- 自动续跑期间父任务保持 `running`，桌面端和 IM 不得收到错误的完成通知。
- 上下文压缩必须由 SDK 在安全边界执行，不在工具调用中强插控制消息。

---

### Task 1: 自动续跑纯策略

**Files:**
- Create: `gateway/tasks/task-auto-continuation.mjs`
- Create: `gateway/tasks/task-auto-continuation.test.mjs`

**Interfaces:**
- Consumes: `classifyTaskResult()` 输出和 `taskDecision.modelTier/complexity`。
- Produces: `resolveAutoContinuation(input)`，返回是否续跑、当前次数、档位上限和内部提示。

- [ ] **Step 1: 写失败测试**

覆盖 `max_turns`、Light/Balanced/Power 次数边界、预算/执行错误、无会话和用户停止场景。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `node --test gateway/tasks/task-auto-continuation.test.mjs`

- [ ] **Step 3: 实现最小纯策略**

Light 最多自动续跑 1 次，Balanced 2 次，Power 3 次；所有非 `max_turns` 结果返回不续跑。

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `node --test gateway/tasks/task-auto-continuation.test.mjs`

### Task 2: Gateway 生命周期接入

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/sessions/session-runtime.mjs`
- Test: `gateway/sessions/session-runtime.test.mjs`

**Interfaces:**
- Consumes: `resolveAutoContinuation()`。
- Produces: `task_auto_continuing` WebSocket 事件和同一 SDK session 的新 query。

- [ ] **Step 1: 在 runtime 初始化续跑计数和待续跑状态**

字段为 `autoContinuationCount`、`autoContinuationTurns`、`_autoContinuationRequest`。

- [ ] **Step 2: 在 `error_max_turns` 结果处跳过父任务终态结算**

保存当前 checkpoint、累计轮数、广播 `task_auto_continuing`，不广播中间 `result`，不触发 IM 终态通知。

- [ ] **Step 3: 在旧 pump 完成后重建 query**

使用 `lastSessionId` 恢复同一会话，保留模型、权限、思考等级、上下文配置和原始 turn identity；重建失败进入明确 `failed` 状态。

- [ ] **Step 4: 新任务入口重置续跑计数**

补充消息不重置计数，用户停止清理待续跑请求。

### Task 3: 执行中上下文监测

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/context/context-lifecycle.mjs`
- Test: `gateway/context/context-lifecycle.test.mjs`

**Interfaces:**
- Consumes: SDK `query.getContextUsage()` 和生效的 `autoCompactWindow`。
- Produces: 节流的 `context_usage` 事件，包含真实最大上下文和自动压缩阈值。

- [ ] **Step 1: 为 context usage 事件补充外部阈值测试**

确保使用实际模型上限，配置只允许降低阈值。

- [ ] **Step 2: 在运行流中按时间节流采样**

工具/assistant 事件执行期间最多每 5 秒读取一次，不阻塞消息消费。

- [ ] **Step 3: 保持 SDK 自动压缩职责边界**

继续使用 `settings.autoCompactEnabled=true` 和 `autoCompactWindow=实际窗口的 90%`，不新增并发 `/compact`。

### Task 4: 前端执行轨迹

**Files:**
- Modify: `desktop-ui/src/task-activity.ts`
- Modify: `desktop-ui/src/components/TaskActivityTimeline.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: `desktop-ui/src/task-activity.test.mjs`

**Interfaces:**
- Consumes: `task_auto_continuing`、工具输入增量和工具结束事件。
- Produces: 默认可见的文件/命令/搜索详情和“自动续跑第 N/M 段”状态。

- [ ] **Step 1: 增加自动续跑 reducer 测试**

确认活动状态保持运行且新增可见步骤。

- [ ] **Step 2: 显示默认可见的一行详情**

长详情保持省略和可展开，窄窗口不溢出。

- [ ] **Step 3: 闭合工具开始、参数和结束事件**

按 stream index 定位工具并把步骤更新为完成。

### Task 5: 回归验证

**Files:**
- Verify only.

**Interfaces:**
- Consumes: 前述全部实现。
- Produces: 测试、类型、构建和差异证据。

- [ ] **Step 1: Gateway 全量测试**

Run: `node --test gateway/**/*.test.mjs`

- [ ] **Step 2: Desktop UI 全量测试和类型检查**

Run: `node --test desktop-ui/src/*.test.mjs`

Run: `pnpm exec vue-tsc --noEmit`

- [ ] **Step 3: 前端构建和语法检查**

Run: `pnpm exec vite build`

Run: `node --check gateway/index.mjs`

- [ ] **Step 4: 工作树检查**

Run: `git diff --check`
