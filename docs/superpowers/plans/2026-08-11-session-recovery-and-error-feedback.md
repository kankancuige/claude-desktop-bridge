# Session Recovery And Error Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use verification-before-completion for final gates. This plan is executed inline because the user already authorized implementation; commit/push remain prohibited without separate authorization.

**Goal:** 让暂停或异常中断的会话在关闭项目/应用后恢复正文和用户草稿，并让 API、WebSocket、存储和 resume 失败都有一致的用户提示。

**Architecture:** Claude SDK JSONL 保持正文事实源；新增有界 session draft store。Gateway 对 resume/stop 提供明确合约；共享 fetch 层只上报共性传输错误，页面处理业务错误。

**Tech Stack:** Electron、Vue 3、TypeScript、Node.js ESM、Claude Agent SDK、node:test、localStorage。

## Global Constraints

- 不新增或升级依赖，不提交、不推送、不重启外部服务。
- 保留 dirty worktree 和 IM 注入/完成通知契约。
- 不保存 API Key、token、File 对象、权限输入或完整 Vue 运行态。

### Task 1: 纯函数失败用例

**Files:**
- Create: `desktop-ui/src/session-drafts.ts`
- Create: `desktop-ui/src/session-drafts.test.mjs`
- Create: `desktop-ui/src/bridge-errors.ts`
- Create: `desktop-ui/src/bridge-errors.test.mjs`
- Create: `gateway/session-resume.mjs`
- Create: `gateway/session-resume.test.mjs`

- [ ] 写 draft 损坏 JSON、过期、限长、按 session 隔离、accepted 清除测试。
- [ ] 写 network/timeout/auth/429/5xx 分类、脱敏、dedupe key 测试。
- [ ] 写 resume 映射、SDK ID transcript、缺失 transcript 决策测试。
- [ ] 运行上述测试，确认实现前失败、实现后通过。

### Task 2: Gateway 恢复与停止合约

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/session-stop.mjs`
- Modify: `gateway/session-stop.test.mjs`

- [ ] `POST /api/sessions` 使用 resume 决策；缺失返回 `404 SESSION_RESUME_NOT_FOUND`。
- [ ] 成功响应使用真实 `Boolean(resumeSid)`，返回 `historySessionId`。
- [ ] 新增幂等 `POST /api/sessions/:id/stop`，保留 WS stop 兼容。
- [ ] stop 返回 `stopped/resumable/historySessionId`，异常返回稳定 code。

### Task 3: 全局错误事件与跨路由通知

**Files:**
- Modify: `desktop-ui/src/api.ts`
- Modify: `desktop-ui/src/App.vue`
- Modify: `desktop-ui/src/components/GlobalToast.vue`
- Modify: `desktop-ui/src/i18n.ts`

- [ ] fetch 最终失败时分发脱敏 `BridgeNotice`，认证刷新成功不提示。
- [ ] 对重复后台错误限频；任一后续 Gateway 成功请求分发恢复事件。
- [ ] App 显示可关闭的错误/恢复通知，卸载时移除 listener。

### Task 4: 会话草稿和恢复接线

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/workspace-persistence.ts`
- Modify: `desktop-ui/src/workspace-persistence.test.mjs`

- [ ] `cancelTask` 等待 stop API 结果，成功后回填并立即保存草稿。
- [ ] send 之前保存原文，`message_accepted/message_duplicate` 后清除。
- [ ] 打开历史会话时恢复 draft 并显示“任务已中断，可重新发送/继续”。
- [ ] 关闭运行中 tab 先确定性停止；关闭只移除 tab，不删除 transcript/draft。
- [ ] `loadHistory`、workspace 保存/读取失败显示错误，非 2xx 不伪装成功。

### Task 5: 设置页和连接失败提示

**Files:**
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

- [ ] 设置读取失败保留 error state 和重试入口，不装入可保存的伪默认值。
- [ ] WebSocket 首次断开、重连成功、达到上限分别提示且去重。
- [ ] 用户触发的保存、恢复、测试连接显示服务端稳定错误；后台轮询只在连续失败后提示。

### Task 6: 验证

- [ ] `node --test gateway/*.test.mjs`
- [ ] `node --test desktop-ui/src/*.test.mjs`
- [ ] `pnpm exec vue-tsc --noEmit`
- [ ] `pnpm exec vite build`
- [ ] `node --check gateway/index.mjs`
- [ ] `git diff --check`
- [ ] 在不泄露密钥的前提下执行 resume/stop/API failure runtime smoke；无法启动服务时明确标记 blocker。
