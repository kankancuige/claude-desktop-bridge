# Memory Automatic Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将明确用户约定接入成功任务收口，自动产生可审查的 Memory candidate，并保持 PostgreSQL 唯一结构化主存储和安全审批边界。

**Architecture:** 自动捕获只解析用户原始请求中的高置信记忆表达，不从普通最终回复推断事实。成功任务完成后调用 Memory Candidate Store 写入 PostgreSQL `content_documents` 的 `candidate` 状态；候选按项目和内容稳定去重，只有显式审批才变为 `active`，失败/暂停任务不产生候选。

**Tech Stack:** Node.js ESM、Node `node:test`、PostgreSQL Repository-only Memory。

## Global Constraints

- 不新增依赖，不改变现有 HTTP 契约，不提交或推送。
- 不把完整 transcript、凭据、token、绝对路径或普通模型猜测写入 Memory。
- PostgreSQL 是唯一结构化 Memory 主存储；Markdown 仅作为用户编辑/SDK 兼容副本。
- 自动捕获失败不得使已成功任务降级；必须记录可诊断日志。

---

### Task 1: 自动捕获规则

**Files:**
- Create: `gateway/context/memory-auto-capture.mjs`
- Create: `gateway/context/memory-auto-capture.test.mjs`

**Interfaces:**
- `extractAutomaticMemoryFacts({requestText, taskId, projectKey}) -> Array<{summary, verified, evidence, capture}>`

- [x] 覆盖明确记忆表达、项目约定、普通对话排除、拒绝记忆和长度/凭据脱敏。
- [x] 实现有界、确定性解析，不读取文件、不调用外部模型。

### Task 2: Candidate 稳定去重

**Files:**
- Modify: `gateway/context/memory-candidate.mjs`
- Modify: `gateway/context/memory-candidate.test.mjs`

- [x] Candidate ID 改为项目+规范化摘要稳定 hash，重复会话更新同一 candidate。
- [x] 保留 candidate -> active 的显式审批和证据要求。

### Task 3: 成功收口自动接线

**Files:**
- Modify: `gateway/runtime/task-completion-effects-runtime.mjs`
- Modify: `gateway/runtime/task-completion-effects-runtime.test.mjs`
- Create: `gateway/runtime/memory-auto-capture-runtime.mjs`
- Create: `gateway/runtime/memory-auto-capture-runtime.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`

- [x] 仅 `complete` effect 且 Coordinator 状态为 `completed` 时自动捕获。
- [x] 失败、暂停、验证不足不捕获；捕获异常不改变任务终态。
- [x] 使用项目 key 和 task ID 作为证据边界，调用 PostgreSQL-backed Candidate Store。
- [x] 通过 `captureAutomaticMemory` 端口注入，完成运行时不直接依赖 Memory/Storage 实现。

### Task 4: 文档与验收

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/memory-product-comparison.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `TASK_STATE.md`

- [x] 说明自动沉淀触发条件、候选审批和会话成长边界。
- [x] 运行定向测试、Gateway 全量测试、源码语法检查和 `git diff --check`。
