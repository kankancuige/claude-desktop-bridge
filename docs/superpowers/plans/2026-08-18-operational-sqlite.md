# 已废止：Operational SQLite Implementation Plan

> 2026-08-23 起不再执行。本项目已统一到 PostgreSQL；本文件仅保留历史实现记录。

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

## Next Phase: Durable Session and Task State

下一阶段在现有派生索引基础上继续扩大 SQLite 的职责，但不改变事实源边界：Claude SDK transcript、Memory/Rule/Skill/Agent/Workflow 定义文件和附件正文仍保留在文件系统；SQLite 只保存可查询的结构化状态、索引和投递状态。

### Task 5: Unified session catalog and per-session state

**Files:**
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/sessions/session-visibility.mjs`
- Modify: `gateway/sessions/session-mirror-state.mjs`
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: `gateway/storage/bridge-state-db.test.mjs`
- Test: `gateway/sessions/session-visibility.test.mjs`
- Test: `gateway/sessions/session-mirror-state.test.mjs`
- Test: `desktop-ui/src/bridge-errors.test.mjs` or a focused session-store test

**Interfaces:**
- Consumes: Existing `.jsonl` transcripts, `bridge-session-map.json`, `bridge-session-visibility.json`, `bridge-session-mirrors.json`, and existing `bridge_session_index` rows.
- Produces: A single SQLite session catalog keyed by `(project_key, session_id)` with `sdk_session_id`, `work_dir`, `source`, `visibility`, `title`, transcript path, mtime, size, last opened time, permission mode, mirror settings, and runtime/session revision metadata.
- Compatibility: JSON/JSONL files remain readable and are used for one-time import and degraded fallback. SQLite is the derived catalog, not the transcript body source.

- [x] **Step 1: Define the session catalog schema and migration contract.**

  Add only structured columns needed by the desktop workflow. Keep `(project_key, session_id)` unique, index `(project_key, visibility, mtime DESC)`, and make all optional session settings nullable with explicit defaults. Document which fields are authoritative in SQLite and which remain file-backed.

- [x] **Step 2: Add a read-only reconciliation test before changing runtime reads.**

  Build fixtures containing a main desktop session, an IM session, an Agent/Workflow transcript, a stale mapping, and a missing transcript. Assert that reconciliation returns only user-visible sessions and that the JSONL body is never copied into SQLite.

- [x] **Step 3: Implement idempotent import and incremental reconciliation.**

  Add repository methods with exact boundaries such as `upsertSessionCatalog(record)`, `listVisibleSessions(projectKey, limit)`, `getSessionCatalog(projectKey, sessionId)`, `updateSessionSettings(projectKey, sessionId, patch)`, and `removeSessionCatalog(projectKey, sessionId)`. Reconcile only changed files by mtime/size and remove stale derived rows without deleting transcript files.

- [x] **Step 4: Switch project/session listing to the catalog with bounded file fallback.**

  `GET /api/projects` and `GET /api/projects/:encodedDir/sessions` should read indexed metadata first, trigger a bounded reconciliation when the index is missing/stale, and fall back to the current scan if SQLite is unavailable. Do not scan every transcript head on every cold startup.

- [x] **Step 5: Persist session permissions, mirror switches, and last-opened state through the same catalog.**

  Update the Gateway session settings API and `WorkspaceView.vue` so refresh, tab switching, and restart read/write the same session record. UI localStorage may remain as a display cache, but it must not be the only source for permissions or IM synchronization state.

- [ ] **Step 6: Verify migration, restart, and degraded-mode behavior.**

  Run focused tests, `git diff --check`, a cold Gateway start with an isolated `BRIDGE_HOME`, and a desktop smoke check covering: old sessions visible, Agent/Workflow sessions hidden, new desktop session visible, IM session visible, permission persistence, mirror persistence, stale row cleanup, and SQLite-unavailable file fallback.

### Task 6: Durable task/workflow lifecycle and notification consistency

**Files:**
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/tasks/task-state.mjs`
- Modify: `gateway/tasks/task-lifecycle.mjs`
- Modify: `gateway/tasks/task-completion.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/sessions/session-event-journal.mjs`
- Modify: `gateway/im/im-inbox.mjs`
- Modify: `gateway/im/notification-outbox.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/tasks/task-state.test.mjs`
- Test: `gateway/tasks/task-lifecycle.test.mjs`
- Test: `gateway/tasks/task-completion.test.mjs`
- Test: `gateway/workflows/workflow-runner.test.mjs`
- Test: `gateway/im/sqlite-state-integration.test.mjs`

