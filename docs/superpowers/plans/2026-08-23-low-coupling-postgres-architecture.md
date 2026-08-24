# PostgreSQL 低耦合架构收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变桌面、WebSocket、IM 和 Claude SDK 公开契约的前提下，完成高级 Memory 回填门禁、PostgreSQL Repository 边界、组合根拆分和 transcript 物化恢复适配。

**Architecture:** `StorageGateway` 只负责连接、事务和 Repository 组装；`repositories/` 按内容、Memory、Session、Project、Workbench、Pitfall 和 IM 队列划分数据所有权。`index.mjs` 只保留配置、依赖注入、HTTP/WS 注册和进程生命周期；业务流程通过显式 port 调用 Repository，不直接依赖 `PostgresStateCompat`。兼容层只留在迁移期间的同步旧调用适配器，并以稳定错误码和指标暴露。

**Tech Stack:** Node.js ESM、PostgreSQL 17、pgvector、`pg`、Claude Agent SDK、Electron/Vue、Node test runner。

## Global Constraints

- PostgreSQL 是唯一结构化运行时入口；未配置、连接失败、超时或 schema 不兼容时明确失败，不创建第二事实源。
- 所有 SQL 参数化；查询必须有项目/会话过滤或有界 `LIMIT`，批量遍历使用 keyset cursor，不使用无界 `SELECT *`。
- embedding 回填支持 `dryRun`、批次、AbortSignal 取消、指数退避重试、失败记录和 checkpoint 恢复；取消不切换语义模式。
- Memory 只有在 embedding 维度、模型版本、失败率和召回质量门禁通过后才能按项目启用 pgvector；否则保持 PostgreSQL 关键词召回。
- JSONL transcript 仍必须提供 Claude SDK 需要的受控文件路径；数据库正文、文件物化和恢复必须有 hash/版本一致性校验。
- 每个任务完成独立的单元测试、故障路径测试、`node --check` 和 `git diff --check`；真实 Provider、IM 和 `pg_dump` 证据单独记录，不用 host test 替代。

---

### Task 1: Embedding 回填编排器

**Files:**
- Create: `gateway/context/memory-embedding-backfill.mjs`
- Create: `gateway/context/memory-embedding-backfill.test.mjs`
- Modify: `gateway/storage/postgres-content-store.mjs`
- Modify: `gateway/storage/postgres-content-store.test.mjs`

**Interfaces:**
- `runMemoryEmbeddingBackfill({contentStore, embeddingProvider, projectKey, embeddingModel, batchSize, dryRun, signal, checkpoint, retry}) -> Promise<{status, scanned, eligible, embedded, skipped, failed, cancelled, nextCheckpoint, failures}>`
- `contentStore.list({projectKey, kind:'memory', status:'active', limit, after})` 使用 `{updatedAt, sourceKey}` keyset cursor。
- `contentStore.getEmbedding({projectKey, sourceKey, bodyHash, embeddingModel})` 判断幂等跳过。

- [x] **Step 1: 写失败测试**：覆盖无 provider、dry-run 不调用 embedding、重复 hash 跳过、批次边界、AbortSignal 取消、429/5xx 重试耗尽和 checkpoint 续跑。
- [x] **Step 2: 运行定向测试确认失败**：`node --test gateway/context/memory-embedding-backfill.test.mjs`。
- [x] **Step 3: 增加 PostgreSQL keyset 列表和 embedding 查询**：按 `(updated_at, source_key)` 倒序分页，所有项目和状态条件参数化，新增 `getEmbedding`。
- [x] **Step 4: 实现回填状态机**：每个内容按 hash/model 幂等检查；dry-run 只统计；provider 调用传递 signal；可重试错误按 100/200/400ms 上限退避；失败写入有界 `failures`，不吞掉取消。
- [x] **Step 5: 运行测试与语法检查**：`node --test gateway/context/memory-embedding-backfill.test.mjs gateway/storage/postgres-content-store.test.mjs`；`node --check gateway/context/memory-embedding-backfill.mjs`。

### Task 2: 项目级语义 Memory 质量门禁

