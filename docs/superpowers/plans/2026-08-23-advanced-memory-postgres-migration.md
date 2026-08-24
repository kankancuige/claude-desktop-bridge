# Advanced Memory PostgreSQL Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有结构化运行态统一迁移到本机 PostgreSQL，并在 pgvector 与 embedding 验收后启用语义 Memory；PostgreSQL-only 代码闭合后再进行真实环境验收。

**Architecture:** PostgreSQL 成为任务状态、会话索引、IM 队列、Workbench 投影、Memory 元数据/embedding、Pitfall、执行报告、验证活动和 model usage 的唯一结构化主库。Markdown 仍是用户可编辑的 Rules、Skills 和 Memory 正文事实源，JSONL 仍是 SDK transcript/审计归档；业务代码通过统一 `StorageGateway` 访问存储。迁移先导入/双写/影子校验，再切换运行时；任何失败先回到 SQLite 备份快照，不把 SQLite 继续作为正常运行时 fallback。

**Tech Stack:** PostgreSQL 17.11、Node.js ESM、现有 `BridgeMemoryService`、`pg` 驱动、pgvector、Markdown Memory 文件；SQLite 仅作为只读迁移备份。

## 2026-08-23 执行结果

- [x] `StorageGateway` 已成为结构化运行态唯一入口，`PostgresStateCompat` 接通 Session、IM、Task/Workflow、Workbench、Pitfall、报告、验证和 usage。
- [x] Gateway 启动必须连接 PostgreSQL；SQLite runtime 不再创建、打开或回退。IM 空表不回读旧 JSON，Memory 运行时读取 PostgreSQL 正文。
- [x] PostgreSQL acceptance、Gateway cold start/restart、554 项项目测试和 `git diff --check` 已通过。
- [ ] 真实 embedding endpoint、真实 Provider/IM 送达和 pg_dump 恢复演练仍需外部环境证据，未虚报为完成。

## Global Constraints

- 不把 Provider 配置、MCP、Hooks 或凭据写入 PostgreSQL；用户可编辑的 Rules、Skills、Memory Markdown 和 SDK 所需 JSONL 归档可由 StorageGateway 以版本化内容记录保存，但业务层不得绕过入口直接操作文件或数据库。
- PostgreSQL 主库必须显式配置并通过启动健康检查；迁移完成前 SQLite 作为只读备份和可回滚快照，不能与 PostgreSQL 并列写入事实源。
- 所有 PostgreSQL SQL 使用参数绑定；连接必须设置 3 秒连接超时和可取消的查询超时。
- 迁移必须可重复、可中断、可回滚；不删除 Markdown 或 SQLite 索引，直到影子校验和恢复演练通过。
- 不记录密码、Markdown/JSONL 正文、embedding 向量或绝对工作目录到日志；正文可以作为受控内容记录保存到 PostgreSQL，但日志只记录 hash 和计数。
- 当前本机 PostgreSQL 17.11 已安装在 `D:\ckd\DB\PostgreSQL\17`，服务为 `postgresql-x64-17`，但 `vector` 扩展尚未安装。
- JSONL transcript 不在本次删除范围；删除它会破坏 SDK 会话身份和恢复链路。

---

### Task 1: 统一 StorageGateway 与 PostgreSQL 主库连接

**Files:**
- Create: `gateway/storage/storage-gateway.mjs`
- Create: `gateway/storage/storage-gateway.test.mjs`
- Create: `gateway/storage/postgres-store.mjs`
- Create: `gateway/storage/postgres-store.test.mjs`
- Modify: `gateway/context/memory-backend.mjs`
- Create: `gateway/context/memory-postgres-config.mjs`
- Create: `gateway/context/memory-postgres-config.test.mjs`
- Modify: `gateway/package.json`
- Modify: `gateway/.env.example`

**Interfaces:**
- `readMemoryPostgresConfig(env) -> {enabled, connectionString, schema, statementTimeoutMs, mode}`。
- `createStorageGateway({postgresConfig, logger}) -> {mode, db, transaction, health, close}`。
- `PostgresStore` 提供当前 `BridgeStateDb` 等价的结构化方法，业务层不再直接访问 `.db` 或 SQLite SQL。
- `createMemoryBackend({storageGateway, postgresConfig, backendName, logger})` 返回 `mode`, `effectiveMode`, `health`, `search`, `upsert`, `disable`, `remove`, `close`；主库不可用时返回明确启动错误，不静默降级为另一个事实源。

