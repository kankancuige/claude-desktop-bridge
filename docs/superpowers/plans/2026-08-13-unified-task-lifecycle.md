# Unified Task Lifecycle Implementation Plan

> **For agentic workers:** 按任务顺序实现并在每个阶段运行对应验证；本计划由当前会话直接执行，不自动提交。

**Goal:** 让 Gateway 成为父任务生命周期唯一业务所有者，统一桌面端发送、停止、继续和 IM 最终通知语义。

**Architecture:** Gateway 聚合父任务持久态、runtime 和全部 Workflow，输出版本化快照。桌面端 reducer 消费快照并提供 selectors，原有 Agent、Workflow 和活动状态只保留展示用途。旧 WebSocket 事件在迁移期兼容保留。

**Tech Stack:** Node.js ESM、WebSocket、Vue 3、TypeScript、Node test runner。

## Global Constraints

- 不新增依赖，不改变 Claude SDK transcript 所有权。
- `result`、Agent done、Workflow done 不能单独完成父任务。
- 只有父任务终态事件允许发送微信、飞书、钉钉最终通知。
- 保留 dirty worktree，不自动 commit 或 push。

---

### Task 1: Gateway 生命周期聚合

**Files:**
- Create: `gateway/task-lifecycle.mjs`
- Create: `gateway/task-lifecycle.test.mjs`
- Modify: `gateway/session-runtime-state.mjs`

**Interfaces:**
- Produces: `createTaskLifecycleSnapshot()`、`sortSessionWorkflows()`、`getCurrentSessionWorkflow()`。

- [x] 写失败用例，覆盖父任务、runtime、多个 Workflow 和终态能力。
- [x] 实现纯函数聚合，不读取全局状态。
- [x] 区分 `runtimeReady` 与 `generating`。
- [x] 运行定向 Gateway 测试。

### Task 2: Workflow 快照与停止收敛

**Files:**
- Modify: `gateway/workflow-runner.mjs`
- Modify: `gateway/task-completion.mjs`
- Modify: `gateway/session-stop.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `createTaskLifecycleSnapshot()`。
- Produces: `getSessionWorkflowStates()`、`user_stopped` transition、`session_lifecycle_snapshot`。

- [x] 返回会话全部 Workflow，并确定性选择兼容快照。
- [x] 区分父任务所属与独立 Workflow；停止父任务时停止全部活跃 Workflow，只停止独立 Workflow 时不改写父任务终态或关闭 SDK runtime。
- [x] 停止通过父任务 reducer 进入 `stopped`。
- [x] runtime 异常通过父任务 reducer 进入 `interrupted`，同时清理 Workflow 等待门禁。
- [x] 重连和关键 Workflow/父任务事件后发送统一快照。

### Task 3: Desktop reducer 与 selectors

**Files:**
- Create: `desktop-ui/src/task-lifecycle.ts`
- Create: `desktop-ui/src/task-lifecycle.test.mjs`
- Modify: `desktop-ui/src/task-busy.ts`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: `session_lifecycle_snapshot`。
- Produces: `reduceSessionLifecycle()` 和权威 `taskBusy` selector。

- [x] 覆盖 `result`/Workflow done 不得提前空闲。
- [x] 标签状态保存和恢复生命周期快照。
- [x] 权威快照到达后，展示状态不能反向判忙。
- [x] 本地发送只预测开始，终态仍由 Gateway 决定。

### Task 4: 移除剩余重复业务写入口

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `gateway/index.mjs`
- Create: `gateway/session-runtime.mjs`（仅在 Session 工厂迁移阶段创建）

**Interfaces:**
- Consumes: 统一生命周期快照和父任务 reducer。
- Produces: 组件只读 selectors、统一 Session runtime 工厂。

- [x] 删除 `_turnCompleted + Agent/Workflow` 的重复完成判定；`status` 和 `parentTaskUi` 只保留展示赋值，操作能力统一读取生命周期 selector。
- [x] 合并普通、恢复、scheduled Session 的初始化工厂和不变量。
- [x] 为 task-owned Workflow 增加精确结果标记，隐藏内部回灌消息并防止普通补充消息误解除等待。
- [ ] 为 IM adapter 建立 `submitTask/observeTask/cancelTask` command API，再移除三套生命周期解释。
- [ ] 兼容窗口结束后删除旧 Session/Workflow 快照。

### Task 5: 全量验证

**Files:** 所有本轮改动。

- [x] 运行 Gateway 全量测试（239/239）。
- [x] 在 `desktop-ui` 运行全量测试（79/79）。
- [x] 运行 `npx vue-tsc --noEmit` 和 `npx vite build`。
- [x] 运行 `node --check gateway/index.mjs`、`gateway/workflow-runner.mjs`、`gateway/session-runtime.mjs` 和 `gateway/task-lifecycle.mjs`。
- [x] 运行 `git diff --check`，复核 dirty worktree 并扫描本轮新增 UTF-8 文件。
- [ ] 真实 Electron 长任务切 tab、停止、最终审查和 IM 通知 smoke；缺少凭据时明确标记未验证。
