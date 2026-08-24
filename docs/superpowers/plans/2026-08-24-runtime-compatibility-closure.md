# Runtime Compatibility Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除生产运行时对 `stateStore`、Workflow 全局 `setDeps` 和 IM 文件持久化分支的依赖，使所有结构化状态通过明确的 Repository/Runtime port 进入 PostgreSQL。

**Architecture:** PostgreSQL `StorageGateway` 继续是唯一结构化事实源。Memory、Workflow、IM Inbox/Outbox 只接收各自领域 port；兼容适配器只允许存在于启动组合根和测试 fixture，不向业务 Runtime 暴露。同步 UI 路径统一改为基于内存快照或异步 port 的显式适配，不恢复 SQLite 或 JSON 状态 fallback。

**Tech Stack:** Node.js ESM、PostgreSQL/pg、Node test runner、Vue 3/Vite。

## Global Constraints

- 不恢复 SQLite，不新增数据库依赖，不改变 HTTP/WebSocket/IM 公开协议。
- 不执行 `git reset`、`git checkout`、清理 dirty worktree、commit 或 push。
- 所有 SQL 继续通过 `StorageGateway` 参数化执行；不在业务层拼接 SQL。
- 旧 JSON/JSONL 仅保留 Claude SDK transcript、用户可编辑 Markdown 或迁移输入，不作为结构化运行态 fallback。
- 兼容层只能位于 `startup-runtime.mjs`、`storage/` adapter 和测试 fixture；业务 Runtime 不得引用 `stateStore`。

---

### Task 1: Memory Repository-only Runtime

**Files:**
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/context/memory-admin.mjs`
- Modify: `gateway/storage/repositories/memory-repository.mjs`
- Modify: `gateway/runtime/startup-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Create: `gateway/context/memory-repository-wiring.test.mjs`

**Interfaces:**
- `BridgeMemoryService({bridgeHome, memoryRepository, ...})` requires `memoryRepository` and no longer accepts `stateStore`.
- `MemoryRepository` exposes `list`, `get`, `put`, `disable`, `remove`, `markUsed`, `putEmbedding`, `searchSimilar`, `removeEmbedding`.
- Memory admin functions use `memoryService` async methods for refresh/list/update and do not read a state adapter.

- [x] Add a wiring test that rejects construction without `memoryRepository` and proves no production Memory module references `stateStore`.
- [x] Move sync index reads/writes to repository methods and make the service's public sync methods use a bounded in-memory snapshot supplied by the repository adapter.
- [x] Add `markUsed` to `MemoryRepository` and wire PostgreSQL content metadata update through the existing content store.
- [x] Change startup and composition-root wiring to pass `storageGateway.repositories.memory` only.
- [x] Run Memory tests and PostgreSQL content/repository contract tests.

### Task 2: Workflow Instance-only Runtime

**Files:**
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/http/workflow-routes.mjs`
- Modify: `gateway/workflows/workflow-run-state.test.mjs`
- Create: `gateway/workflows/workflow-instance-wiring.test.mjs`

**Interfaces:**
- `createWorkflowRuntime(deps)` is the only supported public runtime entry.
- Persistence resolves only `deps.workflowRepository`; no `stateStore` fallback and no module-level mutable dependency slot.

- [x] Add a failing static test that production Workflow code contains neither `setDeps` nor `stateStore`.
- [x] Remove `_deps`, `activeDeps` fallback and exported `setDeps`; make each runtime call execute under its factory's `AsyncLocalStorage` context.
- [x] Update legacy unit tests to create an isolated Workflow Runtime instead of mutating module globals.
- [x] Verify two runtime instances remain dependency-isolated across async calls and persistence failures.

### Task 3: IM Inbox/Outbox Repository-only Persistence

**Files:**
- Modify: `gateway/im/im-inbox.mjs`
- Modify: `gateway/im/notification-outbox.mjs`
- Modify: `gateway/im/wechat.mjs`
- Modify: `gateway/im/feishu.mjs`
- Modify: `gateway/im/dingtalk.mjs`
- Modify: `gateway/runtime/im-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Create: `gateway/im/im-repository-wiring.test.mjs`

**Interfaces:**
- `ImInbox` and `NotificationOutbox` require a repository with their existing durable methods.
- Platform adapters receive `repository` only; `stateStore`, legacy inbox files and legacy outbox files are removed from runtime construction.

- [x] Add failing wiring assertions for missing Repository and production references to `stateStore` in IM modules.
- [x] Remove file and `stateStore` branches while preserving PostgreSQL empty-table semantics, dedupe, retry, capacity and rollback behavior.
- [x] Update all three adapters and IM Runtime construction to pass explicit IM and Notification Repository ports.
- [x] Run platform adapter, inbox/outbox, notification worker and IM lifecycle tests.

### Task 4: Composition Root Gate and Documentation

**Files:**
- Modify: `gateway/runtime/composition-root-wiring.test.mjs`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/migration-plan.md`
- Modify: `TASK_STATE.md`

- [x] Expand static gates to scan all production Runtime, Context, HTTP and IM modules, excluding only `storage/` adapters and test fixtures.
- [x] Assert `gateway/index.mjs` remains a pure startup entry and `gateway-runtime-impl.mjs` exposes only composition dependencies.
- [x] Record compatibility removal, rollback boundary and remaining external runtime gates accurately.
- [x] Run syntax checks, `node --test gateway`, `pnpm exec vue-tsc --noEmit`, `pnpm exec vite build` and `git diff --check`.

## Verification Matrix

| Gate | Evidence |
|---|---|
| Memory port | Memory service/admin tests, PostgreSQL content repository tests, static no-`stateStore` scan |
| Workflow instance | Workflow runtime isolation and persistence tests, static no-`setDeps` scan |
| IM port | Inbox/Outbox/adapter lifecycle tests, empty-table and rollback assertions |
| Whole Gateway | `node --test gateway` with zero failed/skipped tests |
| Desktop | `vue-tsc`, Vite production build |
| External | Real Provider/IM, PostgreSQL outage/recovery, Electron packaging remain separate acceptance gates |
