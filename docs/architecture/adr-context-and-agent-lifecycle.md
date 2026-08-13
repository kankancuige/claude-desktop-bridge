# ADR：上下文窗口与 Agent 生命周期可见性

**Status:** Proposed
**Date:** 2026-08-11
**Owner:** Claude Desktop Bridge maintainer

## Context

Gateway 当前对 Codex relay 和未知模型兜底为 1M，前端还把单轮 usage 当成会话上下文。SDK 已提供 `Query.getContextUsage()`、`ModelUsage.contextWindow`、`PreCompact/PostCompact` 和 `compact_boundary`，但没有接入。Agent 生命周期目前只有一个 `description` 字段，`SubagentStart` 可能用通用文案覆盖 Agent 工具携带的具体任务。

## Decision

1. 上下文窗口采用 SDK 实际 `rawMaxTokens/contextWindow` 优先，供应商元数据次之，未知模型返回 `null`；用户设置只能作为更小的 safety cap。
2. 启用 SDK 原生 `autoCompactEnabled`，由 SDK 在其安全阈值执行压缩；Gateway 用 hooks 和 `compact_boundary` 广播可见状态，不在运行中主动注入 `/compact`。
3. synthetic compact summary 不进入普通聊天用户气泡，只转换为紧凑系统事件，摘要按需展开。
4. Agent descriptor 拆为固定 `purpose`、本次 `task`、`scope`、`currentAction` 与来源；生命周期关联优先使用 `toolUseID/requestId/agentId`，不得只用 agentType。

## Alternatives

- 继续使用固定 1M：实现简单，但会让 256K 模型在 UI 中显示错误百分比并延迟压缩。
- 前端按 usage 自行发送 `/compact`：无法准确处理并发 Agent、工具调用和 SDK 内部状态，容易产生竞态。
- 只保留一个 description：无法区分 Agent 的长期职责与本次任务，生命周期升级时会覆盖有效信息。

## Consequences

- 正面：上下文百分比与真实 SDK 一致，自动压缩不降级到人为插入命令；压缩结果不会撑爆聊天窗口；Agent 卡片可解释。
- 负面：未知 provider 在收到 SDK usage 前显示 unknown；真实 compact summary 仍需用户主动展开查看。
- 兼容：旧 WS 客户端忽略新增事件；旧 `description` 字段继续保留作为兼容字段。

## Validation and Review Triggers

- 必须通过 context/agent 单测、Gateway 全测、TypeScript 检查和 Vite build。
- 真实 SDK session 需验证 `getContextUsage()` 返回值、auto compact 阈值和桌面渲染；若 SDK 改变消息字段或压缩策略，重新评估本 ADR。
