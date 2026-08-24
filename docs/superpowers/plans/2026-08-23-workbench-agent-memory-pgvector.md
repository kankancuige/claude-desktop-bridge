# Workbench Agent 视图与可插拔高级 Memory 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地协作工作台能按任务、Agent、会话观察执行，并为高级 Memory 预留可验证的语义检索后端，而不破坏当前本地单用户事实源。

**Architecture:** Coordinator/PostgreSQL projection 是任务状态唯一事实源；Gateway 只投影脱敏的 Agent 名称、角色、目的、目标、状态、结果摘要和时间线。Workbench 增加三种只读视图与任务详情抽屉，详情仍通过现有会话路由打开正文。Memory 保留 Markdown 用户编辑副本，PostgreSQL 保存正文/元数据并按能力启用 pgvector；未配置 PostgreSQL 时明确阻止启动。

**Tech Stack:** Node.js ESM、PostgreSQL `pg` + pgvector、Electron + Vue 3 Composition API + Vue Router 4。

## Global Constraints

- 本项目继续定位本地单用户，不引入远程 Runtime、云同步、成员权限或设备/MQTT 能力。
- 不保存 Prompt、凭据、完整 transcript、工具输出或推理正文；Agent 目的和结果只保留有界脱敏摘要。
- Coordinator 是任务状态唯一权威；Workbench 只读，不创建第二套任务状态机。
- SQLite 继续作为默认本地运行态和可重建索引；PostgreSQL/pgvector 只能作为显式配置的可选 Memory 检索后端。
- 所有数据库访问必须参数化、有限查询、明确 timeout/cancellation，并提供降级和回滚策略。
- 保留用户已有 dirty worktree 改动，不提交、不回滚无关文件。

---

### Task 1: 扩展 Agent 脱敏投影与事件时间线

**Files:**
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/storage/bridge-state-db.test.mjs`
- Modify: `gateway/tasks/task-coordinator.test.mjs`

**Interfaces:**
- Agent snapshot fields: `agentRunId`, `agentType`, `name`, `role`, `purpose`, `goal`, `stepId`, `status`, `resultSummary`, `changedFileCount`, `testCount`, `startedAt`, `endedAt`, `updatedAt`。
- `state.coordinator.timeline`: bounded array of `{type, agentRunId, stepId, status, summary, at}` without prompt/transcript正文。

- [x] **Step 1: 写失败测试**：Agent started/completed/failed 事件保留名称、目的、目标和结构化结果计数；持久化投影不包含 prompt、绝对路径和完整结果正文；时间线最多保留 40 条。
- [x] **Step 2: 运行定向测试确认失败**：`node --test gateway/tasks/task-coordinator.test.mjs gateway/storage/bridge-state-db.test.mjs`。
- [x] **Step 3: 实现最小投影**：在 Coordinator 事件归一化时截断文本、提取 `result.summary/changedFiles/tests` 计数和起止时间；SQLite 投影同步白名单字段。
- [x] **Step 4: 运行定向测试与语法检查**：同上测试并执行 `node --check gateway/tasks/task-coordinator.mjs`。

### Task 2: Workbench 任务 / Agent / 会话视图与详情抽屉

**Files:**
- Modify: `desktop-ui/src/views/workbench-view-model.ts`
- Modify: `desktop-ui/src/views/workbench-view-model.test.mjs`
- Modify: `desktop-ui/src/views/WorkbenchView.vue`

**Interfaces:**
- `viewMode: 'tasks' | 'agents' | 'sessions'`。
- `workbenchAgents(tasks) -> AgentProjection[]`，`workbenchSessions(tasks) -> SessionProjection[]`。
- 选中任务打开只读详情抽屉，展示 Coordinator 步骤、Agent 身份/目的/目标、时间线、验证证据和 Execution Report，并提供“打开会话”。

- [x] **Step 1: 写失败测试**：覆盖 Agent 聚合去重、按更新时间排序、会话聚合、未知字段降级和详情选择稳定性。
- [x] **Step 2: 实现视图模型纯函数**：只从任务投影派生列表，不修改状态。
- [x] **Step 3: 实现 UI**：顶部 segmented control 切换三种视图；Agent 卡片显示 Agent 名称、角色、“负责什么”、所属任务和状态；会话卡片显示项目、会话状态和关联任务；任务详情使用不透明抽屉表面，支持窄屏滚动。
- [x] **Step 4: 运行 `pnpm exec vue-tsc --noEmit`、Workbench 测试和 `pnpm exec vite build`**。

### Task 3: Memory 后端边界与 pgvector 评估

**Files:**
- Create: `gateway/context/memory-backend.mjs`
- Create: `gateway/context/memory-backend.test.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Create: `docs/architecture/decisions/0013-optional-postgres-pgvector-memory.md`
- Modify: `docs/architecture/memory-product-comparison.md`

**Interfaces:**
- `createMemoryBackend({sqliteIndex, postgresConfig, logger}) -> {mode, search, upsert, disable, remove, health, close}`。
- 默认 `mode='sqlite-keyword'`；只有 `BRIDGE_MEMORY_BACKEND=postgres-pgvector` 且连接配置完整时尝试启用，否则明确返回 `fallback` 原因。

- [x] **Step 1: 写失败测试**：无配置时不连接 PostgreSQL；配置缺失时安全降级；SQLite 召回契约保持 6 KB 上限和作用域隔离。
- [x] **Step 2: 实现后端边界**：本阶段先实现 SQLite adapter 与 PostgreSQL capability probe/契约，不新增强制依赖，不把 Markdown 正文迁移为数据库事实源。
- [x] **Step 3: 记录 ADR**：明确 pgvector 需要独立 PostgreSQL 服务、embedding provider、加密/删除传播、备份恢复和迁移回滚；只迁移 Memory 索引/embedding，不迁移 transcript、任务状态和所有配置。
- [x] **Step 4: 运行 Memory 定向测试、`node --check` 与 `git diff --check`**。

### Task 4: 文档、验收与残余风险

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`

- [x] **Step 1:** 记录 Workbench 三视图、详情跟踪和 Agent 元数据的真实接口证据。
- [x] **Step 2:** 记录 PostgreSQL/pgvector 为可选后端，默认 SQLite；列出未配置真实 PostgreSQL 与 embedding provider 时的验证缺口。
- [x] **Step 3:** 运行完整最小门禁：Gateway 定向测试、Workbench 测试、`vue-tsc`、Vite build、Gateway 语法检查、`git diff --check`。

## 验收

- 任务视图能打开任务详情并显示负责 Agent、Agent 目的/目标、阶段、时间线、验证和报告。
- Agent 视图能按 Agent 名称和任务聚合，且不泄漏 prompt、凭据、正文或绝对路径。
- 会话视图能直接打开关联会话；无会话任务仍可查看详情。
- 未配置 PostgreSQL 时应用无需新服务即可启动，Memory 行为与现状一致。
- PostgreSQL/pgvector 只在后续明确配置、迁移和 embedding 验收后启用，不能把“支持向量”当作已完成的真实语义检索证据。
