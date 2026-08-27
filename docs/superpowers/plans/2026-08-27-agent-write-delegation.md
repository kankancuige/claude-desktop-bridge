# Agent Write Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一会话与 Workflow Agent 的权限解释，并在只读 Agent 需要改文件时返回结构化写入请求，由主任务在有权限时执行并重新验证，而不是直接终止 Workflow。

**Architecture:** 会话 `permissionMode` 是唯一权限来源，Workflow 只负责传递，不再独立拒绝 Agent。AgentResult 增加受约束的 `writeRequest`，Dispatcher 将只读 Agent 的变更声明转换为阻塞结果并广播可消费事件；主任务运行时消费该请求，只有会话允许写入时才向主 SDK 注入明确的代写提示，执行后重新走检查点/验证门禁。只读会话保留 `waiting_user`/明确阻塞，不伪装完成。

**Tech Stack:** Node.js ESM、Node test runner、Claude Agent SDK、现有 Task Coordinator/Workflow Runner。

## Global Constraints

- 不放开只读 Agent 的写权限，不把 Agent 声明的 `changedFiles` 当作真实写入证据。
- 保留现有 dirty worktree，不提交、不推送、不安装依赖、不启动真实外部服务。
- 所有写入必须由主会话 SDK 执行，并在写入后重新进入验证/审查门禁。
- 真实 Provider/桌面端/硬件行为未验证时必须明确标记残余风险。

### Task 1: AgentResult 与 Dispatcher 写入请求协议

**Files:**
- Modify: `gateway/agents/agent-result.mjs`
- Modify: `gateway/agents/agent-dispatcher.mjs`
- Test: `gateway/agents/agent-result.test.mjs`
- Test: `gateway/agents/agent-dispatcher.test.mjs`

**Interfaces:** `normalizeAgentResult()` 输出 `writeRequest`；`dispatchAgent()` 在只读 Agent 发现写入需求时返回 `status: 'blocked'`、`changedFiles: []` 和规范化 `writeRequest`，越界文件仍抛 `AGENT_SCOPE_VIOLATION`。

- [ ] 增加失败测试：只读 Agent 的 `changedFiles` 被转换为写入请求；结构化写入请求字段被保留；越界请求仍拒绝。
- [ ] 移除 `plan + writable definition` 的直接拒绝，统一由会话权限控制执行能力。
- [ ] 实现请求字段上限、路径范围校验、默认原因和 `nextAction`，避免把声明修改当成真实修改。
- [ ] 运行两组 Agent 单测并确认原有能力/邮箱/失败路径不回归。

### Task 2: Workflow Agent 结果与生命周期事件

**Files:**
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/runtime/workflow-broadcast-runtime.mjs`
- Modify: `gateway/tasks/task-coordinator.mjs`
- Test: `gateway/workflows/workflow-script.test.mjs`
- Test: `gateway/tasks/task-coordinator.test.mjs`

**Interfaces:** Workflow Agent IPC 结果保留规范化 `status`/`writeRequest`；新增 `workflow_agent_blocked`/`agent/blocked` 生命周期投影，不转换成系统错误。

- [ ] 增加失败测试：Dispatcher 返回 blocked 时 Workflow Agent 结果仍带 `writeRequest`，Coordinator 记录 blocked Agent 而非 failed Workflow。
- [ ] 修改 runner 包装逻辑，保留 AgentResult 状态和写入请求，禁止固定写死 `status: 'completed'`。
- [ ] 扩展广播映射和 Coordinator 投影，向前端提供待主任务代写的原因、文件和下一步。
- [ ] 运行 Workflow/Coordinator 相关单测和 `node --check`。

### Task 3: 主任务消费与权限分支

**Files:**
- Modify: `gateway/runtime/task-command-runtime.mjs`
- Modify: `gateway/runtime/sdk-stream-runtime.mjs`
- Modify: `gateway/runtime/task-completion-effects-runtime.mjs`
- Modify: `gateway/tasks/task-workflow-gate.mjs`
- Test: `gateway/runtime/task-command-runtime.test.mjs`
- Test: `gateway/runtime/sdk-stream-runtime.test.mjs`
- Test: `gateway/runtime/task-completion-effects-runtime.test.mjs`

**Interfaces:** 为会话保存有界待处理 `writeRequest`；`bypassPermissions`/`acceptEdits` 等可执行会话把请求转成主任务内部输入并清除请求；`plan` 会话转为可恢复 `waiting_user`/阻塞事件，不强行结束 Workflow。

- [ ] 增加失败测试覆盖自动权限、只读权限、Provider 失败、重复 Workflow 结果和恢复路径。
- [ ] 在 Workflow 结束结算前提取 write request，先广播 `task_write_delegated`/生命周期快照，再按会话权限决定注入主任务。
- [ ] 主任务代写完成后重新建立 checkpoint 并触发 Coordinator validation/final review，不直接标记完成。
- [ ] 确保重复事件幂等、请求有上限、失败可恢复，运行定向运行时测试。

### Task 4: 统一权限入口与回归门禁

**Files:**
- Create: `gateway/agents/agent-permission.mjs`
- Modify: `gateway/workflows/workflow-model-routing.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Test: `gateway/agents/agent-permission.test.mjs`

**Interfaces:** `normalizePermissionMode()`、`resolveEffectivePermissionMode()`、`canDelegateWriteToParent()` 成为 Workflow/Dispatcher/主任务共用的权限 API。

- [ ] 迁移现有 Workflow 权限解析和 Dispatcher 校验到统一模块，保持 `default/acceptEdits/plan/bypassPermissions` 兼容。
- [ ] 加入权限矩阵测试：父会话覆盖 Agent 请求、只读不会写入、自动模式允许主任务代写。
- [ ] 运行 Gateway 全测试、最小前端类型/构建门禁（若未触碰前端则记录未重复运行原因）和 `git diff --check`。
- [ ] 更新架构决策文档，记录权限单一入口、代写边界、失败恢复与重新验证证据。
