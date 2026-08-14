# ADR 0005：统一任务生命周期聚合与客户端能力

Checklist: 22/22 complete
Incomplete: None

**Status:** Accepted
**Date:** 2026-08-13
**Owner:** Claude Desktop Bridge maintainer

## Context

同一会话的主回合、父任务、Workflow、Agent 和前端分别维护运行状态。SDK `result`、Agent 完成、Workflow 完成、WebSocket 重连快照和本地标签恢复会以不同顺序到达，导致输入按钮、停止按钮、状态灯、宠物提示和 IM 最终通知对“任务是否完成”产生不同结论。Workflow 终态保留五分钟，而旧实现只返回 Map 中第一条匹配项，还可能用旧终态覆盖当前运行项。

## Drivers

- 微信、飞书和钉钉只能在父任务真实终态后收到一次最终通知。
- 桌面端的发送、停止和继续能力必须来自同一业务事实。
- SDK `result` 只结束主回合；单个 Agent 或 Workflow 完成不能结束父任务。
- 标签切换、WebSocket 重连和迟到事件不能把终态重新激活，也不能让运行任务提前空闲。
- 迁移必须兼容旧桌面端和现有 IM adapter，且不新增服务或依赖。

## Options

1. 继续在 `WorkspaceView.vue` 增加条件：改动小，但状态写入口继续增长，无法消除事件顺序竞态。
2. 让 Workflow runner 成为任务状态源：能覆盖 Agent，但不了解主回合、输入队列、权限确认和 IM 终态。
3. 由 Gateway 聚合父任务、runtime 和全部 Workflow，输出一个版本化生命周期快照，前端仅消费能力投影：边界清楚，可渐进迁移。

## Decision

采用方案 3。Gateway 是任务生命周期的唯一业务所有者，新增 `session_lifecycle_snapshot`：

```ts
interface SessionLifecycleSnapshot {
  version: 1
  sessionId: string
  sequence: number
  active: boolean
  task: TaskState
  runtime: {ready: boolean; generating: boolean; taskWorkflowPending: boolean; pendingInputs: number}
  workflows: WorkflowState[]
  currentWorkflow: WorkflowState | null
  capabilities: {canSend: boolean; canStop: boolean; canContinue: boolean}
}
```

`active` 是父任务活跃阶段、runtime 正在生成或任一 Workflow 为 `starting/running` 的并集。Workflow 当前项按 `running > starting > paused > terminal` 选择，同优先级取 `startedAt` 最新项，不能依赖 Map 插入顺序。

桌面端收到权威快照后，输入和停止能力只读取 `active/capabilities`。`status`、`taskActivity`、Agent 和 Workflow 明细保留为展示投影，不能反向决定业务状态。发送按钮点击后允许本地预测进入 active，但只能由 Gateway 终态快照或父任务终态事件解除。

Workflow 分为父任务所属的 task-owned Workflow 和用户单独启动的 standalone Workflow。task-owned Workflow 完成后使用带 `workflowId` 的内部结果标记回灌父会话；只有对应结果回合被 SDK 消费后，父任务才能继续结算。暂停或失败会解除等待，但不会把辅助 Workflow 的失败直接提升为父任务失败；必需的最终审查仍由父任务 completion reducer 决定。

停止父任务时统一向 reducer 提交 `user_stopped`，然后取消权限确认、全部待接收输入、主 runtime 和该会话全部活跃 Workflow。若父任务已经终结而只有 standalone Workflow 活跃，则只停止这些 Workflow，不关闭主 runtime，也不改写父任务终态。runtime 异常统一进入 `interrupted` 并清理 task-owned Workflow 等待门禁。迟到的 review、Agent、Workflow 事件不能覆盖父任务终态。

普通、恢复和 scheduled Session 通过同一 runtime 工厂建立输入队列、资源、父任务 completion、持久态和 Workflow 门禁不变量；Session 类型只叠加自己的差异字段。

迁移期保留 `session_state_snapshot` 和 `workflow_state_snapshot`，新版客户端优先读取统一快照。IM adapter 继续只消费 `task_completed`、`task_failed` 和 `task_review_paused`；未来统一 adapter command API 时再移除旧快照。

## Consequences

- 正面：输入、停止、继续、状态灯和任务通知共享同一事实；重连顺序不再决定业务状态。
- 正面：同一会话多个 Workflow 可完整投影，停止不会遗漏后台 Workflow。
- 正面：独立 Workflow 的停止不会污染已经完成的父任务，内部结果也不会作为用户消息显示或参与跨会话接力。
- 正面：展示状态可以继续细化，不会影响执行正确性。
- 负面：迁移期存在新旧两套快照，需保留兼容测试并监控差异。
- 负面：`gateway/index.mjs` 仍是接线点，后续需把 Session runtime 工厂和事件协调器拆到独立模块。

## Validation

- 同一会话存在旧终态和新运行 Workflow 时，当前项选择新运行项。
- 主回合 `result` 后最终审查运行中，`active=true` 且 `canSend=false`。
- 单个 Agent 或 Workflow 完成不解除父任务忙碌。
- 父任务终态且所有 Workflow 结束后，`active=false`。
- 停止父任务覆盖主回合、权限、输入队列和所有运行 Workflow；仅有独立 Workflow 时只停止 Workflow。
- runtime 异常将父任务投影为 `interrupted`，不会遗留 Workflow 结果等待门禁。
- 标签重连只靠统一快照即可恢复发送、停止和继续能力。
- 微信、飞书和钉钉仍只在父任务终态后通知。

## Review Triggers

- SDK 提供原生可恢复父子任务树和单调 sequence 契约。
- 需要并行运行多个用户拥有的父任务。
- IM adapter 改为统一 `submitTask/observeTask/cancelTask` command API。
- 旧客户端兼容窗口结束，可删除旧快照。