**Files:**
- Create: `gateway/context/memory-quality-gate.mjs`
- Create: `gateway/context/memory-quality-gate.test.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `evaluateMemoryQuality({keywordSearch, semanticSearch, cases, minRecall, minPrecision, maxRegression}) -> {passed, baseline, candidate, regressions, reasons}`。
- `enableMemorySemanticMode({projectKey, quality, vectorHealth, embeddingModel, dimensions}) -> {enabled, reason, version}`。

- [x] **Step 1: 写失败测试**：无 endpoint、维度不一致、召回低于阈值、关键词基线回归和项目未显式启用时均拒绝切换。
- [x] **Step 2: 实现固定评测集**：每个项目只保存脱敏 query/source key/期望命中，不保存 prompt 正文；计算 recall、precision 和回归数。
- [x] **Step 3: 将语义开关接入项目配置**：Memory 服务只读取已通过门禁的 project setting；失败时继续 PostgreSQL 关键词召回并返回 `semantic_disabled_reason`。
- [x] **Step 4: 运行定向 Memory 测试和 Gateway wiring 测试**。

### Task 3: Repository Ports 与 StorageGateway 组装

**Files:**
- Create: `gateway/storage/repositories/memory-repository.mjs`
- Create: `gateway/storage/repositories/session-repository.mjs`
- Create: `gateway/storage/repositories/project-repository.mjs`
- Create: `gateway/storage/repositories/workbench-repository.mjs`
- Create: `gateway/storage/repositories/pitfall-repository.mjs`
- Create: `gateway/storage/repositories/im-repository.mjs`
- Create: `gateway/storage/repositories/repository-contract.test.mjs`
- Modify: `gateway/storage/storage-gateway.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/context/pitfall-service.mjs`

**Interfaces:**
- `storageGateway.repositories.memory`: `list/get/put/disable/remove/putEmbedding/getEmbedding/searchSimilar`。
- `storageGateway.repositories.session`: `list/get/upsert/remove/updateSettings`。
- `storageGateway.repositories.project`: `listKeys/listTranscripts/reconcile`。
- `storageGateway.repositories.workbench`: `getTask/listTasks/upsertTask/listReports/listPitfalls`。
- `storageGateway.repositories.pitfall`: `recordOccurrence/findRelevant/updateStatus/link`。
- `storageGateway.repositories.im`: `loadEntries/replaceEntries/clearEntries/summarizeEntries`。

- [x] **Step 1: 为 Memory port 写契约测试**：只暴露本领域方法，禁止暴露 `.query`、`.client` 或兼容层内部 Map。
- [x] **Step 2: 用现有 `PostgresContentStore` 实现 Memory/Transcript Repository**：Repository 只做参数校验、字段映射和领域命名，不复制 SQL。
- [x] **Step 3: StorageGateway 构造时组装 Memory/Transcript repositories**：关闭时按依赖反向释放，连接失败只返回稳定 Storage 错误。
- [x] **Step 4: Memory 改为依赖领域 Repository**：Pitfall、Session、Project、Workbench、Workflow 和 IM 已接入领域 Repository；旧 `stateStore` 参数仅保留迁移兼容。
- [x] **Step 5: 运行 Memory Repository、Memory、StorageGateway 定向回归测试**。

### Task 4: Session/Project 与 HTTP Router 拆出组合根

**Files:**
- Create: `gateway/http/http-router.mjs`
- Create: `gateway/http/workbench-routes.mjs`
- Create: `gateway/http/session-routes.mjs`
- Create: `gateway/sessions/session-repository-service.mjs`
- Create: `gateway/projects/project-repository-service.mjs`
- Modify: `gateway/index.mjs`
- Create: matching tests for each module

**Interfaces:**
- `createHttpRouter({routes, auth, logger}) -> {handle(req,res)}`。
- `createSessionRepositoryService({repository, transcriptAdapter, visibility})`。
- `createProjectRepositoryService({repository, sessionService, projectContext})`。

- [x] **Step 1: 新增并接线独立的 `/api/health`、`/api/workbench/*` 查询 handler**：保留原状态码、鉴权、错误 JSON 和分页；旧分支暂留待契约回归后删除。
- [x] **Step 2: 把项目/会话列表、恢复、删除的 Repository 调用迁出**：项目/会话目录协调、索引读取、transcript 候选索引和 resume 恢复已优先使用 Session/Transcript Repository；文件系统仍是 SDK 受控正文路径。
- [ ] **Step 3: index 只注册 router 和依赖，运行 wiring tests 比较原始/新响应契约**。已迁出资源配置组 `gateway/http/resource-config-routes.mjs`（Skills、Skills Market、Caveman、RTK、Hooks、Rules、Agents），并补充模块契约测试；Session 创建/删除、文件操作、Workflow、IM、其余 Provider/MCP config 路由仍在逐组迁移，不能提前标记完成。
- [x] **Step 4: 每次迁移后执行全量 Gateway 测试，禁止一次性删除旧路由实现**：本轮 Session/Project Router 迁移后已执行全量回归。

### Task 5: Transcript 物化、恢复与一致性适配

**Files:**
- Create: `gateway/storage/repositories/transcript-repository.mjs`
- Create: `gateway/sessions/transcript-materializer.mjs`
- Create: matching tests and `gateway/smoke/postgres-transcript-recovery.mjs`
- Modify: `gateway/projects/project-transcript-location.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `materializeTranscript({repository, projectKey, sessionId, targetPath, expectedHash, signal}) -> {path, hash, bytes, version}`。
- `recoverTranscript({repository, projectKey, sessionId, sdkSessionId, workDir, signal}) -> {status, path, hash, source}`。

- [x] **Step 1: 先写 hash、版本、半写文件、取消和 SDK resume identity 测试**。
- [x] **Step 2: 使用临时文件 + 原子 rename 物化 JSONL，完成后校验 hash/size；失败清理临时文件。
- [x] **Step 3: 提供 Session resume 优先使用真实文件、缺失时从 PostgreSQL 版本化正文物化的适配器；Gateway 代码接线和全量 host 回归已通过。
- [ ] **Step 4: 执行重启、物化、恢复、正文变更和回滚 smoke；未通过前不删除现有 JSONL。已完成 PostgreSQL 恢复库的 transcript 物化、bytes/hash/version 校验；真实 Claude SDK `resume` 重启 E2E、正文变更后的旧 hash 拒绝和回滚路径仍未取得 Provider 运行证据，因此保留 JSONL。

### Task 6: PostgreSQL 故障、备份恢复和发布门禁

**Files:**
- Create: `gateway/smoke/postgres-failure-acceptance.mjs`
- Create: `gateway/smoke/postgres-backup-restore-acceptance.mjs`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/migration-plan.md`

- [x] **Step 1: 连接失败、statement timeout、事务回滚、断线重连、关闭 flush 均有自动化结果码。
- [x] **Step 2: `pg_dump`/临时库恢复校验 schema、行数、hash、embedding 维度和 transcript 物化恢复。** 2026-08-23 真实 PostgreSQL 17.11 验收通过；恢复前显式创建 `vector` 扩展，源/恢复库均为 `vector(1536)`，Memory 36、transcript 79，hash 一致，transcript `materialized/postgres`。
- [ ] **Step 3: 只有代码、runtime、备份恢复和真实 provider/IM 证据齐全才把对应验收项标为 passed。** 代码门禁、PostgreSQL runtime/failure、备份恢复已通过；真实 Provider/IM 证据沿用运行验收矩阵，SDK resume 重启 E2E 和 Router 全量拆分仍是未决项。

## 当前未决项

- 真实 embedding endpoint、召回评测数据集、阈值和项目启用策略需要在 Task 1/2 产出后确定。
- Claude SDK 是否允许所有 transcript 从数据库临时物化，需要以当前 SDK 版本的 resume 行为验收；在此之前保留 JSONL 文件事实源。
- `gateway/index.mjs` 拆分必须按路由组逐步迁移，不能用大范围机械移动替代行为测试。
- `pg_dump --schema bridge` 不包含 `public.vector` 扩展；恢复目标库必须先执行 `CREATE EXTENSION vector`，否则 `memory_embeddings.embedding` 无法建表。
- 2026-08-23 真实 Provider timeout 复验未重新取得 timeout 证据：当前 Provider 在测试延迟开关下仍产生正常 result，watchdog 正确忽略 `hasActiveWork=false`；该项保持 inconclusive，不修改生产 watchdog 或伪造通过。
