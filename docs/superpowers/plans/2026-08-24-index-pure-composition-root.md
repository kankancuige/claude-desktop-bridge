# Gateway Index Pure Composition Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `gateway/index.mjs` 收敛为唯一启动组合根，所有运行时实现、HTTP、Session、SDK、WebSocket、IM 和生命周期逻辑由独立模块提供。

**Architecture:** 保留 `gateway/index.mjs` 作为 Electron/Node 兼容入口，只负责导入 `gateway-runtime.mjs`、启动和转发未捕获启动错误。运行时模块先以行为等价的单一边界承载现有实现，再按依赖方向拆分 Session、Transport、IM 和生命周期模块；每次迁移保持 `node gateway/index.mjs`、PostgreSQL、HTTP/WS 契约不变。

**Tech Stack:** Node.js ESM、Electron 42、Claude Agent SDK、PostgreSQL/pg、WebSocket、Node test runner、Vue 3/Vite。

## Global Constraints

- 不重新引入 SQLite，不改变 PostgreSQL、transcript、Session Event Journal、HTTP、WebSocket 或 IM 公开契约。
- 保留用户已有改动；不执行 `git reset --hard`、`git checkout --`、commit 或 push。
- `index.mjs` 最终只允许入口导入、启动调用和顶层启动错误转发。
- 每个迁移块必须先有直接契约测试，再运行 `node --test gateway`、语法检查和 `git diff --check`。
- 真实 Provider/IM 请求不作为代码迁移的通过条件；环境阻塞必须单独记录。

## 任务

### Task 1: 建立运行时入口边界

**Files:**
- Create: `gateway/gateway-runtime.mjs`
- Modify: `gateway/index.mjs`
- Create: `gateway/gateway-entry.test.mjs`

- [x] 原 Gateway 实现已迁移到 `gateway/gateway-runtime-impl.mjs`，相对路径和 `__dirname` 保持在 `gateway` 根目录。
- [x] `gateway-runtime.mjs` 不再自动启动，导出稳定的 `startGateway()` 契约。
- [x] `index.mjs` 已缩减为导入 `startGateway`、调用并转发启动异常。
- [x] 入口契约测试确认 `index.mjs` 不含业务函数、HTTP pathname 分支或数据库访问。

### Task 2: 抽取 Session Runtime 与 SDK Stream

**Files:**
- Create: `gateway/runtime/session-runtime-service.mjs`
- Create: `gateway/runtime/sdk-stream-service.mjs`
- Modify: `gateway/gateway-runtime.mjs`
- Create: `gateway/runtime/session-runtime-service.test.mjs`

- [x] Session Map、输入队列和协调器初始化已封装为 `createSessionRuntimeService(deps)`；创建/恢复/停止业务仍由 Session 路由注入。
- [x] Provider usage、上下文采样和节流已封装为 `createSdkStreamService(deps)`；完整 `startStreamPump` 生命周期仍在后续迁移块。
- [x] 通过 getter/setter/State Port 注入 `sessions`、focused session、broadcast、storage 和 coordinator，禁止新模块复制组合根状态。
- [x] 通过 Session Runtime、Input、Stop、SDK Stream、WebSocket 和资源生命周期契约覆盖新建、resume、stop、重复输入、stream timeout、result cleanup 和释放路径。

### Task 3: 抽取 WebSocket/Task Command Transport

**Files:**
- Create: `gateway/runtime/websocket-gateway.mjs`
- Create: `gateway/runtime/task-command-runtime.mjs`
- Modify: `gateway/gateway-runtime.mjs`
- Create: `gateway/runtime/websocket-gateway.test.mjs`

- [x] WebSocket upgrade 与认证边界已迁出；ping/pong、控制通道和 Session 消息生命周期仍由运行时实现接线。
- [x] 将 `submitTaskCommand` 及 desktop/IM 输入适配保留在统一 TaskCommandService 之上。
- [x] 通过 WebSocket、Task Command、Session Stop 和 IM wiring 契约覆盖无 token、错误 Session、重连、停止、补充输入和控制通道广播。

### Task 4: 抽取 IM 与定时生命周期

