# Session Refresh And Message Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止项目扫描误隔离主会话，并让刷新后的项目、会话、思考摘要、Agent 宠物提示和附件发送状态保持可见。

**Architecture:** Gateway 的项目查询必须是只读操作，transcript 分类采用“只有明确 `isSidechain:true` 才是子 Agent，未知文件按主会话保留”的 fail-open 策略。前端只持久化可序列化的项目与标签描述，WebSocket 和运行时对象不持久化；恢复时重新走现有 session API。Codex relay 将 Responses reasoning summary 映射为 Anthropic thinking block，现有 Workspace 继续消费统一事件。

**Tech Stack:** Node.js ESM、`node:test`、Claude Agent SDK、Vue 3 Composition API、TypeScript、Vite、浏览器 `localStorage`。

## Global Constraints

- 不新增或升级依赖，不改变 IM 注入与通知公开契约。
- 保留现有 dirty worktree，只修改与本故障直接相关的文件。
- 不在 GET `/api/projects` 或 GET session 列表中执行删除、重命名或恢复操作。
- 不自动恢复用户主动删除的 `.trash`；运行数据恢复只针对本次 `1786348789` 批次且必须先确认无目标文件冲突。
- 官方 OpenAI 文档当前受 `403/Cloudflare` 阻断，reasoning SSE 先按本机协议代码可兼容字段实现并保留真实中转 runtime 验证项。
- 不提交、不推送、不重启 Gateway；这些操作需要用户另行明确授权。

---

### Task 1: Transcript 分类与只读扫描保护

