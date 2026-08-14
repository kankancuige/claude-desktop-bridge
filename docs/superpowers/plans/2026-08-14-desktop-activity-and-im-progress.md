# Desktop Activity Timeline And IM Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面会话实时显示紧凑的完整执行轨迹，同时让微信、飞书、钉钉仅在长任务阶段变化时发送节流进度，短任务只发送最终总结。

**Architecture:** Gateway 广播事件作为桌面和 IM 的统一任务事件来源。桌面端将事件归并为可持久化到标签页快照的 activity entries；IM 由独立 reporter 统一执行首次延迟、阶段去重、发送间隔和数量上限，平台适配器只负责投递。

**Tech Stack:** Electron、Vue 3、TypeScript、Node.js ESM、Node test runner。

## Global Constraints

- 保留现有 dirty worktree，不覆盖或格式化无关文件。
- 中文源码与注释统一使用 UTF-8。
- UI 使用现有主题变量、不透明表面和紧凑扁平布局。
- 不展示或伪造隐藏推理，只展示 SDK 实际提供的 thinking summary。
- 工具参数只显示截断、脱敏摘要，不持久化工具输出或凭据。
- 本轮不 commit、不 push、不重启 Gateway 或 Electron。

---

### Task 1: Activity Timeline State

**Files:**
- Modify: `desktop-ui/src/task-activity.ts`
- Modify: `desktop-ui/src/task-activity.test.mjs`

**Interfaces:**
- Consumes: Gateway WebSocket events such as `task_started`, `thinking_delta`, `tool_use_start`, `tool_progress`, `content_block_stop`, Agent, Workflow and terminal events.
- Produces: `TaskActivityState.entries`, `reduceTaskActivity()` and sanitized activity summaries.

- [ ] **Step 1:** 增加失败测试，覆盖步骤开始、原位更新、完成、耗时、重复事件去重、终态关闭和脱敏截断。
- [ ] **Step 2:** 运行 `node --test desktop-ui/src/task-activity.test.mjs`，确认新增断言先失败。
- [ ] **Step 3:** 实现 activity entry reducer；同一工具、思考块或 Agent 使用稳定 ID 更新，不重复插入。
- [ ] **Step 4:** 重新运行定向测试并确认通过。

### Task 2: Desktop Activity Rendering

**Files:**
- Create: `desktop-ui/src/components/TaskActivityTimeline.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: `TaskActivityState` from Task 1.
- Produces: message-flow activity row, expanded details and tab snapshot recovery.

- [ ] **Step 1:** 扩展 `Message` 支持 `activity` role，并在任务开始时插入一条活动消息。
- [ ] **Step 2:** 将所有任务事件先归并到当前活动消息，再执行现有消息、Agent 和宠物状态处理。
- [ ] **Step 3:** 创建紧凑时间线组件，显示状态、标题、摘要、单步耗时和总耗时；详情默认折叠。
- [ ] **Step 4:** 确认标签切换通过既有 `messages` 快照保留轨迹，历史 transcript 继续使用现有 thinking/tool 展示。
- [ ] **Step 5:** 运行 TypeScript 检查和前端构建。

### Task 3: Unified IM Progress Reporter

**Files:**
- Create: `gateway/im-progress-reporter.mjs`
- Create: `gateway/im-progress-reporter.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: the same task, SDK and Workflow events sent to desktop clients.
- Produces: delayed and throttled progress text through a single `send` callback.

- [ ] **Step 1:** 增加 fake-clock 测试，覆盖 30 秒前不发送、首次进度、60 秒阶段变化、重复阶段抑制、最大消息数和终态 timer 清理。
- [ ] **Step 2:** 实现 `createImProgressReporter()`，默认首次延迟 30 秒、后续间隔 60 秒、最多 4 条进度。
- [ ] **Step 3:** 在 Gateway 为 IM 来源和 desktop mirror 解析唯一收件人，并让 `broadcastTurn` 与 Workflow 广播共用 reporter。
- [ ] **Step 4:** 终态、停止和错误事件立即释放 reporter；最终总结仍沿用现有可靠通知出口。

### Task 4: Remove Per-Tool IM Notifications And Verify

**Files:**
- Modify: `gateway/im-task-runner.mjs`
- Modify: `gateway/im-task-runner.test.mjs`
- Modify: `gateway/wechat.mjs`
- Modify: `gateway/feishu.mjs`
- Modify: `gateway/dingtalk.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: Task 3 reporter.
- Produces: platform adapters that only deliver permission, choice, terminal and centrally selected progress messages.

- [ ] **Step 1:** 删除 `runImTask` 的 `onTool` 回调及三个适配器逐工具消息。
- [ ] **Step 2:** 删除 `maybeMirrorProgress()` 逐工具镜像出口和旧注释。
- [ ] **Step 3:** 更新测试，确认工具事件只计数、不直接通知，权限、选择、错误、停止和最终总结仍保留。
- [ ] **Step 4:** 运行 Gateway 全量测试、前端定向测试、Vue typecheck、Vite build 和 `git diff --check`。
