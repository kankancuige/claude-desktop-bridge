# Unified Task Model Routing Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Each task must pass its focused tests before the next task begins.

**Goal:** 统一普通会话、Workflow、Agent 和最终审查的任务判定，使自动模式按风险选择 Light、Balanced、Power，固定模式保持用户选择。

**Architecture:** Gateway 新增纯函数 `TaskDecision` 作为唯一判定源；现有 Context Profile 和 Workflow 入口消费决策结果。桌面端只持有自动/固定模式和显示状态，不在客户端判断风险。模型切换只发生在已接受消息进入 SDK 前的回合边界。

**Tech Stack:** Node.js 20 ESM、Claude Agent SDK、Electron、Vue 3、TypeScript、Node test runner。

## Global Constraints

- 不新增依赖，不修改 transcript、session-map 或供应商凭据格式。
- 旧客户端携带显式 `model` 且无 `modelMode` 时保持 fixed 行为。
- 高风险任务缺少 Power 模型时不得静默降级并宣称完成。
- 中文源码和文档保持 UTF-8，日志和事件不得包含密钥或隐藏 Prompt。

---

### Task 1: 统一任务决策纯函数

**Files:**
- Create: `gateway/task-decision.mjs`
- Create: `gateway/task-decision.test.mjs`
- Modify: `gateway/context-profile.mjs`

**Interfaces:**
- Produces: `decideTask(input): TaskDecision`、`resolveTierModel(decision, modelTiers, defaultModel)`、`isAutomaticModelMode(mode, explicitModel)`。
- Consumes: 用户文本、当前上下文、只读约束、附件/文件证据和可选真实差异风险。

- [x] 写决策表失败测试：简单查询、只读代码探索、普通修改、认证短句、会话恢复、协议/并发、安全审查、继续任务。
- [x] 运行 `node --test gateway/task-decision.test.mjs`，确认缺少模块而失败。
- [x] 实现确定性规则，硬风险优先于文本长度，输出稳定原因码并限制数组长度。
- [x] 让 `classifyContextProfile` 委托统一决策，同时保留现有公开返回值。
- [x] 运行决策和 Context Profile 测试，确认通过。

### Task 2: Gateway 自动与固定模式

**Files:**
- Modify: `gateway/index.mjs`
- Create: `gateway/model-routing.test.mjs`

**Interfaces:**
- Consumes: `modelMode`、显式模型、`TaskDecision`、`modelTiers`。
- Produces: 回合实际模型、`task_decision` WS 事件、session 的 `taskDecision/modelMode` 状态。

- [x] 写自动/固定/旧客户端兼容、档位缺失回退和硬风险 Power 的失败测试。
- [x] 在会话创建和 WebSocket 输入校验 `modelMode`，自动模式不把 UI 默认模型当作显式覆盖。
- [x] 每轮在 `beginTurn` 前计算决策，解析实际模型；仅模型真的改变时沿现有关闭/懒重建路径切换。
- [x] 广播脱敏 `task_decision`，日志只记录档位、模型和原因码。
- [x] 运行 Gateway 聚焦测试。

### Task 3: Workflow、Agent 与最终审查

**Files:**
- Modify: `gateway/workflow-runner.mjs`
- Modify: `.claude/workflows/code-review.mjs`
- Modify: `.claude/workflows/bug-hunter.mjs`
- Create: `gateway/workflow-model-routing.test.mjs`

**Interfaces:**
- Consumes: `TaskDecision.modelTier/finalReview` 和 `_tierModel/_powerModel/_balancedModel`。
- Produces: 未显式指定模型的 Agent 继承任务档位；最终高风险审查请求 Power。

- [x] 写 Workflow 档位继承、显式覆盖和高风险最终审查升级测试。
- [x] 移除内置 Workflow 的 `sonnet` 写死值，用职责档位表示 planner/explorer/implementer/reviewer。
- [x] 自动 Workflow 直接消费统一决策的 workflow 与档位，不再重复 AI 分类高风险信号。
- [x] 实施任务不自动并行启动写入型 Workflow；Critical/High 成功回合按真实 checkpoint 使用 Power 复核。
- [x] 运行 Workflow 聚焦测试。

### Task 4: 桌面端自动模式与可见性

**Files:**
- Create: `desktop-ui/src/model-routing.mjs`
- Create: `desktop-ui/src/model-routing.d.ts`
- Create: `desktop-ui/src/model-routing.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `desktop-ui/src/i18n.ts`

**Interfaces:**
- Consumes: `task_decision` 事件和设置页 `modelTiers`。
- Produces: tab 级 `modelMode`、自动/固定选择器、实际模型与原因提示。

- [x] 写创建请求和用户消息 payload 的自动/固定模式测试。
- [x] 控制栏增加 `自动` 选项；自动时发送 `modelMode:auto` 且不发送显式 `model`，固定时发送两者。
- [x] tab 状态保存 `modelMode` 和最近决策，切换 tab 不丢失、不清空消息。
- [x] `task_decision` 更新紧凑状态提示和实际模型，不展示内部 Prompt。
- [x] 设置页把三档说明从 Workflow 专用改为全局任务模型职责，并提示相同模型不会产生实际切换。

### Task 5: 验证与验收

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 所有前述接口。
- Produces: 用户配置说明、兼容说明和最终验证证据。

- [ ] 运行 Gateway 全量 `node --test`。
- [ ] 运行 Desktop 全量 `node --test`。
- [ ] 运行 `pnpm.cmd exec vue-tsc --noEmit` 和 `pnpm.cmd exec vite build`。
- [ ] 运行 `node --check gateway/index.mjs`、UTF-8/乱码检查和 `git diff --check`。
- [ ] 核对自动模式、固定模式、硬风险 Power、Workflow 继承和高风险最终审查需求追踪完整。
