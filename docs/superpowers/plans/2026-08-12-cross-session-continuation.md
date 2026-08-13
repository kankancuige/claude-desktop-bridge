# Cross-Session Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让恢复会话立即固化 SDK 身份，并为同项目提供显式分支和只在引用性短句触发的有界跨会话接力。

**Architecture:** Claude SDK transcript 仍是唯一正文事实源。Gateway 新增纯函数模块识别引用短句、选择最近有效主 transcript 并构建最大 6 KB 的上下文；`POST /api/sessions` 新增兼容的 `forkFrom` 字段，桌面侧栏提供分支按钮。

**Tech Stack:** Node.js 20、Claude Agent SDK 0.3.x、Electron、Vue 3、TypeScript、Node test runner。

## Global Constraints

- 不新增依赖，不改写或自动删除现有 transcript。
- 普通空白新会话不得注入旧任务。
- 所有恢复和分支错误必须显式返回，不得降级为空白会话。
- 保留 dirty worktree 中的既有改动，不提交、不推送、不重启外部服务。

---

### Task 1: 会话创建契约

**Files:**
- Create: `gateway/session-create-mode.mjs`
- Create: `gateway/session-create-mode.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `resume?: string`、`forkFrom?: string`。
- Produces: `resolveSessionCreateMode(body)` 与互斥、必填校验结果。

- [ ] 写入失败测试：空白、resume、fork 三种模式及 `resume + forkFrom` 冲突。
- [ ] 运行 `node --test gateway/session-create-mode.test.mjs`，确认因模块缺失失败。
- [ ] 实现纯函数并接入 POST 参数校验。
- [ ] 重跑定向测试，确认通过。

### Task 2: 恢复身份与 SDK 分支

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/session-resume.test.mjs`

**Interfaces:**
- Consumes: 已校验的 resume/fork source SDK ID。
- Produces: runtime `lastSessionId/_hasConversation`、同步 session map、fork 响应元数据。

- [ ] 增加恢复 runtime 在 `system/init` 前已有 SDK identity 的失败用例。
- [ ] 接入 SDK `forkSession(source, {dir: workDir})`，失败返回稳定错误码。
- [ ] 创建 runtime 时立即绑定并持久化 `resumeSid`，保留 `system/init` 校正。
- [ ] 运行 Gateway 定向测试。

### Task 3: 按需接力上下文

**Files:**
- Create: `gateway/project-continuation-context.mjs`
- Create: `gateway/project-continuation-context.test.mjs`
- Modify: `gateway/project-transcript-location.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `text`、`hasUserTurns`、项目路径、当前 SDK ID、本地 transcript。
- Produces: `buildProjectContinuationContext(...) -> {sourceSessionId, text} | null`。

- [ ] 写入失败测试：引用短句命中、普通问题不命中、断裂会话排除、agent 排除、长度上限。
- [ ] 运行定向测试并确认失败。
- [ ] 实现候选解析和选择；注入内容使用现有 `===== 用户消息 =====` 边界，历史 UI 只显示原文。
- [ ] 接入 live query 和 lazy rebuild 两条发送路径。
- [ ] 运行定向与 Gateway 全量测试。

### Task 4: 桌面端显式分支

**Files:**
- Modify: `desktop-ui/src/components/SidebarLeft.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/i18n.ts`
- Create: `desktop-ui/src/session-create-mode.ts`
- Create: `desktop-ui/src/session-create-mode.test.mjs`

**Interfaces:**
- Consumes: 项目路径、encodedDir、源 SDK conversation ID。
- Produces: `forkSession` emit 和 `POST /api/sessions {forkFrom}`，响应绑定新 SDK ID。

- [ ] 写入请求体和 tab 选择失败测试，保证 fork 不复用源 tab。
- [ ] 增加会话行分支图标按钮和中英文 tooltip。
- [ ] fork 成功后加载新 transcript、连接新 Gateway runtime 并刷新项目列表。
- [ ] 运行 Desktop 单元测试和 `vue-tsc --noEmit`。

### Task 5: 回归验证

**Files:**
- Modify: `docs/architecture/current-state.md`（仅当实现与文档出现差异）

**Interfaces:**
- Consumes: Tasks 1-4 的实现。
- Produces: 可复核的静态、测试和构建证据。

- [ ] 运行 Gateway 全量测试和 `node --check gateway/index.mjs`。
- [ ] 运行 Desktop 全量测试、`vue-tsc --noEmit` 和 Vite production build。
- [ ] 运行 `git diff --check`，检查新增文件与用户既有改动没有冲突。
- [ ] 不重启当前 Gateway；明确标注真实 SDK fork/runtime smoke 尚待下次授权重启后验证。
