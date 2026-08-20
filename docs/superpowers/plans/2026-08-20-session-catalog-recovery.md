# Session Catalog Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从现有 Claude JSONL transcript 重建 SQLite 会话目录，并让桌面端准确区分可恢复的旧会话、不可恢复的空壳会话和临时 Gateway 故障。

**Architecture:** JSONL 继续拥有对话正文，SQLite 只保存可重建的会话索引和运行状态。Gateway 按 transcript 内的真实 `cwd` 将 canonical 与旧编码目录聚合，只恢复 `main` transcript；桌面端把 runtime 404 与网络/5xx 分开处理。

**Tech Stack:** Node.js ESM、SQLite、Vue 3、TypeScript、Node test runner。

## Global Constraints

- 不移动、删除或复制现有 transcript 正文。
- 只显示输入框或 IM 创建的主会话，继续过滤 Agent、Workflow 和审查内部会话。
- SQLite 不可用时保留现有文件系统回退。
- 保留用户已有 dirty worktree，不提交、不推送、不重启外部服务。

---

### Task 1: Legacy Transcript Repair

**Files:**
- Modify: `gateway/sessions/session-catalog.mjs`
- Modify: `gateway/sessions/session-catalog.test.mjs`

**Interfaces:**
- Consumes: `classifyTranscriptFile(path)`、visibility sidecar、SQLite session index。
- Produces: `reconcileSessionCatalog({ projectKey, projectDirs, workDir, visibility, ... })` 返回去重后的可见主会话。

- [ ] **Step 1: Write the failing tests**

覆盖空的 version-1 visibility 能修复主 transcript、继续过滤 Agent transcript、多个 physical directory 合并为同一 canonical project key、正文不进入 SQLite。

- [ ] **Step 2: Run tests and confirm the old behavior fails**

Run: `node --test gateway/sessions/session-catalog.test.mjs`

- [ ] **Step 3: Implement the minimal repair**

扫描同一 `cwd` 的 transcript 目录；既有 visibility 和 SQLite visible 记录优先，只有 legacy repair 分支可用 `kind === 'main'` 补建 `desktop` 可见索引。

- [ ] **Step 4: Run the focused tests**

Run: `node --test gateway/sessions/session-catalog.test.mjs`

### Task 2: Canonical Project Aggregation

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/sessions/session-catalog.test.mjs`

**Interfaces:**
- Consumes: transcript 首部 `cwd`、`encodeProjectName(workDir)`、canonical/legacy sidecar。
- Produces: `scanProjects()` 和 `listProjectSessions()` 使用相同 canonical key 和 physical directory 集合。

- [ ] **Step 1: Add the canonical/legacy regression fixture**

构造 canonical 目录保存 sidecar、旧编码目录保存 transcript，断言只返回一个项目且路径仍指向旧文件。

- [ ] **Step 2: Implement grouping and visibility merge**

按规范化 `cwd` 分组，合并 sidecar 后只写 canonical SQLite `project_key`；迁移修复版本升级为 2，空的 version-1 结果不再永久阻断修复。

- [ ] **Step 3: Run focused Gateway tests**

Run: `node --test gateway/sessions/session-catalog.test.mjs gateway/projects/*.test.mjs`

### Task 3: Desktop Runtime Recovery State

**Files:**
- Modify: `desktop-ui/src/session-selection.ts`
- Modify: `desktop-ui/src/session-selection.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: `/api/sessions/:id/exists` HTTP status、`historySessionId`、当前 tab identity。
- Produces: `existing | recoverable-missing | unrecoverable-missing | unavailable | invalid` 的恢复决策。

- [ ] **Step 1: Write decision-table tests**

覆盖 200/404/5xx、存在或缺失 SDK history ID、畸形 200，以及 await 期间切换 tab 的身份保护。

- [ ] **Step 2: Implement and integrate the recovery decision**

404 且有 history ID 时重建 Gateway runtime；404 且无 history ID 时清除失效 UUID、停止重试并提示重新发送；网络/5xx 才保留 UUID并调度重连。

- [ ] **Step 3: Run desktop unit tests and typecheck**

Run: `node --test desktop-ui/src/*.test.mjs`

Run: `pnpm exec vue-tsc --noEmit`

### Task 4: Verification And Read-only Data Audit

**Files:**
- Verify only: `gateway/**/*.mjs`
- Verify only: `desktop-ui/src/**/*`
- Verify only: `C:\Users\CKD\.claude-desktop-bridge`

**Interfaces:**
- Consumes: existing test suites and current persisted Bridge home.
- Produces: test/build evidence and a read-only expected migration report.

- [ ] **Step 1: Run Gateway and Desktop tests**

Run the repository's full Node test commands and require zero failures or skipped required tests.

- [ ] **Step 2: Run static/build gates**

Run Vue typecheck, Vite build, MJS syntax checks, and `git diff --check`.

- [ ] **Step 3: Audit current persisted data without restarting Gateway**

Dry-run the repaired reconciliation against `BRIDGE_HOME`; report canonical project count, visible main-session count, filtered Agent count, and any ambiguous/malformed transcripts. Do not mutate the running application's files.
