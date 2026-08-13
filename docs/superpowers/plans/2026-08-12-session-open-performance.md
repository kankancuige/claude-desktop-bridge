# 会话打开性能修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除中文项目和旧 transcript 目录并存时的首次空加载、重复恢复和错误 Gateway Session 复用，让历史会话一次点击即可恢复。

**Architecture:** Claude SDK JSONL 仍是会话正文唯一事实源，不迁移或删除现有文件。Gateway 为每条会话返回其真实 `encodedDir`，历史读取先解析安全 URL 段并优先读取指定目录，缺失时按全局唯一 session ID 兼容查找旧目录；前端按会话级目录打开，并拒绝把绑定其他 SDK conversation 的 Gateway Session 复用到当前 tab。

**Tech Stack:** Node.js ESM、`node:test`、Vue 3、TypeScript、Electron、Claude SDK JSONL

## Global Constraints

- 不新增依赖，不修改或删除现有 `~/.claude/projects` JSONL。
- 保留当前 dirty worktree 中的已有改动。
- transcript 缺失必须返回明确错误，不能伪装成成功的空历史。
- 项目和会话接口必须拒绝目录穿越与非法 session 文件名。

---

### Task 1: Gateway transcript 定位契约

**Files:**
- Create: `gateway/project-transcript-location.mjs`
- Create: `gateway/project-transcript-location.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `claudeHome`、HTTP 路径中的 `encodedDir`、SDK `sessionId`。
- Produces: `decodeProjectDirectorySegment(value)` 与 `findSessionTranscript({claudeHome, encodedDir, sessionId})`。

- [ ] **Step 1: 写失败测试**

覆盖 Unicode URL 解码、非法目录段、指定目录命中、指定目录缺失后按 session ID 查找旧目录、完全缺失。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test gateway/project-transcript-location.test.mjs`

- [ ] **Step 3: 实现最小定位模块并接入 Gateway**

`GET /api/projects/:encodedDir/sessions/:sessionId/messages` 在命中时返回消息，缺失时返回 `404 HISTORY_NOT_FOUND`，读取失败返回 `500 HISTORY_READ_FAILED`。`scanProjects()` 给每条 session 增加真实 `encodedDir`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test gateway/project-transcript-location.test.mjs gateway/session-history.test.mjs`

### Task 2: 前端会话级目录与运行态一致性

**Files:**
- Modify: `desktop-ui/src/components/types.ts`
- Modify: `desktop-ui/src/components/SidebarLeft.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/session-selection.ts`
- Modify: `desktop-ui/src/session-selection.test.mjs`

**Interfaces:**
- Consumes: `Project.sessions[].encodedDir` 和 `/exists` 返回的 `historySessionId`。
- Produces: 侧栏点击传递会话真实目录；`runtimeSessionMatchesHistory(requested, actual)` 防止跨 conversation 复用。

- [ ] **Step 1: 写失败测试**

覆盖请求和运行态 history ID 一致、冲突、运行态尚未获得 SDK ID 三种情况。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test desktop-ui/src/session-selection.test.mjs`

- [ ] **Step 3: 接入前端**

侧栏优先发送 `session.encodedDir`；恢复 tab 时若 Gateway Session 绑定了不同 history ID，则关闭错误 WebSocket 引用并按原 history ID 恢复，不能覆盖用户选择。

- [ ] **Step 4: 运行测试和类型检查**

Run: `node --test desktop-ui/src/session-selection.test.mjs`

Run: `pnpm exec vue-tsc --noEmit`

### Task 3: 回归验证

**Files:**
- Verify only

**Interfaces:**
- Consumes: Task 1 和 Task 2 的完整改动。
- Produces: 静态、测试和构建证据。

- [ ] **Step 1: 运行 Gateway 全量测试**

Run: `npm test`

- [ ] **Step 2: 运行前端单元测试和构建**

Run: `pnpm test`

Run: `pnpm build`

- [ ] **Step 3: 检查改动边界**

Run: `git diff --check`

- [ ] **Step 4: 记录 runtime 验收边界**

不重启当前 Gateway；代码验证完成后，真实桌面端一次点击恢复仍需在应用下次启动新版本后复测日志，验收目标是一次历史 GET、无 `ENOENT`、无跨 history Gateway Session 复用。
