# Activity Bubbles And Session Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留底部当前任务总览，同时把执行步骤按事件追加为独立聊天气泡，并让权限模式按会话持久化、重启后恢复。

**Architecture:** `TaskActivityState` 继续作为底部总览的聚合状态；消息列表新增不可变的步骤消息，每个关键阶段事件只追加一次，不复用同一个实时更新气泡。权限模式由桌面端写入 Gateway 会话运行时和持久化会话状态，恢复会话时由服务端状态作为权威值返回，前端再恢复控件。

**Tech Stack:** Vue 3 + TypeScript, Electron, Node.js ESM Gateway, WebSocket, Node test runner.

## Global Constraints

- 保留用户已有修改，不执行 reset、checkout、commit 或 push。
- 中文注释和新增持久化字段使用 UTF-8。
- 不新增依赖，不改变公开 WebSocket 消息格式；新增字段保持向后兼容。
- 当前任务总览只显示摘要、耗时和 token；详细步骤进入消息列表。

### Task 1: 独立执行步骤气泡

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/components/TaskActivityTimeline.vue`
- Test: `desktop-ui/src/task-activity.test.mjs`

**Interfaces:**
- 消费现有 `TaskActivityState` 和 Gateway 执行事件。
- 继续由底部总览消费聚合状态；消息列表消费独立的步骤消息。

- [ ] 为关键阶段事件定义稳定的步骤消息去重键。
- [ ] 在任务开始、工具开始/完成、Agent、审查、压缩、错误和完成事件上追加独立消息。
- [ ] 保留底部活动框，只显示当前标题、耗时和 token 摘要，不展示完整步骤列表。
- [ ] 运行 `node --test desktop-ui/src/task-activity.test.mjs` 和 `npm exec vue-tsc -- --noEmit`。

### Task 2: 会话权限持久化

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `gateway/sessions/session-runtime.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/sessions/session-runtime.test.mjs`

**Interfaces:**
- 前端通过现有 `user_message` 的 `permissionMode` 字段发送选择。
- Gateway 会话运行时保存 `permissionMode`，恢复会话时在 `session_state_snapshot` 返回。

- [ ] 将会话权限模式纳入 `TabState` 快照，并在新建/恢复会话时恢复。
- [ ] Gateway 创建或恢复 Session 时读取并保存权限模式。
- [ ] WebSocket 快照暴露脱敏后的权限模式，兼容旧 Session 默认 `default`。
- [ ] 运行 Gateway 语法检查、Session 测试、前端类型检查和 `git diff --check`。