**Files:**
- Create: `gateway/runtime/im-runtime.mjs`
- Create: `gateway/runtime/scheduled-runtime.mjs`
- Modify: `gateway/gateway-runtime.mjs`
- Create: `gateway/runtime/im-runtime.test.mjs`

- [x] Adapter 启停、凭据迁移、绑定、通知 outbox 对账、进度报告和镜像路由已迁出到 IM Runtime。
- [x] scheduled task 注册、执行、恢复和销毁已迁出到 Scheduled Runtime/Store。
- [x] 通过 PostgreSQL Repository port 注入状态，不恢复 JSON/SQLite 结构化 fallback。

### Task 5: 抽取资源、项目和关闭生命周期

**Files:**
- Create: `gateway/runtime/project-runtime.mjs`
- Create: `gateway/runtime/shutdown-runtime.mjs`
- Modify: `gateway/gateway-runtime.mjs`
- Create: `gateway/runtime/shutdown-runtime.test.mjs`

- [x] 项目缓存后台构建去重、延迟和失败重试已迁出；项目扫描、快照、checkpoint 和删除清理仍在运行时实现。
- [x] Gateway shutdown 的资源顺序、超时和错误隔离已迁出。
- [x] 已覆盖关闭顺序、重复 shutdown、单资源失败隔离和 PostgreSQL/HTTP 清理。

### Task 6: 最终入口门禁和真实启动

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/superpowers/plans/2026-08-24-index-pure-composition-root.md`

- [x] 静态断言确认 `index.mjs` 只有入口启动职责，运行时实现不在入口文件。
- [x] Gateway 全量测试 `585/585` 通过；入口、运行时新增契约测试通过，`git diff --check` 通过。
- [x] 真实 Gateway 已启动并验收 PostgreSQL 健康、`/api/health`、`/api/projects`、Workbench 路由和 Provider 配置；Session 创建回归已修复并复验。
- [x] IM 的 `secure payload key is unavailable` 保留为 Electron 密钥注入环境 blocker；不影响代码门禁，不冒充 IM 真实送达通过。

### Task 7: Session Context Runtime

**Files:**
- Create: `gateway/runtime/session-context-runtime.mjs`
- Create: `gateway/runtime/session-context-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

- [x] 项目 transcript 接力、用户偏好和 PostgreSQL Memory 通过显式依赖注入迁出。
- [x] 读取失败保持原始输入降级，且补充输入不会重复解析首轮接力上下文。
- [x] 定向契约测试覆盖正常注入、幂等、失败降级和无 Session 输入。

### Task 8: Project/Session Runtime

**Files:**
- Create: `gateway/runtime/project-session-runtime.mjs`
- Create: `gateway/runtime/project-session-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

- [x] 项目分组、可见性迁移、PostgreSQL Session Catalog 协调、项目列表和删除过滤迁出。
- [x] Session 删除清理通过统一 Runtime 处理 transcript、SDK 目录、映射、可见性、任务元数据和镜像。
- [x] 旧组合根调用保留稳定 wrapper，并完成定向测试、语法检查和全量 Gateway 测试。
- [x] 删除组合根中已无调用方的 legacy project/session 实现，完成最终纯组合根审查。

### Task 9: Project File Runtime

**Files:**
- Create: `gateway/runtime/project-file-runtime.mjs`
- Create: `gateway/runtime/project-file-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

- [x] 文件系统扫描、Git 文件清单、快照构建、行级 Diff 和快照差异算法迁出组合根。
- [x] Session Artifact、项目缓存和文件 HTTP 路由继续通过稳定函数端口消费，行为契约保持不变。
- [x] 常量、路径安全和 Git 命令均由 Project File Runtime 显式拥有，组合根只创建实例并绑定端口。
- [x] 定向测试、入口测试、语法检查、全量 Gateway 测试和 `git diff --check` 通过。

### Task 10: Session Cleanup Runtime

