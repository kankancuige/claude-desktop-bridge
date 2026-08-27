# 模型调用日志设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在设置页增加模型调用日志，展示当前 AI 调用状态、Token 汇总趋势和调用明细。

**Architecture:** 复用 Gateway 已写入的 `model_usage_events` 账本；PostgresStateStore 提供参数化的时间范围汇总与明细查询，HTTP 路由返回统一 JSON。SettingsView 通过现有 Gateway 地址定时刷新日志与会话快照，使用现有扁平工业风格渲染汇总、柱状图和表格。

**Tech Stack:** Node.js ESM、PostgreSQL、Vue 3 Composition API、Vite、现有 CSS 变量。

## Global Constraints

- 不新增依赖、不修改公开已有接口、不提交或推送。
- SQL 必须参数化，查询必须有时间范围或行数限制。
- 保留未知 Token 为“未知”，不得当作零。
- UI 需覆盖加载、空数据、错误和正在调用状态。

### Task 1: Storage 查询

**Files:** `gateway/storage/postgres-state-store.mjs`、对应测试

- 增加 `listModelUsageHistory({from,to,limit,projectKey})`，返回最近调用明细。
- 增加 `summarizeModelUsage({from,to,projectKey})`，按日期聚合调用次数与已知 Token，并返回总计。
- 所有条件使用参数占位符，时间范围默认最近 14 天，限制最多 500 条明细。
- 测试查询参数、未知值和边界限制。

### Task 2: HTTP 路由

**Files:** `gateway/http/usage-routes.mjs`、`gateway/gateway-runtime-impl.mjs`、路由测试

- 新增 `GET /api/usage/history`，返回 `{summary, trend, events, activeSessions}`。
- 使用现有运行时 session 状态计算活跃 AI 调用，失败时返回明确 HTTP 错误。
- 保持 Gateway token 认证和现有路由注入方式。

### Task 3: 设置页 UI

**Files:** `desktop-ui/src/views/SettingsView.vue`

- 增加“调用日志” Tab 和懒加载函数。
- 显示调用中状态、总调用次数、输入/输出/缓存 Token、按日柱状图、明细表。
- 使用不透明表面、现有主题变量和稳定表格尺寸；处理空数据、未知 Token、刷新失败。
- 页面打开后按短间隔刷新，卸载时清理定时器。

### Task 4: 验证

- 运行 Gateway 相关测试、桌面端测试、`vue-tsc`、Vite build 和 `git diff --check`。
- 启动可用时做设置页 smoke test，确认新 Tab、空数据和调用中状态无溢出。
