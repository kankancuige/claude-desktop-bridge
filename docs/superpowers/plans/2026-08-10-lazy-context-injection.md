# Lazy Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 Claude 与 Codex 的全局长期规则，并让新会话的简单问答不加载 Claude Code 全量工具、Skills、MCP 和项目动态上下文。

**Architecture:** 新 Session 默认创建 `light` Query，使用最小自定义 system prompt、空工具集、空 Skills、空 setting sources 和 strict MCP。Gateway 在每条用户消息入队前执行确定性分类；一旦出现代码、文件、外部实时信息或执行型任务，Session 单向升级为 `full`，通过现有 Query 重建路径启用完整 Claude Code preset 并继续后续会话。

**Tech Stack:** Node.js ESM、Claude Agent SDK `tools`/`skills`/`settingSources`/`systemPrompt`、Node test runner。

## Global Constraints

- 全局 `CLAUDE.md` 只保留跨项目长期规则，项目/设备约束下沉到最近目录。
- 新 Session 默认轻量；恢复旧 Session、Workflow、定时任务和子 Agent 默认完整上下文。
- `light -> full` 只能单向升级；不在活跃 Session 内自动降级。
- 不新增依赖，不改变桌面端、微信、飞书、钉钉公开消息契约。
- 文件引用、附件、代码块、修改/调试/审查、外部实时信息和高风险请求必须使用完整上下文。

---

### Task 1: Global Claude Guidance

**Files:**
- Modify: `C:/Users/CKD/.claude/CLAUDE.md`

**Interfaces:**
- Consumes: `C:/Users/CKD/.codex/AGENTS.md`
- Produces: Claude Code 全局跨项目规则与上下文纪律

- [x] 将 Codex 的 Scope、Safety、Workflow、Architecture、Verification、Correctness、UI、Protocol、Logging、Task Continuity 规则按 Claude Code 语义迁移。
- [x] 移除固定 150 行、固定 5 文件、强制 Caveman、固定 Agent 派发和工业 monorepo 专属约束。
- [x] 增加简单问答直接回答、Skills 按触发加载、禁止泄漏 system/skill/tool result、模型身份回答实际 runtime model 的规则。
- [x] 检查 UTF-8、尾随空白和凭据模式。

### Task 2: Context Profile Classifier

**Files:**
- Create: `gateway/context-profile.mjs`
- Create: `gateway/context-profile.test.mjs`

**Interfaces:**
- Produces: `classifyContextProfile(text): 'light' | 'full'`、`applyContextProfile(options, profile, model): object`

- [x] 写失败测试：模型身份/问候/短概念为 `light`；代码块、文件引用、修改、调试、审查、实时信息为 `full`。
- [x] 写失败测试：`light` 清空 tools/skills/settingSources/MCP/agents，启用 strict MCP、自定义最小 prompt 和 disabled thinking；`full` 保持原选项。
- [x] 实现确定性分类和选项收敛，不发送用户正文或文件内容给额外分类模型。
- [x] 运行 `node --test gateway/context-profile.test.mjs`。

### Task 3: Gateway One-Way Promotion

**Files:**
- Modify: `gateway/index.mjs`
- Test: `gateway/context-profile.test.mjs`

**Interfaces:**
- Consumes: `classifyContextProfile`、`applyContextProfile`
- Produces: Session `contextProfile` 状态和 `light -> full` Query 重建

- [x] 新建非 resume Session 时传入 `light`；恢复、定时任务和现有内部调用保持 `full`。
- [x] `makeQueryOptions` 在最终组装后应用 profile，并记录 `bridgeContextProfile` 供 Session 状态使用。
- [x] 用户消息入队前分类；需要完整上下文且当前为轻量时，复用设置变更的关闭/懒重建路径。
- [x] 重建时传递 `contextProfile`，升级后不自动降级。

### Task 4: Verification

**Files:**
- Verify: `gateway/*.test.mjs`
- Verify: `desktop-ui`

**Interfaces:**
- Consumes: Tasks 1-3
- Produces: 静态、测试、类型检查、构建和打包证据

- [x] 运行 Context Profile 定向测试和 Gateway 全量测试，要求无 skipped test。
- [x] 运行 Vue 类型检查与 Electron 测试。
- [x] 使用 Node 22.12+ 运行 Windows NSIS `pnpm build`。
- [x] 运行 `git diff --check`，检查安装包内包含最新 Gateway 文件。
- [ ] 真实运行时分别验证“你是什么模型”不调用 Skill，以及复杂代码请求仍可 Read/Edit/Bash；若无真实 Key，明确标记端到端 blocker。
