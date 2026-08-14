# 任务可靠性闭环完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善当前桌面端与微信、飞书、钉钉一对一消息桥接的任务终态、恢复、通知和附件闭环。

**Architecture:** 以 Gateway 的任务生命周期聚合为唯一业务状态来源，使用持久化终态记录和有限事件重放向桌面及 IM 提供相同结果。IM 适配器只负责平台接入和送达，不再把一次进程内等待作为任务生命周期；附件以 Session/消息引用管理，Provider 和凭据处理保持现有 Claude SDK 契约。

**Tech Stack:** Node.js ESM Gateway、Electron/Vue 3、Claude Agent SDK、JSONL sidecar journal、Node test runner。

## Global Constraints

- 保留现有 dirty worktree，不覆盖无关改动。
- 只支持单用户一对一 IM 绑定，不新增群聊、多租户、云协作或远程 Worktree。
- 不新增依赖，不升级 Claude SDK 或 Electron。
- API key 不写入日志；持久化凭据优先使用 Electron `safeStorage`，不可用时必须明确降级。
- 网络和平台发送必须有 timeout、指数退避和可恢复失败状态。
- 所有终态必须区分 `succeeded`、`failed`、`stopped`、`interrupted`、`notification_pending`、`sent`、`dead`。
- 修改后运行相关 Node 单测、桌面端类型检查和生产构建；没有真实 IM 凭据时明确标记 runtime blocker。

### Task 1: 持久化任务最终回复和事件恢复

**Files:**
- Modify: `gateway/task-state.mjs`, `gateway/session-event-journal.mjs`, `gateway/index.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`, `gateway/im-task-runner.mjs`
- Test: `gateway/task-state.test.mjs`, `gateway/session-event-journal.test.mjs`, `gateway/im-task-runner.test.mjs`, `desktop-ui/src/task-lifecycle.test.mjs`

**Interfaces:**
- `taskState.finalReplyText` 保存脱敏后的最终回复摘要，`taskState.finalReplyAvailable` 表示是否存在可恢复正文。
- `task_completed`、`task_failed`、`task_review_paused`、`generation_stopped` 携带稳定 `taskId`、单调 `sequence`、`reply` 和 `taskState`。
- WebSocket 初始快照携带最近终态；重复事件按 `taskId + sequence` 去重。

- [ ] **Step 1: 写失败测试**：构造任务完成事件后模拟桌面先收到 `result`、后收到 `task_completed`，断言最终气泡使用 `reply`；模拟只收到 `task_completed`，断言仍显示详细回复；模拟 IM 只收到终态事件，断言 `runImTask` 使用 `event.reply`。
- [ ] **Step 2: 运行失败测试**：`node --test gateway/task-state.test.mjs gateway/im-task-runner.test.mjs gateway/session-event-journal.test.mjs`，预期新增断言失败。
- [ ] **Step 3: 实现**：在任务状态和关键事件中保存长度受限的最终回复；桌面端以 `taskId/sequence` 合并结果并从终态事件兜底；IM runner 优先使用 `event.reply`；事件 journal 只保存回复摘要及引用，不保存 token、凭据或完整工具输出。
- [ ] **Step 4: 运行通过测试**：重复运行上述测试，并运行 `git diff --check`。

### Task 2: 统一通知投影和 IM 重启补发

**Files:**
- Modify: `gateway/task-completion.mjs`, `gateway/index.mjs`, `gateway/notification-outbox.mjs`, `gateway/notification-worker.mjs`
- Modify: `gateway/wechat.mjs`, `gateway/feishu.mjs`, `gateway/dingtalk.mjs`, `gateway/im-inbox.mjs`
- Test: `gateway/task-completion.test.mjs`, `gateway/notification-outbox.test.mjs`, `gateway/im-inbox.test.mjs`, `gateway/im-task-runner.test.mjs`

**Interfaces:**
- `taskState.notifications[platform]` 统一表示 `pending/sent/failed/dead`、`notificationId`、`lastError`、`updatedAt`。
- `NotificationOutbox` 成功送达前不得把任务通知标记为 sent；适配器重启时可按 `notificationId` 幂等补发。
- `runImTask` 超时只结束等待器，不结束 Gateway 任务；最终任务事件由 outbox 负责补发。

- [ ] **Step 1: 写失败测试**：模拟平台发送失败后断言任务仍为 `notification_pending/failed`；模拟适配器重启后恢复同一 `notificationId`；模拟 IM 等待超时后任务完成，断言最终通知仍进入 outbox。
- [ ] **Step 2: 运行失败测试**：执行四个相关测试文件，确认新断言先失败。
- [ ] **Step 3: 实现**：将每个平台通知状态纳入任务终态；发送结果成功后再推进状态；失败保留 outbox；适配器启动恢复未完成通知；停止/超时/重启均产生可查询终态。
- [ ] **Step 4: 运行通过测试**：执行 Gateway 相关测试和 `node --check`。