**Files:**
- Create: `gateway/runtime/session-cleanup-runtime.mjs`
- Create: `gateway/runtime/session-cleanup-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

- [x] transcript 头读取和启动时孤儿 Session 目录清理迁出组合根。
- [x] 清理过程继续保持异常隔离、ENOENT 降级和明确清理计数。
- [x] 定向入口与 Runtime 测试、语法检查通过；全量回归在本轮迁移前已通过 `622/622`，待本轮迁移后复跑。

## Low-Coupling Closure Extension

### Task 11: Session State Port

**Files:**
- Create: `gateway/runtime/session-state-port.mjs`
- Create: `gateway/runtime/session-state-port.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/runtime/session-input-runtime.mjs`
- Modify: `gateway/runtime/session-stop-runtime.mjs`
- Modify: `gateway/runtime/websocket-session-runtime.mjs`

**Interfaces:**
- Produces `createSessionStatePort({sessions, focusedSessionId, setFocusedSessionId})` with `get`, `list`, `has`, `setFocused`, `getFocused`, `register`, `remove`.
- Consumers use the port instead of capturing the raw `Map` or a copied focused-session value.

- [x] Add contract tests for focused-session validity, registration, removal and disposed state.
- [x] Replace runtime-facing direct focused-session and session-map access with the port; retain the `Map` only inside the port owner.
- [x] Verify Session create/resume/stop/reconnect and mirror route contracts through the Session Runtime/HTTP regression suite.

### Task 12: Narrow IM and Notification Storage Port

**Files:**
- Create: `gateway/storage/repositories/notification-repository.mjs`
- Create: `gateway/storage/repositories/notification-repository.test.mjs`
- Modify: `gateway/runtime/im-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/storage/storage-gateway.mjs`
- Modify: `gateway/runtime/startup-runtime.mjs`

**Interfaces:**
- Produces `notificationRepository` methods `listPending`, `updateState`, `summarize`, `clearPlatform`.
- IM runtime receives `getNotificationRepository` and never receives `PostgresStateCompat`.

- [x] Implement the repository using the existing state port and preserve parameterized PostgreSQL writes.
- [x] Move notification reconciliation, summary and cleanup calls to the repository.
- [x] Add wiring tests proving IM runtime has no `bridgeStateDb` dependency.

### Task 13: Scheduled Task Port

**Files:**
- Create: `gateway/runtime/scheduled-task-store.mjs`
- Create: `gateway/runtime/scheduled-task-store.test.mjs`
- Modify: `gateway/runtime/scheduled-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/http/adapter-config-routes.mjs`

**Interfaces:**
- Produces `createScheduledTaskStore({readJSON, writeJSON, path})` with `list`, `get`, `upsert`, `remove`.
- Scheduler receives the store and no longer owns the JSON file or mutable config object directly.

- [x] Add bounded validation and atomic write behavior for scheduled task definitions.
- [x] Move register/resume/execute lookups to the store and keep active run state private to Scheduler.
- [x] Verify schedule CRUD, resume and concurrent execution limits.

### Task 14: Workflow Runtime Instance

**Files:**
- Create: `gateway/runtime/workflow-runtime.mjs`
- Create: `gateway/runtime/workflow-runtime.test.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/http/workflow-routes.mjs`

**Interfaces:**
- Produces `createWorkflowRuntime(deps)` with the current CRUD/run/history/state methods.
- Route and task consumers receive the instance; module-level `setDeps` remains only as a compatibility adapter for tests during migration.

- [x] Encapsulate Workflow dependencies in an instance and preserve existing exported function behavior.
- [x] Switch HTTP and auto-trigger callers to the instance.
- [x] Add test proving two runtime instances do not share mutable dependencies.

### Task 15: Repository-First State Migration

**Files:**
- Modify: `gateway/storage/repositories/session-repository.mjs`
- Modify: `gateway/storage/repositories/project-repository.mjs`
- Modify: `gateway/storage/repositories/workbench-repository.mjs`
- Modify: `gateway/storage/repositories/pitfall-repository.mjs`
- Modify: `gateway/storage/repositories/im-repository.mjs`
- Modify: `gateway/runtime/project-session-runtime.mjs`
- Modify: `gateway/runtime/task-lifecycle-runtime.mjs`
- Modify: `gateway/runtime/im-runtime.mjs`
- Modify: `gateway/context/pitfall-service.mjs`
- Modify: `gateway/runtime/startup-runtime.mjs`

- [x] Add complete domain methods required by current callers to each repository.
- [x] Change runtime services to depend on repository ports, not `stateStore`/`PostgresStateCompat`.
- [x] Keep Compat only inside startup/repository adapter and add a zero direct-business-reference wiring test.
- [x] Verify PostgreSQL state and degraded behavior through existing storage/degraded-path regression contracts; real external outage acceptance remains separate.

### Task 16: Composition Root Narrowing and Closure Gates

**Files:**
- Create: `gateway/runtime/runtime-context.mjs`
- Create: `gateway/runtime/runtime-context.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/runtime/http-runtime.mjs`
- Modify: `gateway/http/*.mjs`
- Modify: `docs/architecture/current-state.md`

- [x] Replace Workflow/Session/Task/Notification HTTP dependencies with named domain ports and runtime instances; remaining legacy route fields are compatibility-only adapters.
- [x] Move remaining pure helpers and lifecycle wiring into focused runtime factories, leaving `gateway/index.mjs` as the startup entry and `gateway-runtime-impl.mjs` as composition root.
- [x] Add static gates for direct `PostgresStateCompat`, `setDeps`, raw session Map and scheduled JSON access outside their adapters.
- [x] Run prior Gateway/runtime gates and desktop checks; final closure evidence is recorded in Task 20.

### Task 17: Session Upload and File Boundary

**Files:**
- Create: `gateway/runtime/session-upload-runtime.mjs`
- Create: `gateway/runtime/session-upload-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

**Interfaces:**
- Produces `createSessionUploadRuntime({safeChildPath, cleanupUploadDir, prepareUploadDir, statSync, ttlMs, logger})` with `isValidSessionId`, `getUploadDir(workDir, sessionId)`, `cleanupSessionUploads(workDir, sessionId, removeAll)`, `prepareSessionUploadDir` and `isDirectoryPath(path)`.
- The composition root only creates the runtime and passes stable function ports to HTTP, Session Cleanup and upload handlers.

- [x] Move upload path validation, Session ID validation, directory checks and cleanup implementation out of the composition root.
- [x] Preserve path traversal, invalid session id, quota and TTL behavior with direct contract tests.
- [x] Create the upload runtime and run focused Gateway tests; legacy `prepareUploadDir` remains an injected storage primitive for the existing multipart route.

### Task 18: SDK Client Event Adapter Boundary

**Files:**
- Modify: `gateway/sessions/sdk-stream-adapter.mjs`
- Modify: `gateway/sessions/sdk-stream-adapter.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

**Interfaces:**
- `createSdkStreamAdapter` exposes the complete client event conversion port consumed by SDK Stream and WebSocket runtimes.
- No `convertSdkToWs` implementation remains in the composition root.

- [x] Move the conversion wrapper and session lookup into the adapter factory.
- [x] Cover text, thinking, tool, result, error and unknown SDK events.
- [x] Remove the root-local converter and pass `sdkStreamAdapter.toClientEvent` directly.

### Task 19: Composition Root Pure-Port Gate

**Files:**
- Modify: `gateway/runtime/composition-root-wiring.test.mjs`
- Modify: `docs/architecture/current-state.md`
- Modify: `TASK_STATE.md`

- [x] Add static gates rejecting HTTP pathname branches, database/file writes, SDK async iteration and direct Session Map state transitions in `gateway-runtime-impl.mjs`.
- [x] Keep the root limited to imports, constants, dependency factories, port wrappers, route-context assembly, lifecycle listeners and `startGateway`; `PushStream` is now in `gateway/runtime/push-stream.mjs`.
- [x] Document the remaining accepted root responsibilities and exact residual risks.

### Task 20: Final Closure Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-index-pure-composition-root.md`

- [x] Run `node --test gateway` and record the exact count (`684/684`).
- [x] Run `node --check` on all changed runtime files and `git diff --check`.
- [x] Run `pnpm exec vue-tsc --noEmit` and `pnpm exec vite build`.
- [x] Use the running source Gateway to verify PostgreSQL health, `/api/health`, `/api/projects` and a temporary Session WebSocket handshake; delete the temporary Session after the probe.
