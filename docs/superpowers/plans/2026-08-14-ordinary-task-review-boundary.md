# 普通任务审查边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 普通代码修改由主会话直接实现并只做定向验证，避免被错误路由到自动审查；明确审查和高风险关键路径仍保留独立门禁。

**Architecture:** 在任务决策层区分省略式修改命令、只读诊断和明确审查，再由 Workflow 路由层只允许明确审查类动作自动启动辅助流程。任务门禁层把内部 Workflow 结果回合与用户主任务结果隔离，确保延迟的主结果只结算一次并进入终态。

**Tech Stack:** Node.js ESM、`node:test`、Gateway Session/Workflow 状态机。

## Global Constraints

- 普通实现任务不自动启动 `bug-hunter`、全项目审查或第二轮审查。
- 普通实现只运行与本次修改相关的 build/test。
- 用户明确要求审查，或任务涉及认证、持久化、并发、协议、消息投递、关键路径时，才启动独立审查门禁。
- 不新增依赖，不启动或终止外部服务，不提交或推送，保留现有 dirty worktree。

---

### Task 1: 修正任务意图和审查边界

**Files:**
- Modify: `gateway/task-decision.mjs`
- Test: `gateway/task-decision.test.mjs`
- Modify: `gateway/workflow-model-routing.mjs`
- Test: `gateway/workflow-model-routing.test.mjs`

**Interfaces:**
- Consumes: `decideTask(input)` 返回的 `action`、`workflow`、`finalReview`、`risk`。
- Produces: 普通修改返回 `action: implement`、`workflow: none`、`finalReview: none`；明确审查和高风险任务保留原有能力。

- [x] **Step 1: 写入用户原句和边界场景的失败测试**

```js
const ordinary = decideTask({text: '不用锁枪，就当普通不合格数据上传就行，只不过显示步骤异常'})
assert.equal(ordinary.action, 'implement')
assert.equal(ordinary.workflow, 'none')
assert.equal(ordinary.finalReview, 'none')
```

- [x] **Step 2: 运行定向测试确认旧行为失败**

Run: `node --test task-decision.test.mjs workflow-model-routing.test.mjs`
Expected: 用户原句仍被判定为 `query`，普通实现仍要求 `balanced` 审查。

- [x] **Step 3: 扩展省略式修改信号并收紧 Workflow 自动触发条件**

```js
const WRITE_SIGNALS = /(?:改成|改为|调整为|设为|显示成|显示为|当作|就当).../i
export function shouldAutoTriggerWorkflow(decision) {
    return decision?.action === 'review' && decision.workflow !== 'none'
}
```

- [x] **Step 4: 运行定向测试确认普通实现与明确审查边界通过**

Run: `node --test task-decision.test.mjs workflow-model-routing.test.mjs`
Expected: 全部通过。

### Task 2: 隔离内部 Workflow 结果与主任务结算

**Files:**
- Modify: `gateway/task-workflow-gate.mjs`
- Test: `gateway/task-workflow-gate.test.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/task-completion.test.mjs`

**Interfaces:**
- Consumes: `taskWorkflowResultIdFromMessage(message)`、延迟的 `primaryResult`。
- Produces: 内部 Workflow 回合只解除等待，原始主结果作为唯一 `primary_result` 进入完成状态机。

- [x] **Step 1: 写入内部结果不能成为新主结果的失败测试**

```js
const result = settleTaskWorkflowResultTurn(gate, 'wf-1')
assert.deepEqual(result, {consumed: true, deferredPrimaryResult: originalPrimary})
```

- [x] **Step 2: 运行门禁和完成状态机测试确认失败**

Run: `node --test task-workflow-gate.test.mjs task-completion.test.mjs`
Expected: 新接口尚不存在或原始主结果未返回。

- [x] **Step 3: 实现原子消费并在 Gateway 接线中跳过内部结果二次结算**

```js
export function settleTaskWorkflowResultTurn(gate, workflowId) {
    const consumed = consumeTaskWorkflowResultTurn(gate, workflowId)
    return {consumed, deferredPrimaryResult: consumed ? takeDeferredPrimaryResult(gate) : null}
}
```

- [x] **Step 4: 运行门禁、完成状态机和 Gateway 接线相关测试**

Run: `node --test task-workflow-gate.test.mjs task-completion.test.mjs workflow-run-state.test.mjs`
Expected: 全部通过，父任务只完成一次。

### Task 3: 定向回归和交付检查

**Files:**
- Verify: `gateway/*.mjs`

**Interfaces:**
- Consumes: 前两项修改后的任务决策和 Workflow 门禁。
- Produces: 与原始失败用例一致的自动化证据，以及 Gateway 无回归证据。

- [x] **Step 1: 运行原始失败用例和相关状态机测试**

Run: `node --test task-decision.test.mjs workflow-model-routing.test.mjs task-workflow-gate.test.mjs task-completion.test.mjs workflow-run-state.test.mjs`
Expected: 全部通过。

- [x] **Step 2: 运行 Gateway 全量测试和语法检查**

Run: `$testFiles = Get-ChildItem -File -Filter *.test.mjs | ForEach-Object { $_.FullName }; node --test $testFiles`
Expected: 零失败。

Run: `node --check index.mjs`
Expected: exit code 0。

- [x] **Step 3: 检查差异、编码和敏感信息**

Run: `git diff --check`
Expected: 无空白错误。

Run: `rg -n "(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*['\"][^'\"]+" gateway docs/superpowers/plans`
Expected: 无新增硬编码凭据。
