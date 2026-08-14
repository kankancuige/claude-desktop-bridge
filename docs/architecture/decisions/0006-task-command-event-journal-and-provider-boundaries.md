# ADR 0006：统一任务命令、事件日志与 Agent Provider 边界

Checklist: 24/24 complete
Incomplete: None

**Status:** Accepted
**Date:** 2026-08-14
**Owner:** Claude Desktop Bridge maintainer

## Context

桌面 WebSocket、微信、飞书和钉钉都能向同一 Session 提交任务，但三个 IM adapter 各自创建本地 WebSocket、解释任务事件并判断终态。Gateway 同时用 Claude SDK transcript、`bridge-task-state`、Workflow journal 和进程内字段表达会话事实。Agent 调用直接依赖 Claude SDK `query()`，调用前没有统一的能力协商，也没有可释放的 Provider 注册边界。

这些分散入口会导致同一条消息在去重、排队、模型路由、错误提示和停止行为上出现差异；多套状态也让重启恢复只能拼接快照，无法证明父任务经历了哪些转换。

## Drivers

- 桌面、微信、飞书、钉钉和内部 Workflow 必须通过同一条任务接收路径。
- Claude SDK transcript 继续拥有用户和 assistant 正文，Bridge 不复制正文。
- 已接受任务必须留下不含 Prompt 和凭据的持久事件，强制重启后能恢复 Bridge 任务状态。
- Agent Provider 不支持某项必需能力时必须在启动前明确失败，禁止接受后静默降级。
- Provider 注册、监听器和进程资源必须有确定性释放入口。
- 迁移期间保留现有 WebSocket 消息协议和 `bridge-task-state` 兼容读取。

## Decision

### 1. Task Command Service

Gateway 新增进程内 `TaskCommandService`，提供：

```ts
submitTask(command): Promise<TaskCommandResult>
observeTask(sessionId, identity, listener): () => void
cancelTask(sessionId): Promise<CancelTaskResult>
publish(sessionId, event, identity?): void
```

`TaskCommand` 包含 `sessionId`、`source`、`userId`、`messageId`、`content` 和受控桌面选项。桌面 WebSocket 是协议 adapter；三个 IM 模块直接消费服务，不再分别建立到 Gateway 的任务 WebSocket。`observeTask()` 只投递符合来源和用户身份的事件。

### 2. Bridge Session Event Journal

每个主 Session 使用独立 JSONL sidecar，记录连续 `seq`、`time`、`type` 和 JSON payload。首期事件只覆盖 Bridge 自有事实：任务接收、状态转换、Workflow/Agent 生命周期、runtime 失败和停止。事件不得保存 Prompt、assistant 正文、API Key、请求 body 或完整工具结果。

`bridge-task-state` 保留为兼容投影；启动恢复优先从 journal 的最后有效任务状态事件投影，journal 不存在时才读取旧快照。尾部半行可忽略，序列中断或非 JSON 值必须拒绝作为恢复证据并记录错误。

### 3. Agent Capability Contract

Agent Provider 注册以下稳定能力：

```ts
interface AgentCapabilities {
  writable: boolean
  resumable: boolean
  modelOverride: boolean
  structuredOutput: boolean
  toolFiltering: boolean
  continuation: boolean
}
```

调用方提交显式 requirements；Provider registry 在启动前校验。缺少能力返回 `AGENT_CAPABILITY_UNSUPPORTED`，错误包含 provider 和 capability 名称，不包含 Prompt。

### 4. Provider Registry

Provider 通过 `register(kind, name, provider, capabilities)` 注册，返回幂等 disposer。Registry 支持 `get()`、`require()`、`disposeAll()`；同 kind/name 重复注册被拒绝。Claude SDK 先作为唯一 `agent/claude-sdk` Provider 接入，Gateway 和 Workflow runner 通过该 Provider 启动 query。

## Failure And Recovery

| 失败 | 行为 |
|---|---|
| Task command 校验失败 | 不入队、不写接受事件，返回稳定错误码 |
| 接受事件无法持久化 | 回滚输入接收，不向调用方返回 accepted |
| IM observer 中断 | 已接受任务继续运行；adapter 以可见错误结束等待，不重复提交 |
| Journal 尾部半行 | 忽略尾部半行并保留此前连续事件 |
| Journal 中间损坏或 seq 中断 | 拒绝 journal 投影，回退旧快照并记录诊断 |
| Provider 能力不足 | 启动前失败，不调用 Claude SDK |
| Provider disposer 失败 | 继续释放其余 Provider，汇总记录错误 |

## Consequences

- 正面：所有入口共享去重、排队、模型路由、生命周期和停止语义。
- 正面：Bridge 自有任务事实可重放，且不复制敏感对话正文。
- 正面：Agent 启动失败发生在副作用前，能力边界可测试。
- 正面：后续可增加 Codex/远程 Agent Provider，无需修改主任务流程。
- 负面：迁移期同时保留 WebSocket 协议、task-state 快照和新 journal。
- 负面：`gateway/index.mjs` 仍承担接线，后续阶段再按 Provider 边界拆分。

## Validation

- Desktop 与三个 IM source 的相同命令产生一致 accepted/rejected 结果。
- 同 source/user/messageId 重复提交只执行一次。
- 强制构造半行、seq 中断和非 JSON journal，验证恢复策略。
- 任务 accepted、running、terminal 可从 journal 投影；Prompt 和凭据不出现在文件。
- 缺少 `structuredOutput` 或 `writable` 能力时 Provider 不启动。
- disposer 幂等；Gateway shutdown 调用 `disposeAll()`。
- 旧 WebSocket 客户端和旧 `bridge-task-state` 仍可工作。

## Review Triggers

- Claude SDK 提供原生统一 Inbox 和可扩展 Session Event API。
- 引入第二个真实 Agent Provider。
- journal 需要跨设备同步、查询或超过单文件有界规模。
- 旧桌面端兼容窗口结束，可删除旧协议和 task-state 快照。