**Files:**
- Create: `gateway/transcript-classifier.mjs`
- Create: `gateway/transcript-classifier.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Produces: `classifyTranscriptFile(filePath): 'main' | 'agent' | 'unknown'`。
- Consumes: Claude JSONL 的 `isSidechain`、`sessionId` 字段；`agentId` 仅作诊断信息，不单独判定子 Agent。

- [ ] **Step 1: 写失败测试**

  覆盖主会话包含 `isSidechain:false + agentId`、明确 `isSidechain:true` 子 Agent、无标记旧 transcript、截断 JSON 行。

- [ ] **Step 2: 运行测试确认失败**

  Run: `node --test gateway/transcript-classifier.test.mjs`

- [ ] **Step 3: 实现最小分类器**

  扫描有限头部；`isSidechain:false` 返回 `main`，只有明确 `isSidechain:true` 返回 `agent`，其余返回 `unknown`。

- [ ] **Step 4: 移除查询路径副作用**

  `scanProjects()` 与 `listProjectSessions()` 只过滤明确 Agent；未知 UUID 保留为会话。删除 session 仍只通过现有显式 DELETE 路径执行。

- [ ] **Step 5: 运行分类器和 Gateway 回归测试**

  Run: `node --test gateway/transcript-classifier.test.mjs gateway/*.test.mjs`

### Task 2: 项目与会话刷新恢复

**Files:**
- Create: `desktop-ui/src/workspace-persistence.ts`
- Create: `desktop-ui/src/workspace-persistence.test.ts`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Produces: `loadWorkspaceShell()`、`saveWorkspaceShell()`，只保存手动项目、tab 的 `projectPath/label/sessionId` 和 `activeTabId`。
- Consumes: `loadProjects()` 返回的 Gateway 项目，以及现有 `handleNewSession()`/`switchToTab()`。

- [ ] **Step 1: 写序列化边界测试**

  确认 WebSocket、`File`、Promise、消息正文和 token 不进入持久化数据；坏 JSON 返回空状态。

- [ ] **Step 2: 运行测试确认失败**

  Run: `pnpm exec tsx src/workspace-persistence.test.ts`（若项目无 `tsx`，改用 Vite/TypeScript 可执行的纯模块检查，不安装依赖）。

- [ ] **Step 3: 持久化手动项目与 tab shell**

  `addProject()`、tab 创建/切换/关闭、session 创建成功后防抖保存；刷新时先加载 Gateway 项目，再合并本地空项目和恢复 tab 描述。

- [ ] **Step 4: 恢复当前会话**

  Gateway 运行时 session 存在时恢复连接；不存在时保留项目与历史会话入口，不把整个项目清空。

- [ ] **Step 5: TypeScript 与 Vite 验证**

  Run: `pnpm exec vue-tsc --noEmit`
  Run: `pnpm exec vite build`

### Task 3: 附件气泡可见性

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Produces: 用户消息上的可序列化 `attachments` 展示元数据：`name`、`size`、`type`、`uploadedPath`、`status`。
- Consumes: 现有 `uploadAttachment()` 和 `doSend()` 成功结果。

- [ ] **Step 1: 建立失败断言**

  发送带附件消息时，用户 bubble 必须同时包含原文和附件名；只有上传成功且 WebSocket 接受 payload 后才显示“已发送”。

- [ ] **Step 2: 将附件元数据写入用户消息**

  不把 `File` 或 `dataUrl` 写入持久化状态；失败时附件留在输入区并显示现有失败提示。

- [ ] **Step 3: 渲染附件行**

  在用户 bubble 内以紧凑文件行显示名称、大小和已发送状态，沿用现有 UI 色彩与圆角，不新增卡片嵌套。

- [ ] **Step 4: 构建验证**

  Run: `pnpm exec vue-tsc --noEmit`
  Run: `pnpm exec vite build`

### Task 4: Agent 生命周期与宠物提示

**Files:**
- Create: `gateway/agent-tool-lifecycle.mjs`
- Create: `gateway/agent-tool-lifecycle.test.mjs`
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Produces: `Agent` 与 legacy `Task` 统一产生 `subagent_spawning`，`Workflow` 保持原事件。
- Consumes: SDK `SubagentStart`/`SubagentStop` hooks 和前端 `syncPetState()`。

- [ ] **Step 1: 写工具名兼容测试**

  验证 `Agent`、`Task` 都识别为子 Agent，`Workflow` 独立识别，普通工具不误判。

- [ ] **Step 2: 修复 permission mode 分支顺序**

  子 Agent 生命周期广播先于 `bypassPermissions` 快速允许，避免跳过交互提示；权限结果仍保持自动允许。

- [ ] **Step 3: 为生命周期事件同步宠物**

  spawning/start 显示任务描述，done 在仍有其他 Agent 时保持忙碌，全部完成后进入完成提示。

- [ ] **Step 4: 运行 Gateway 测试和 UI 构建**

  Run: `node --test gateway/agent-tool-lifecycle.test.mjs gateway/*.test.mjs`
  Run: `pnpm exec vite build`

### Task 5: Codex reasoning summary 转换

**Files:**
- Modify: `gateway/codex-relay-protocol.mjs`
- Modify: `gateway/codex-relay-protocol.test.mjs`

**Interfaces:**
- Produces: Responses reasoning summary JSON/SSE 转为 Anthropic `thinking` content block 与 `thinking_delta`。
- Consumes: `response.reasoning_summary_text.delta`、reasoning output item summary；未知事件继续忽略。

- [ ] **Step 1: 写 reasoning JSON/SSE 失败测试**

  断言 summary 文本不会混入最终 answer，但会产生 `thinking`/`thinking_delta`；完成时每个 block 只关闭一次。

- [ ] **Step 2: 实现 JSON 与 SSE 映射**

  reasoning block 使用独立 index/key，避免与 `output_text`、function call 冲突。

- [ ] **Step 3: 运行 relay 回归测试**

  Run: `node --test gateway/codex-relay-protocol.test.mjs gateway/codex-relay-proxy.test.mjs`

### Task 6: 证据门禁与数据恢复准备

**Files:**
- Modify: none（运行验证与只读清点；恢复操作另行明确记录）。

**Interfaces:**
- Consumes: Task 1-5 的测试/build 输出和 `.trash-1786348789*.jsonl` 清点。
- Produces: 可恢复数量、冲突数量、未验证 runtime 项。

- [ ] **Step 1: 全量静态门禁**

  Run: `node --check gateway/index.mjs`
  Run: `node --test gateway/*.test.mjs`
  Run: `pnpm exec vue-tsc --noEmit`
  Run: `pnpm exec vite build`
  Run: `git diff --check`

- [ ] **Step 2: 只读确认恢复集合**

  精确统计 `1786348789` 批次、`isSidechain:false`、目标 `.jsonl` 不存在的文件，遇到任一冲突就不覆盖。

- [ ] **Step 3: 标记 runtime blocker**

  未经授权不重启 Gateway；因此项目列表恢复、真实 AICodeMirror reasoning SSE 和桌面刷新 smoke test 在重启前不得声称通过。
