# Grill-Me Requirements Clarification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Bridge 的统一任务入口增加可恢复的需求澄清门禁，需求计划不完整时由内置 `grill-me` 生成高价值问题并持续等待回答，明确后才进入正常规划或执行。

**Architecture:** Gateway 负责判断是否进入需求澄清、调用隔离的 `requirements-clarification` Workflow、持久化澄清轮次和问答、通过现有任务事件总线广播桌面与 IM 状态。内置 `grill-me` 作为随安装提供的 Skill 和 Workflow 专用设计约束；主会话的 SDK query 只有在澄清完成后才接收合并后的任务文本。澄清状态复用现有 task-state SQLite/JSON 投影，重启后由 session resume 恢复。

**Tech Stack:** Node.js ESM Gateway、Claude Agent SDK Workflow fork、SQLite task-state projection、WebSocket task events、Vue 3 WorkspaceView。

## Global Constraints

- 只在需求计划/方案类任务触发，不影响普通查询和明确执行任务。
- 澄清问题、用户回答和轮次必须持久化，不能因重启、刷新或 IM/桌面切换丢失。
- 一次只发送一批问题；明确后只生成一次计划，不允许重复创建任务。
- 用户明确要求“按现有理解执行”时跳过澄清。
- 主任务不应在澄清期间消耗上下文或执行工具。
- 不引入新的运行时依赖；所有新增文件使用 UTF-8。

### Task 1: 内置资源和需求澄清 Workflow

**Files:**
- Create: `gateway/builtin-resources/skills/grill-me/SKILL.md`
- Create: `gateway/builtin-resources/workflows/requirements-clarification.mjs`
- Modify: `gateway/builtin-resources/manifest.json`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Test: `gateway/tasks/requirements-clarification.test.mjs`

- [ ] 复制现有 `grill-me` 设计规则到 Bridge 内置资源，并登记为默认启用、可关闭的 Skill。
- [ ] 增加隔离 Workflow，要求 Agent 返回 `{complete, questions, summary}`，问题最多 5 个并带 `id/question/why`。
- [ ] 让 Workflow 以 balanced 为默认档位，禁止将结果自动注入父会话。
- [ ] 覆盖完整需求、缺少范围/验收标准、问题上限和 JSON 降级解析测试。

### Task 2: 澄清状态和 Gateway 门禁

**Files:**
- Create: `gateway/tasks/requirements-clarification.mjs`
- Modify: `gateway/tasks/task-state.mjs`
- Modify: `gateway/tasks/task-command.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/tasks/requirements-clarification.test.mjs`

- [ ] 实现需求计划触发判定、显式跳过判定、问答合并和状态归一化。
- [ ] 在 `submitTaskCommand` 接收主任务前执行 Grill；不完整时持久化 `clarifying` 状态并返回 `message_clarification_required`。
- [ ] 等待回答时复用原 session 和原 task，不调用 `acceptSessionInput`，不创建第二个主任务。
- [ ] 明确后将原始任务、问答和最终约束合并为一次主任务输入，清理澄清状态并继续现有模型路由/工作流流程。
- [ ] 复用现有 SQLite/JSON task-state 投影和 `session_state_snapshot`，兼容旧状态。

### Task 3: 桌面端和 IM 可见性

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Test: `gateway/tasks/requirements-clarification.test.mjs`

- [ ] 广播 `requirements_clarification`、`requirements_clarification_resolved` 和 `requirements_clarification_error` 事件。
- [ ] 桌面端将每批问题显示为独立步骤气泡，并保留等待状态；恢复连接时从 snapshot 重建。
- [ ] IM 只收到澄清问题摘要或最终完成状态，不刷工具细节；回答仍走同一任务命令入口。
- [ ] 验证桌面回答、IM 回答、重复回答、断线重连和重启恢复路径。

### Task 4: 架构记录和门禁验证

**Files:**
- Create: `docs/architecture/decisions/0010-grill-me-requirements-gate.md`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/target-design.md`

- [ ] 记录澄清门禁的边界、状态机、失败恢复、超时/取消、兼容和回滚策略。
- [ ] 运行 Node 语法检查、澄清定向测试、Gateway 全量测试、Vue 类型检查和 `git diff --check`。
- [ ] 明确未覆盖的真实供应商、微信/飞书/钉钉端到端证据，不把静态测试当作运行时验收。
