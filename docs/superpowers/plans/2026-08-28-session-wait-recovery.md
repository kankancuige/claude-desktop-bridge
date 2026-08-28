# Session Wait Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复方案确认后 Provider 不继续、工具活动无限续期和前端误报“正在继续执行”的会话卡死问题。

**Architecture:** 默认执行链使用 Agent SDK 自带且版本配套的 Claude Code；只有用户显式配置时才覆盖。确认结算更新工具活动边界，watchdog 依据最近 SDK/工具进度的真实空闲时长收口，不再仅凭活动 Map 是否非空无限续期。桌面端只展示已经观察到的事实。

**Tech Stack:** Node.js ESM、Claude Agent SDK 0.3.243、Claude Code 2.1.243、Vue 3、TypeScript、Node test runner。

## Global Constraints

- 保留当前 dirty worktree，不覆盖无关改动。
- 不新增或升级依赖，不改变 WebSocket 消息结构。
- 不启动或终止外部服务，不执行 commit 或 push。
- Provider 空闲、工具空闲、确认等待和绝对时限必须分别可验证。
- 真实 Electron/Provider 验收需要当前开发实例重启后单独执行。

---

### Task 1: SDK 与 CLI 版本配套

**Files:**
- Modify: `gateway/runtime/claude-executable-runtime.mjs`
- Test: `gateway/runtime/claude-executable-runtime.test.mjs`

**Interfaces:**
- Consumes: `CLAUDE_EXE`、系统设置 `claudeExe`、SDK 默认 executable 解析。
- Produces: `getClaudeExe()` 优先返回显式配置；未配置时返回 SDK 包内同版本 native binary。

- [x] 写失败测试：存在旧版自动发现目录时，未显式配置仍优先返回 SDK 配套 executable。
- [x] 运行定向测试，确认旧实现错误返回用户目录旧版 executable。
- [x] 保留环境变量和系统设置的显式覆盖，默认路径优先选择 SDK 配套 binary。
- [x] 运行定向测试并核验本机 SDK `0.3.243` 配套 Claude Code `2.1.243`。

### Task 2: 确认结算后的工具活动边界

**Files:**
- Modify: `gateway/sessions/session-tool-activity.mjs`
- Modify: `gateway/runtime/confirmation-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Test: `gateway/sessions/session-tool-activity.test.mjs`
- Test: `gateway/runtime/confirmation-runtime.test.mjs`

**Interfaces:**
- Consumes: confirmation entry 的 `type`、`toolUseId` 和结算时间。
- Produces: `settleSessionToolConfirmation(session, entry, timestamp)`；choice 清除 `AskUserQuestion` 活动，permission 刷新真实工具的最近进度。

- [x] 写失败测试：choice 结算后活动 Map 不再包含 AskUserQuestion；permission 允许后只刷新对应工具。
- [x] 运行定向测试，证明旧结算不会更新活动边界。
- [x] 在幂等结算成功后调用工具活动结算函数，并记录最近 SDK/控制事件时间。
- [x] 验证重复、超时和另一通道结算不会重复改变状态。

### Task 3: 基于真实空闲时间的 watchdog

**Files:**
- Modify: `gateway/runtime/session-input-runtime.mjs`
- Test: `gateway/runtime/session-input-runtime.test.mjs`

**Interfaces:**
- Consumes: `_lastSdkEventAt`、活动工具 `lastProgressAt`、pending confirmation、任务开始时间和三个 timeout 配置。
- Produces: 动态剩余等待时间；无进度达到阈值时发出 `stream_idle_timeout` 并进入可恢复失败态。

- [x] 写失败测试：活动工具超过 `toolIdleTimeoutMs` 必须失败，不能因为 Map 非空再次续期。
- [x] 写边界测试：工具进度只延长到 `lastProgressAt + toolIdleTimeoutMs`；Provider 事件只延长普通空闲窗口；pending confirmation 由自身超时负责。
- [x] 运行失败测试并记录旧实现的无限续期行为。
- [x] 按当前状态计算最近活动时间和剩余窗口，保留绝对时限优先级。
- [x] 运行全部 session input 与 tool activity 测试。

### Task 4: 事实型状态文案与回归门禁

**Files:**
- Modify: `desktop-ui/src/task-activity.ts`
- Modify: `desktop-ui/src/task-activity.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `docs/architecture/adr-task-pause-resume.md`

**Interfaces:**
- Consumes: `confirmation_response`、`confirmation_resolved`、后续 `stream_waiting`/SDK 事件。
- Produces: “确认已提交，等待 AI 返回进度”；只有收到后续事件才显示实际执行阶段。

- [x] 写失败测试：choice 结算后进入“等待 Provider 返回”，不得声称已经继续执行。
- [x] 修改 Vue 系统消息和 activity reducer 文案，保留权限工具的明确允许/拒绝状态。
- [x] 更新验收矩阵与 ADR，记录 CLI 配套、确认边界和 timeout 恢复策略。
- [x] 运行 Gateway 全量测试、Desktop 全量测试、`vue-tsc --noEmit` 和 Vite build。
- [ ] 运行 `git diff --check`，并在重启开发实例后完成真实 Electron/Provider 验收。
