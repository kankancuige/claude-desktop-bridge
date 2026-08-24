# Code Closure Before Runtime Validation

**Goal:** 在进入真实数据库、Provider、桌面和 IM 验收前，关闭 PostgreSQL 唯一运行时入口、Memory/Pitfall 兼容残留、失败传播和架构文档状态不一致问题。

**范围:** 只改代码、单元测试、静态契约和架构计划；本阶段不发送真实 Provider 请求、不执行真实 IM 投递、不做桌面 E2E。SQLite 不属于允许的运行时、迁移或测试依赖。

## 门禁

- PostgreSQL 是 Gateway 正常运行时唯一结构化状态入口。
- PostgreSQL 是唯一结构化运行时、迁移后和测试契约入口。
- Memory 管理、召回、启停、重建和 Pitfall 服务不能以 SQLite 作为运行时 fallback。
- 配置、schema、失败码、取消和资源释放必须有测试契约。
- 代码层闭合后才进入真实环境验收。

## 执行项

- [x] 清理 Memory backend 和管理 API 的 SQLite 运行时 fallback，统一 PostgreSQL/不可用状态。
- [x] 修正 Pitfall、健康检查、状态错误和文档中的 SQLite 过时语义。
- [x] 补齐配置、StorageGateway、StateCompat、Memory、Pitfall 的失败传播和关闭测试。
- [x] 更新架构计划与当前状态，区分代码闭合和外部验收 blocker。
- [x] 运行静态扫描、Gateway 全量测试、语法检查和 diff 检查。

## 组合根继续迁出（2026-08-24）

- [x] 提取 `session-mutation-routes.mjs`：会话创建、停止、解析、聚焦、删除、批量删除和桌面 nudge。
- [x] 提取 `session-file-routes.mjs`：会话文件树、上传、文件内容、diff、snapshot、save-and-snapshot、mirror、commit、checkpoints、rewind。
- [x] 提取 `adapter-config-routes.mjs`：scheduled tasks、通知恢复、Adapter 绑定/配置/二维码、MCP、WeChat send/confirm/balance。
- [x] 提取 `memory-routes.mjs`：项目列表、项目会话/消息、Memory CRUD/rebuild/status 和 memory summary。
- [x] 提取 `workflow-routes.mjs`：Workflow CRUD、run/stop/resume、状态和 Agent 控制。
- [x] 删除 `index.mjs` 中已迁出路由，仅保留认证、CORS、路由组合、HTTP server 和生命周期编排；协议层位于 `gateway/http/request-handler.mjs`。
- [x] 接通 `workbench-routes.mjs` 的健康、任务、项目、报告、Pitfall 和 AI health 路由，全部通过 PostgreSQL Repository getter 读取。
- [x] 每组完成后运行定向契约测试、`node --test gateway`、`node --check` 和 `git diff --check`；最终 Gateway 全量为 `572/572`。

### 代码闭合结论（2026-08-24）

- HTTP REST 业务分支已从 `gateway/index.mjs` 完整迁出，组合根只组装依赖、认证策略、路由列表和 Server 生命周期。
- 路由工厂通过 `getFocusedSessionId()` 运行时读取聚焦会话，避免切换会话后捕获旧状态。
- `gateway/http/request-handler.test.mjs` 覆盖认证先行、Adapter 越权、CORS preflight 和稳定 404。
- 代码层门禁已完成；剩余工作属于真实 Desktop、Provider、IM、数据库备份恢复和 SDK resume 验收，不得用单元测试替代。
