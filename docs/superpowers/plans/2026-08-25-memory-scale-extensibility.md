# Memory Scale Extensibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本地 Memory 预留可扩展的主题层级、摘要回填和规模策略，同时保持当前关键词召回默认行为不变。

**Architecture:** 复用 PostgreSQL `content_documents.metadata JSONB` 保存 `schemaVersion`、`memoryType`、`parentKey`、`l0`、`l1` 和生成器版本，不新增破坏性表迁移。MemoryRepository 暴露层级读取接口；离线回填由显式调用的可取消批处理模块负责；规模策略只返回策略建议，不在当前版本自动切换召回路径。

**Tech Stack:** Node.js ESM、PostgreSQL、参数化 SQL、Node `node:test`。

## Global Constraints

- PostgreSQL 是唯一结构化运行态事实源；不恢复 SQLite 或 JSON fallback。
- 默认 Memory 召回仍使用当前关键词路径；分层策略不会静默改变用户上下文。
- 所有 SQL 参数化、分页有界、支持 keyset cursor。
- 摘要回填不得保存凭据、token、完整 transcript 或绝对路径。
- 不新增第三方依赖，不执行 commit/push。

---

### Task 1: Memory 分层元数据契约

**Files:**
- Create: `gateway/context/memory-layer.mjs`
- Create: `gateway/context/memory-layer.test.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/context/memory-candidate.mjs`

**Interfaces:**
- `normalizeMemoryMetadata(metadata, body) -> object`
- `memoryTier(row, requestedTier = 'auto') -> 'l0'|'l1'|'l2'`
- `MemoryService.put` 与候选审批统一写入 `schemaVersion: 1` 和默认 `memoryType`。

- [x] 写测试覆盖默认字段、保留用户字段、摘要长度边界和候选写入。
- [x] 实现纯函数契约，不改变正文内容。
- [x] 将 Memory Service 文件同步和候选审批的 metadata 统一经过契约。
- [x] 运行 `node --test gateway/context/memory-layer.test.mjs gateway/context/memory-candidate.test.mjs gateway/context/memory-service.test.mjs`。

### Task 2: Repository 层级查询接口

**Files:**
- Modify: `gateway/storage/repositories/memory-repository.mjs`
- Modify: `gateway/storage/postgres-content-store.mjs`
- Modify: `gateway/storage/postgres-content-store.test.mjs`
- Create: `gateway/storage/repositories/memory-repository.test.mjs`

**Interfaces:**
- `MemoryRepository.listChildren({projectKey, parentKey, status, limit, after})`
- `MemoryRepository.load({projectKey, sourceKey, tier})`
- `PostgresContentStore.listChildren` 和 `load` 使用参数化、有限结果。

- [x] 先写 SQL 参数和结果契约失败测试。
- [x] 增加 `metadata->>'parentKey'` 子级过滤和 `load` 层级选择。
- [x] 对 `l0/l1` 缺失回退正文，保持旧记录可读。
- [x] 运行存储定向测试和 SQL 语法检查。

### Task 3: 可取消离线摘要回填

**Files:**
- Create: `gateway/context/memory-layer-backfill.mjs`
- Create: `gateway/context/memory-layer-backfill.test.mjs`

**Interfaces:**
- `runMemoryLayerBackfill({memoryRepository, projectKey, summarize, batchSize, checkpoint, signal, dryRun}) -> Promise<{status, scanned, updated, skipped, failed, nextCheckpoint, failures}>`
- `summarize({body, row}) -> {l0, l1, memoryType, parentKey}`；无 summarizer 时使用保守的确定性摘要，不调用外部模型。

- [x] 写测试覆盖 dry-run、幂等 hash、批次、取消、失败 checkpoint 和摘要脱敏。
- [x] 实现 keyset 分页、单批更新、失败不推进游标。
- [x] 通过 Repository `put` 更新 metadata，不直接访问 SQL。
- [x] 运行回填定向测试。

### Task 4: 规模/质量策略

**Files:**
- Create: `gateway/context/memory-scale-policy.mjs`
- Create: `gateway/context/memory-scale-policy.test.mjs`
- Modify: `gateway/context/memory-service.mjs`

**Interfaces:**
- `decideMemoryScalePolicy({count, keywordRecall, injectionBytes, thresholds}) -> {mode, reason, shouldBackfill, shouldUseHierarchy}`
- 默认阈值：`flat < 100`、`summary 100..499`、`hierarchical >= 500`；任何明确质量低于阈值时提前建议升级。

- [x] 写边界和质量门禁测试。
- [x] 将策略作为 Memory Service 的诊断结果暴露，不改变默认召回。
- [x] 运行策略和 Memory Service 回归测试。

### Task 5: 文档与验收

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/memory-product-comparison.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`

- [x] 记录当前默认扁平召回、预留 metadata、回填命令级 API 和启用阈值。
- [x] 明确 embedding 与 L0/L1/L2 都是按数据/质量门禁触发的可选能力。
- [x] 运行 `git diff --check`。
- [x] 运行 Gateway 全量测试、语法检查和相关 smoke；不把未配置真实 embedding 说成已验收。