- [ ] **Step 1: 写失败测试**：覆盖 PostgreSQL 主库连接、参数化查询、事务回滚、连接超时、密码不进入日志和主库不可用时阻止启动。
- [ ] **Step 2: 运行测试确认失败**：`node --test gateway/storage/storage-gateway.test.mjs gateway/storage/postgres-store.test.mjs gateway/context/memory-postgres-config.test.mjs`。
- [ ] **Step 3: 添加 `pg` 运行依赖并实现配置解析/连接池**：连接配置通过环境变量读取，设置 `connectionTimeoutMillis=3000` 和单语句超时；不写入源码或 `.env` 示例真实密码。
- [ ] **Step 4: 实现 StorageGateway**：先提供 state entry、session、memory、task、workflow、pitfall、report、verification、usage 的统一接口，禁止新调用方依赖 SQLite `.db`。
- [ ] **Step 5: 运行测试与语法检查**：同上测试和 `node --check gateway/storage/storage-gateway.mjs`。

### Task 2: 全结构化状态 PostgreSQL schema 与 pgvector capability gate

**Files:**
- Create: `gateway/storage/migrations/001_bridge_structured_state.sql`
- Create: `gateway/storage/postgres-schema.mjs`
- Create: `gateway/storage/postgres-schema.test.mjs`
- Modify: `docs/architecture/decisions/0013-optional-postgres-pgvector-memory.md`

**Interfaces:**
- `ensureMemoryPostgresSchema(client, {schema, vectorDimensions}) -> {schema, vectorEnabled, migrationVersion}`。
- 先按现有 `bridge-state-db.mjs` 的表契约创建结构化表，迁移版本与唯一键保持兼容；表 `memory_documents` 的唯一键为 `(project_key, source_path, content_hash)`；`embedding vector(n)` 只有检测到扩展后创建。

- [ ] **Step 1: 写失败测试**：无 `vector` 扩展时返回 `vectorEnabled=false` 且不创建假向量列；重复执行 migration 不报错；未知 schema 版本拒绝继续。
- [ ] **Step 2: 运行测试确认失败**：`node --test gateway/context/memory-postgres-schema.test.mjs`。
- [ ] **Step 3: 实现参数化 schema migration**：先检测 `pg_extension`，再创建 schema、表、索引和迁移版本表；不使用 `CREATE EXTENSION` 自动联网或改变服务器插件目录。SQLite 原表只用于导入，不再作为运行时 schema。
- [ ] **Step 4: 运行真实本机 PostgreSQL 验证**：使用 `psql` 执行只读 capability probe 和 migration dry-run；`vector` 缺失时验收结果必须是 `blocked_extension`。

### Task 3: SQLite 一次性导入与只读备份

**Files:**
- Create: `gateway/storage/sqlite-export.mjs`
- Create: `gateway/storage/postgres-import.mjs`
- Create: `gateway/storage/storage-migration.test.mjs`
- Modify: `gateway/index.mjs`
- Modify: `gateway/context/memory-service.mjs`

**Interfaces:**
- `exportSqliteState({sqlitePath, outputPath}) -> {schemaVersion, tables, rows, checksum}`。
- `importStructuredState({exportData, storageGateway, signal}) -> {tables, inserted, skipped, failed, checksum}`。
- 导入完成后 SQLite 文件改为只读备份；运行时入口只创建 PostgreSQL StorageGateway。

- [ ] **Step 1: 写失败测试**：所有现有表可以导出/导入；重复导入幂等；校验和不一致停止切换；SQLite 备份可恢复。
- [ ] **Step 2: 运行测试确认失败**：`node --test gateway/storage/storage-migration.test.mjs`。
- [ ] **Step 3: 实现一次性迁移工具**：按表、批次和事务导入，保留源 SQLite 文件和 manifest；不把 SQLite 与 PostgreSQL 持续双写。
- [ ] **Step 4: 修改启动 wiring**：PostgreSQL 健康检查和 schema 版本通过后使用 StorageGateway；失败时明确报错并提示恢复 SQLite 备份，不静默选择第二事实源。
- [ ] **Step 5: 运行导入回归与 `git diff --check`**。

### Task 4: Memory embedding provider、回填与项目级语义切换

**Files:**
- Create: `gateway/context/embedding-provider.mjs`
- Create: `gateway/context/embedding-provider.test.mjs`
- Create: `gateway/context/memory-migration.mjs`
- Create: `gateway/context/memory-migration.test.mjs`
- Modify: `gateway/index.mjs`
- Modify: `gateway/.env.example`

