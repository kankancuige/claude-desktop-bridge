# 会话长时间无事件可观测性实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Bridge 在 Provider 首次响应前持续报告阶段，并修复当前 HTTP 文件 diff 的组合根依赖缺失。

**Architecture:** Relay 负责记录一次请求及每次上游尝试的阶段和耗时；Session Input Runtime 维护独立的低频等待心跳，不重置 SDK watchdog，确保“有进度但无 SDK 事件”和“真正断流”可区分。HTTP 路由依赖由 Gateway 组合根完整注入。

**Tech Stack:** Node.js ESM、Node test runner、现有 Vue 任务活动模型。

## Global Constraints

- 不修改 WebSynchronous 业务代码。
- 不记录 Provider token 或请求正文。
- 不提交、不推送、不重启当前 Electron/Gateway 进程。
- 保留有界超时和最终 watchdog 收口。

### Task 1: 修复文件 diff 依赖接线

**Files:** `gateway/gateway-runtime-impl.mjs`, `gateway/http/session-file-routes.mjs`

- [x] 将 `lineDiffStats`、`computeLineDiff` 注入 `gatewayRouteContext`。
- [x] 通过 Gateway 全量测试覆盖路由构造和组合根接线。

### Task 2: 增加 relay 阶段日志

**Files:** `gateway/providers/codex-relay-proxy.mjs`, `gateway/providers/codex-relay-proxy.test.mjs`

- [x] 为请求生成不含凭据的本地 requestId。
- [x] 记录 request_started、upstream_attempt、retry_wait、upstream_response、request_completed/request_failed 阶段及耗时。
- [x] 保持现有重试、取消和响应契约不变。

### Task 3: 增加 SDK 等待心跳

**Files:** `gateway/runtime/session-input-runtime.mjs`, `gateway/runtime/session-input-runtime.test.mjs`, `desktop-ui/src/task-activity.ts`, `desktop-ui/src/task-activity.test.mjs`

- [x] 每 15 秒广播一次 `stream_waiting`，包含 elapsedMs、当前是否等待权限/工具和固定提示。
- [x] 清理 watchdog 时同时清理 heartbeat；heartbeat 不调用 `armStreamWatchdog`。
- [x] UI 将该事件映射到 waiting 状态并展示 Provider/权限阶段。

### Task 4: 验证

- [x] 运行 relay、session runtime、task activity 定向测试。
- [x] 运行 `node --check`、`git diff --check` 和 Gateway 全量测试。
- [x] 明确真实外部 Provider 仍需运行时验收。
