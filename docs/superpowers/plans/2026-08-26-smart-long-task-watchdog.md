# 智能长任务 Watchdog 改造计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Gateway 根据授权等待、活动工具、普通 SDK 事件和绝对运行时长动态判断长任务，避免把正常长任务误判为卡死。

**Architecture:** Session 记录当前工具活动和最近 SDK 事件。Watchdog 使用状态分层策略：授权等待不收口，活动工具使用更长的工具窗口并受绝对上限约束，普通流使用空闲窗口；只有无活动且超过对应窗口才收口。SDK 事件循环负责维护工具状态，Session 输入 Runtime 只负责计时和终态收口。

**Tech Stack:** Node.js ESM、Node test runner、现有 Session Runtime/SDK Stream Runtime。

## Global Constraints

- 保留现有用户改动，不重启 Gateway，不提交 Git。
- 不新增依赖，不改变公开 WebSocket/IM 事件契约。
- 仍保留绝对最大等待时间，避免无限挂起。
- 必须验证授权、长工具、普通事件、真正断流和清理路径。

### Task 1: 定义动态 watchdog 策略

**Files:**
- Modify: `gateway/runtime/session-input-runtime.mjs`
- Test: `gateway/runtime/session-input-runtime.test.mjs`

- [x] 添加可配置的普通空闲窗口、工具空闲窗口和绝对运行上限。
- [x] 根据 `session.pending`、`session._activeTools`、`session.taskStartedAt` 选择下一次计时窗口。
- [x] 增加授权等待不会超时、活动工具使用长窗口、绝对上限仍收口的测试。

### Task 2: 维护 SDK 工具活动状态

**Files:**
- Modify: `gateway/runtime/sdk-stream-runtime.mjs`
- Modify: `gateway/sessions/session-runtime.mjs`
- Test: `gateway/runtime/sdk-stream-runtime.test.mjs`

- [x] Session 初始化活动工具集合及开始时间字段。
- [x] 处理 `tool_use_start`、`tool_progress`、工具结束/回合结束事件，刷新或移除活动工具。
- [x] 保证异常、停止、result、query 替换时活动状态清理。

### Task 3: 合同测试和验证

**Files:**
- Modify: `gateway/sessions/session-watchdog-contract.test.mjs`

- [x] 锁定动态策略配置和状态字段契约。
- [x] 运行定向测试、语法检查、`git diff --check`。
- [x] 运行 Gateway 全量测试并记录与本次无关的既有失败。