**Interfaces:**
- `createEmbeddingProvider({name, dimensions, endpoint, apiKey, fetchImpl}) -> {name, dimensions, embed, health, close}`。
- `migrateMemoryProject({memoryService, workDir, encodedDir, mode, dryRun, signal}) -> {scanned, eligible, upserted, skipped, failed, rollbackToken}`。

- [ ] **Step 1: 写失败测试**：未配置 provider、维度不匹配、超时、429/5xx、取消信号和重复 content hash 都不能切换为语义模式；API key 不出现在错误对象或日志。
- [ ] **Step 2: 运行测试确认失败**：`node --test gateway/context/embedding-provider.test.mjs gateway/context/memory-migration.test.mjs`。
- [ ] **Step 3: 实现 provider 与 dry-run/backfill**：默认无 provider；回填按项目、批次和 signal 取消，保留 PostgreSQL 关键词基线并生成失败计数。
- [ ] **Step 4: 加入项目级开关**：只有 `health.vectorEnabled=true`、embedding 维度一致、影子召回通过阈值且用户显式启用时，才把 `effectiveMode` 切换为 `postgres-pgvector`。
- [ ] **Step 5: 运行定向测试和 Gateway 语法检查**：`node --test gateway/context/*memory*.test.mjs` 与 `node --check gateway/index.mjs`。

### Task 5: 全结构化状态真实验收、备份恢复与回滚门禁

**Files:**
- Create: `gateway/smoke/postgres-memory-acceptance.mjs`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `docs/architecture/migration-plan.md`
- Modify: `docs/architecture/current-state.md`

- [ ] **Step 1: 执行本机 capability 验收**：服务重启后 `pg_isready`、参数化登录、schema 版本、扩展状态和查询超时均有脱敏证据。
- [ ] **Step 2: 执行结构化状态导入**：任务、会话索引、IM inbox/outbox、Workbench、Memory、Pitfall、报告、验证和 usage 完成行数/校验和核对；重复导入幂等。
- [ ] **Step 3: 执行备份恢复演练**：`pg_dump` 仅备份 Memory schema，恢复到临时数据库并验证 Markdown/SQLite 仍可独立召回；失败时执行 rollback token，关闭 feature flag。
- [ ] **Step 4: 只有 PostgreSQL 主库冷启动、重启、断线恢复、事务回滚和真实 vector + embedding + 召回质量证据齐全后更新验收矩阵为 passed**；否则保持 `partially verified`/`blocked_extension`，不删除 SQLite 备份。

## 验收门槛

- PostgreSQL 连接失败、vector 缺失、embedding provider 超时或删除传播失败时，迁移工具必须停止切换并恢复 SQLite 备份；不允许应用同时维护两个结构化事实源。
- PostgreSQL 中不存在 prompt、凭据、完整 transcript、完整 Memory 正文和绝对路径。
- 同一 `content_hash` 回填幂等；禁用和删除不会删除 Markdown 正文；重启后状态可恢复。
- 未测到真实 PostgreSQL 主库恢复、结构化状态校验、embedding 召回质量、备份恢复和回滚前，不删除 SQLite 备份或宣称迁移完成。

## 2026-08-23 执行进度补充

- Task 2 已补齐：`ensurePostgresSchema()` 检测 `vector` 扩展，并在受限维度配置下创建 `memory_embeddings.embedding vector(n)`；本机真实结果为 `vector 0.8.6`、`vector(1536)`。
- Task 4 已补齐 provider 和向量仓储的代码契约：`embedding-provider.mjs` 支持 endpoint、model、维度校验、timeout、AbortSignal、429/HTTP 错误和脱敏错误；`PostgresContentStore` 支持向量幂等写入、`<=>` 相似召回和删除。
- 真实本机已执行 1536 维向量写入、相似度查询和删除传播，结果 `similarity=1`；Gateway 全量测试由 544 项增加为 549 项，全部通过。
- 仍未完成：真实 embedding endpoint 配置与批量回填、语义召回质量评测，以及任务/Session/IM/Workbench 全结构化状态从 SQLite 到 PostgreSQL 的运行时切换。
- Coordinator 迁移已开始：`PostgresStateStore.recordTaskTransition()` 使用短事务、行锁和 revision 幂等；`coordinator-persistence.mjs` 以串行异步队列写入脱敏影子投影，SQLite/journal 仍保持当前主链。真实 task state/event 写入验证通过，全量 Gateway 测试 `552/552` 通过。
