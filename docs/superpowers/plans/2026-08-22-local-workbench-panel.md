# 本地 Workbench 运行面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端增加一个独立的本地 Workbench 面板，查看任务队列、Agent/Workflow 进度、验证证据、执行报告、Pitfall 与 AI 层健康状态。

**Architecture:** 面板只消费现有 Coordinator、SQLite task projection、Execution Report、Pitfall 和 AI health 契约，不创建第二套任务状态。Gateway 增加只读 `/api/workbench/tasks` 查询，桌面端通过 `/workbench` 路由展示，设置页既有 Workbench Tab 保持兼容。全程不引入远端 Runtime、多机调度、云端 telemetry 或新依赖。

**Tech Stack:** Electron + Vue 3 Composition API + Vue Router 4 + TypeScript + 现有 Gateway REST API + SQLite projection。

## Global Constraints

- 只读查询，不新增远端执行、云同步或数据上传。
- 不保存 Prompt、凭据、完整 transcript、推理正文或绝对路径。
- 任务身份继续使用 `taskId`、`turnId`、`stepId`、`agentRunId`。
- 任务状态唯一来源仍为 Coordinator/SQLite projection，UI 不自行推断终态。
- 遵循现有 `apiFetch`、Vue 3 `<script setup>`、Scoped CSS 和本地主题变量。
- 保留用户已有 dirty worktree 改动，不提交、不回滚无关文件。

---

### Task 1: 暴露本地任务投影查询

**Files:**
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/storage/bridge-state-db.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `bridgeStateDb.listTaskStates(projectKeyOrNull, {activeOnly, limit}) -> TaskProjection[]`
- `GET /api/workbench/tasks?projectKey=<optional>&activeOnly=<optional>&limit=<optional> -> {tasks}`

- [ ] **Step 1: 写失败测试**：验证无 projectKey 时能列出全部项目，项目筛选只返回目标项目，state JSON 解析后保留 coordinator steps/agents/workflows/verification。
- [ ] **Step 2: 运行定向测试确认失败**：`node --test gateway/storage/bridge-state-db.test.mjs`。
- [ ] **Step 3: 实现可选 projectKey 查询**：保持参数化 SQL，`activeOnly` 仅限制已知运行态，不读取正文事实源。
- [ ] **Step 4: 增加 GET 路由**：限制 `limit` 范围，返回脱敏投影；Bridge 状态库不可用时返回空数组和 `stateStoreDegraded` 标记。
- [ ] **Step 5: 运行定向测试和语法检查**：`node --test gateway/storage/bridge-state-db.test.mjs; node --check gateway/index.mjs`。

### Task 2: 建立独立 Workbench 页面

**Files:**
- Create: `desktop-ui/src/views/WorkbenchView.vue`
- Create: `desktop-ui/src/views/workbench-view-model.ts`
- Create: `desktop-ui/src/views/workbench-view-model.test.mjs`
- Modify: `desktop-ui/src/router/index.ts`

**Interfaces:**
- `loadWorkbenchData({projectKey, activeOnly}) -> Promise<WorkbenchData>`
- `summarizeWorkbench(tasks, reports, pitfalls, health) -> WorkbenchSummary`

- [ ] **Step 1: 写视图模型失败测试**：覆盖任务状态计数、活动 Agent 计数、阻塞任务计数、无数据和未知 evidence level。
- [ ] **Step 2: 实现纯函数视图模型**：只做展示聚合，不改变任务状态。
- [ ] **Step 3: 实现页面数据加载**：并行请求 tasks/reports/pitfalls/ai-health；手动刷新和 5 秒轮询；页面卸载清理 timer。
- [ ] **Step 4: 实现面板区域**：顶部摘要、任务列表、选中任务详情、Agent/Workflow、验证和执行报告；提供加载、错误、空数据和 Gateway 降级状态。
- [ ] **Step 5: 运行视图模型测试与 Vue 类型检查**。

### Task 3: 接入桌面导航与交互验收

**Files:**
- Modify: `desktop-ui/src/components/SidebarLeft.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/i18n.ts`

**Interfaces:**
- Sidebar emits `goWorkbench`，WorkspaceView 处理为 `router.push('/workbench')`。

- [ ] **Step 1: 增加独立面板入口**：使用现有图标按钮样式和 tooltip，不改变项目/会话树。
- [ ] **Step 2: 增加中英文入口文案**，并保持设置入口不变。
- [ ] **Step 3: 运行 `pnpm exec vue-tsc --noEmit` 与 `pnpm exec vite build`。**
- [ ] **Step 4: 用桌面端代表性宽度检查导航、任务详情滚动、窄窗口溢出、加载/错误/空状态。

### Task 4: 文档和验收矩阵

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`

- [ ] **Step 1: 记录独立面板边界**：只读本地观测，不代表远端 Runtime 或真实 Provider 验收。
- [ ] **Step 2: 增加可验证证据**：Gateway endpoint、Vue 类型、生产构建和 UI smoke 状态。
- [ ] **Step 3: 运行 `git diff --check`，确认无凭据、Prompt、绝对路径或无关改动。
