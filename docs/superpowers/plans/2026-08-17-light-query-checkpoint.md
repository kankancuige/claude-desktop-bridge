# 轻量问答跳过文件快照 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `light + query` 任务保持正常回合、IM 通知和终态收口，但不执行无意义的全项目文件快照与 checkpoint 扫描。

**Architecture:** 任务决策层输出的 `action` 与 `contextProfile` 作为唯一策略输入。Gateway 仍为每个回合创建 `pendingTurn`，以保留排队、停止和收口顺序；新增 `captureFiles` 标记，仅对需要文件状态追踪的回合异步构建快照。轻量问答在开始和结束阶段都跳过快照 fallback，普通实现、附件、inspect、review、operate 和未知决策继续保留原有 checkpoint 行为。

**Tech Stack:** Node.js ESM、`node:test`、Gateway Session 回合队列与文件快照。

## Global Constraints

- Light 与 Balanced 暂时可配置为同一个 `gpt-5.6-terra`，本次不修改模型映射。
- 不新增依赖，不提交或推送，不覆盖已有 dirty worktree 修改。
- 只优化 `light + query` 的文件追踪，不改变模型路由、IM 完成通知、任务终态或会话恢复语义。
- 文件读写、checkpoint 和队列状态必须保持可观察且可释放；未知或缺失任务决策默认捕获文件状态。

---

### Task 1: 建立回合文件追踪策略

**Files:**
- Create: `gateway/tasks/turn-checkpoint-policy.mjs`
- Test: `gateway/tasks/turn-checkpoint-policy.test.mjs`

**Interfaces:**
- Consumes: `decideTask()` 返回的任务决策对象。
- Produces: `shouldCaptureTurnCheckpoint(decision)`，返回布尔值。

- [x] **Step 1: 写入失败测试**

```js
assert.equal(shouldCaptureTurnCheckpoint({action: 'query', contextProfile: 'light'}), false)
assert.equal(shouldCaptureTurnCheckpoint({action: 'implement', contextProfile: 'full'}), true)
assert.equal(shouldCaptureTurnCheckpoint({action: 'query', contextProfile: 'focused'}), true)
assert.equal(shouldCaptureTurnCheckpoint(null), true)
```

- [x] **Step 2: 写入实现前失败断言并在实现后复验**

Run: `node --test gateway/tasks/turn-checkpoint-policy.test.mjs`

实现前该断言应失败；本轮实现后使用同一命令复验为 PASS。

- [x] **Step 3: 实现最小策略函数**

```js
export function shouldCaptureTurnCheckpoint(decision) {
    return !(decision?.action === 'query' && decision?.contextProfile === 'light')
}
```

- [x] **Step 4: 运行策略测试确认通过**

Run: `node --test gateway/tasks/turn-checkpoint-policy.test.mjs`

Expected: PASS。

### Task 2: 将策略接入回合队列和 checkpoint 收口

**Files:**
- Modify: `gateway/index.mjs:10078-10170`
- Modify: `gateway/index.mjs:8563`
- Test: `gateway/tasks/turn-checkpoint-policy.test.mjs`

**Interfaces:**
- Consumes: `shouldCaptureTurnCheckpoint(decision)`。
- Produces: `beginTurn(sessionId, prompt, {captureFiles})`；回合对象保存 `captureFiles`，不捕获回合仍会正常推进 pending 队列。

- [x] **Step 1: 增加接线断言并保留普通任务行为**

验证 Gateway 源码从 task decision 计算 `captureFiles` 并传入 `beginTurn`；普通实现不能传入 false。

- [x] **Step 2: 修改 beginTurn、queued snapshot 和 advancePendingTurn**

轻量回合不调度 `buildFileSnapshot`；队列推进时只有 `captureFiles === true` 的回合调度快照。

- [x] **Step 3: 修改 finalizeCheckpoint fallback**

对 `captureFiles === false` 的当前回合先 `advancePendingTurn()`，记录日志并返回 `null`，禁止任何同步 fallback snapshot 或文件扫描。

- [x] **Step 4: 运行定向策略与 Gateway 语法测试**

Run: `node --test gateway/tasks/turn-checkpoint-policy.test.mjs`

Run: `node --check gateway/index.mjs`

Expected: PASS，且 Gateway 语法检查成功。

### Task 3: 全量回归和失败路径验证

**Files:**
- Verify: `gateway/index.mjs`, `gateway/tasks/turn-checkpoint-policy.mjs`, `gateway/tasks/turn-checkpoint-policy.test.mjs`

- [x] **Step 1: 运行全量 Node 测试**

Run: `node --test`

Expected: 零失败。

- [x] **Step 2: 检查工作区差异**

Run: `git diff --check`

Expected: 无空白或编码错误。

- [x] **Step 3: 检查变更范围和未提交文件**

Run: `git status --short`

确认上一任务的三处 dirty worktree 修改仍保留，且没有提交或推送。

---