**Interfaces:**
- Consumes: Existing `bridge-task-state/*.json`, `bridge-session-events/*.jsonl`, `workflow-journals/*.json`, `bridge-workflow-history.jsonl`, and IM inbox/outbox state.
- Produces: SQLite task/workflow records keyed by task/session identity, including lifecycle state, current phase, turn count, model tier, review state, error code, timestamps, retry/continuation metadata, and notification delivery state.
- Invariant: A task is not reported as completed until the primary result and any required review gate are terminal; notification delivery is retryable and cannot erase the task result.

- [x] **Step 1: Map lifecycle states and define the transaction boundary.**

  Record the current state transitions from accepted, running, paused, waiting-for-permission, review-running, completed, failed, and stopped. Define which transition writes task state, event sequence, and notification outbox in one short SQLite transaction, without holding a transaction across an API call or user confirmation.

- [x] **Step 2: Add schema and tests for restart recovery and duplicate events.**

  Add task/workflow tables with unique task identity and monotonic event/revision fields. Test duplicate completion events, late review results, connection-closed continuation, process restart recovery, and a task that has completed locally while its IM notification is still pending.

- [x] **Step 3: Implement dual-read compatibility and controlled dual-write.**

  Load SQLite state first when available, import valid JSON/Journal state when a row is absent, and continue writing the existing JSON files during the compatibility window. Never delete or rewrite historical event bodies during import.

- [x] **Step 4: Close the primary-task/review/IM notification loop.**

  Make task completion, review outcome, and IM outbox enqueue use one authoritative completion decision. Terminal task state persists a deterministic per-platform notification intent; adapters enqueue before network delivery, workers write sent/failed/dead back to the task projection, and restart reconciliation recreates a missing outbox entry without duplicating an existing one. A review that finds no new issue must still settle the parent task; a failed or paused review must expose the continuation reason.

- [x] **Step 5: Add bounded cleanup and retention.**

  Retain recent terminal task records and notification delivery metadata for restart diagnostics, prune by age/count in a bounded maintenance job, and keep full transcript/event bodies in their existing files. Cleanup must be idempotent and must not remove records for active tasks.

- [ ] **Step 6: Verify end-to-end recovery and failure paths.**

  Gateway 370/370、Desktop 97/97、Vue 类型检查和 Vite 生产构建已通过。仍需执行隔离 Gateway runtime、桌面交互、强制中断恢复以及真实微信/飞书/钉钉端到端测试，确认 API 断流、审查恢复、通知重试和 elapsed/token 在 UI 与 IM 一致。

### Next-phase acceptance gates

- A cold startup can list indexed projects/sessions without reading every transcript head; a missing or stale index rebuilds incrementally.
- Restarting the Bridge preserves session visibility, permission mode, IM mirror switches, task phase, review state, and notification retry state.
- Agent, Workflow, and scheduled-task transcripts remain excluded from the desktop session list.
- JSON/JSONL transcript and event files remain readable after migration; deleting or rebuilding SQLite never deletes source content.
- A task cannot display “completed” while its required review is still running, and a notification failure does not lose the completed task result.
- SQLite failure produces an observable degraded file-backed mode rather than silent data loss.

## Acceptance

- IM duplicate delivery and retry behavior remains unchanged or more deterministic after restart.
- A corrupted/unavailable SQLite file does not silently lose queued notifications; user-visible health reports degraded file mode.
- Existing JSON/JSONL transcript and configuration paths remain readable and unchanged.
- Rebuilding indexes produces the same session and Memory candidate set as a clean directory scan.
