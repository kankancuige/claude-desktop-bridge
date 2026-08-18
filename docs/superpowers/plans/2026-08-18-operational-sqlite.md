# Operational SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 IM inbox/outbox、消息去重和可重建会话/Memory 索引迁移到 Bridge 私有 SQLite，同时保留 JSON/JSONL 兼容和可回滚路径。

**Architecture:** Gateway 在 `BRIDGE_HOME/bridge-state.db` 使用一个 SQLite 文件。Claude transcript、Session Event Journal、Rules、Skills、MCP 和 Provider 配置不迁移。IM 状态通过仓储接口双读/惰性导入，数据库不可用时继续使用现有文件实现并发出可观测告警。

**Tech Stack:** Node.js ESM、Electron 42 内置 `node:sqlite`、Node 20 optional `better-sqlite3`、SQLite WAL、Node test runner、现有 Pino logger。

## Global Constraints

- SQLite 文件只能位于 `BRIDGE_HOME`，不得读取或写入 `~/.claude`、`~/.codex`。
- 所有 IM payload 继续通过现有 `SecurePayloadCodec` 编码，数据库不得保存明文消息、凭据或 token。
- 不删除旧 JSON/JSONL；旧格式必须可读，迁移失败可回退。
- 单 Gateway 是当前并发模型；禁止把 SQLite 当作多用户服务端数据库。
- 每个数据库查询使用参数化语句；状态变更使用短事务。

### Task 1: SQLite state store

**Files:**
- Create: `gateway/storage/bridge-state-db.mjs`
- Test: `gateway/storage/bridge-state-db.test.mjs`
- Modify: `gateway/package.json`
- Modify: `gateway/package-lock.json`

- [x] 覆盖 schema、WAL、状态唯一键、Memory/会话索引更新和 clean close。
- [ ] 实现前的 red gate 无可追溯输出，本计划不事后伪造失败测试证据。
- [x] 实现内置/optional SQLite 驱动加载、schema version、`busy_timeout`、WAL 和参数化仓储。
- [x] 实现明确的 `sqlite | unavailable` 存储状态，由调用方映射到 file fallback，并提供 health 与 `close()`。
- [x] Node 20 与 Electron 42 定向测试均为 6/6。

### Task 2: IM inbox/outbox adapters

**Files:**
- Modify: `gateway/im/im-inbox.mjs`
- Modify: `gateway/im/notification-outbox.mjs`
- Modify: `gateway/im/wechat.mjs`
- Modify: `gateway/im/feishu.mjs`
- Modify: `gateway/im/dingtalk.mjs`
- Modify: `gateway/index.mjs`
- Test: existing `gateway/im/im-inbox.test.mjs` and `gateway/im/notification-outbox.test.mjs`

- [x] Add optional `stateStore` repository interfaces while preserving current file constructor behavior.
- [x] Wire one shared state store from `bootGateway` to all three adapters; pass platform-specific repositories through adapter options.
- [x] Import old platform JSON entries when SQLite has no entries; do not delete or rewrite the old file during migration.
- [x] Ensure `claim`, `complete`, `fail`, `due`, `retryFailed`, `discard` and `status` persist through short SQLite transactions.
- [x] Add tests for duplicate claims, state transitions, retry ordering, payload codec and file fallback.
- [x] Run all IM tests and Gateway module tests.

### Task 3: Session and Memory derived indexes

**Files:**
- Create: `gateway/storage/memory-index.mjs`
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/projects/project-transcript-location.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/storage/bridge-state-db.test.mjs`
- Test: `gateway/projects/project-transcript-location.test.mjs`
- Test: `gateway/context/memory-service.test.mjs`

- [x] Store only canonical session identity and transcript metadata; never copy transcript body.
- [x] Index Memory Markdown by path/hash/title/keywords/mtime/size and rebuild missing or stale rows from files.
- [x] Use the index for bounded candidate listing while retaining directory-scan fallback when the index is unavailable.
- [x] Test duplicate IDs, stale/deleted files, invalid inputs and project isolation.

### Task 4: Migration and observability

**Files:**
- Modify: `gateway/config/bridge-home.mjs`
- Modify: `gateway/index.mjs`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/target-design.md`
- Modify: `docs/architecture/migration-plan.md`

- [x] Add idempotent DB creation and migration status to startup logs without secrets.
- [x] Add `/api/health` fields `stateStoreMode`, `stateStoreSchemaVersion`, and `stateStoreDegraded`.
- [x] Add migration tests for missing DB, corrupted DB, old JSON import and fallback mode.
- [x] Run Gateway tests, MJS syntax checks, `git diff --check`, and desktop build.
- [ ] 使用隔离 `BRIDGE_HOME` 的 Gateway runtime smoke 与真实微信/飞书/钉钉端到端验收尚未执行。

## Acceptance

- IM duplicate delivery and retry behavior remains unchanged or more deterministic after restart.
- A corrupted/unavailable SQLite file does not silently lose queued notifications; user-visible health reports degraded file mode.
- Existing JSON/JSONL transcript and configuration paths remain readable and unchanged.
- Rebuilding indexes produces the same session and Memory candidate set as a clean directory scan.