### Task 3: 权限确认持久化与重连恢复

**Files:**
- Modify: `gateway/pending-confirm.mjs`, `gateway/index.mjs`, `gateway/session-event-journal.mjs`, `gateway/session-runtime-state.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: `gateway/pending-confirm.test.mjs`, `gateway/session-runtime-state.test.mjs`, `desktop-ui/src/task-lifecycle.test.mjs`

**Interfaces:**
- 生命周期快照新增 `pendingConfirmations`，每项包含 `requestId/type/toolName/turnId/source/userId/expiresAt`，不包含完整敏感输入。
- 重连后客户端按 `requestId` 恢复确认弹窗；已解决或过期请求不得重复显示。

- [ ] **Step 1: 写失败测试**：构造 pending confirmation 后生成快照，断言包含请求摘要；模拟重连和重复 confirmation event，断言只显示一个待确认项。
- [ ] **Step 2: 运行失败测试**：执行 pending-confirm、runtime-state 和桌面生命周期测试。
- [ ] **Step 3: 实现**：将确认摘要写入 session sidecar/journal，Gateway 重启后恢复未过期请求；桌面端维护按 tab 的 pending confirmation 集合，前台切换时恢复弹窗和提示标记。
- [ ] **Step 4: 运行通过测试**：重复测试并执行 Vue 类型检查。

### Task 4: 附件 manifest、历史展示和安全回收

**Files:**
- Modify: `gateway/upload-storage.mjs`, `gateway/index.mjs`, `gateway/session-history.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: `gateway/upload-storage.test.mjs`, `gateway/session-history.test.mjs`, `gateway/attachment-type.test.mjs`

**Interfaces:**
- 附件记录以 `sessionId/messageId/attachmentId` 关联，保存 `name/kind/contentType/path/status/createdAt`。
- 历史 API 返回附件元数据；删除 Session 只删除没有其他消息引用的附件。

- [ ] **Step 1: 写失败测试**：两个 Session 共享项目目录时删除其中一个，断言另一个附件仍存在；历史解析断言 Word/PDF/图片类型和发送状态可恢复。
- [ ] **Step 2: 运行失败测试**：执行 upload-storage、session-history 和 attachment-type 测试。
- [ ] **Step 3: 实现**：为附件写 manifest，上传目录按 Session 或引用计数回收；历史解析保留附件元数据；失败、重试、过期状态在 UI 中可见。
- [ ] **Step 4: 运行通过测试**：执行相关测试、`git diff --check` 和桌面构建。

### Task 5: Session 映射、Provider 和运维闭环

**Files:**
- Modify: `gateway/session-background-init.mjs`, `gateway/index.mjs`, `gateway/provider-registry.mjs`, `gateway/deepseek-proxy.mjs`, `gateway/opencode-proxy.mjs`
- Modify: `gateway/bridge-provider-settings.mjs`, `desktop-ui/electron/main.cjs`
- Test: `gateway/session-resume.test.mjs`, `gateway/session-background-init.test.mjs`, `gateway/provider-wiring.test.mjs`, new provider retry tests

**Interfaces:**
- 快照、checkpoint、task-state 使用稳定 SDK conversation ID，同时保留 Gateway ID 别名。
- Provider 统一返回 `retryable/status/requestId/attempts`，由任务层决定是否降级，不跨任务隐式切换模型。

- [ ] **Step 1: 写失败测试**：删除反向映射后恢复 SDK transcript，断言仍能加载原 snapshot/checkpoints；Provider 代理对 429/5xx/网络超时按统一规则返回可重试信息；Electron 日志超过阈值后滚动。
- [ ] **Step 2: 运行失败测试**：执行 session-resume、background-init、provider 相关测试。
- [ ] **Step 3: 实现**：按 SDK ID 查找 sidecar 别名；统一代理重试和健康状态；将 Provider key 交给安全存储；Electron 日志增加大小/天数保留。
- [ ] **Step 4: 运行通过测试**：运行 Gateway 全测试、桌面 `vue-tsc`、Vite production build，并标记真实 Provider/IM runtime 验收项。

## 验收矩阵

- [ ] Gateway 在 `task/accepted` 后强制退出，重启后可恢复正文并继续执行。
- [ ] result 到终态之间断开 WebSocket，重连后能看到详细最终回复且不重复。
- [ ] 审查通过、审查阻断、用户停止、Provider 失败都能在桌面和对应 IM 收到准确终态。
- [ ] IM 适配器重启后，未送达通知只补发一次。
- [ ] Gateway/桌面切换标签页，权限确认入口仍存在且只处理一次。
- [ ] 同一项目两个 Session 的附件互不误删，重启后历史气泡显示类型和状态。
- [ ] SDK transcript 仍存在但 Gateway 映射损坏时，diff/checkpoint 可恢复。
- [ ] 真实微信、飞书、钉钉、Provider 429/401/断网和强制崩溃 smoke test 另行授权后执行。
