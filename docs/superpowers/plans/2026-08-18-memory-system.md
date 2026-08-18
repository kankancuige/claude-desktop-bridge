# Memory System Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Bridge 记忆从“手工 Markdown + 少量固定偏好”升级为有作用域、来源、验证时间、检索上限和用户确认边界的可控记忆系统。

**Architecture:** Markdown 仍是用户编辑的项目知识正文，SQLite 只保存可重建索引。结构化偏好继续经过候选检测和用户确认。任务进入 SDK 前只召回与当前任务关键词高度相关、数量和字符数有上限的记忆；简单问答不召回，明确冲突和“不记住”优先。

**Tech Stack:** Node.js ESM、现有 preference service、SQLite memory index、Claude Agent SDK Skill routing、Vue Settings memory panel。

## Global Constraints

- 不把完整 transcript、API Key、token、工具输出或敏感原文自动写入 Memory。
- 不因“记忆”二字出现在普通问题中就加载 Skill 或注入历史。
- 用户可以查看、编辑、禁用、删除和撤销自动产生的记忆。
- 每条自动召回必须带来源文件和最近验证时间；过期记忆只能作为低优先级候选。

### Task 1: Memory contract and index

**Files:**
- Create: `gateway/context/memory-service.mjs`
- Test: `gateway/context/memory-service.test.mjs`
- Modify: `gateway/storage/memory-index.mjs`

- [x] Define record fields `id`, `scope`, `projectKey`, `sourcePath`, `title`, `keywords`, `confidence`, `status`, `lastVerifiedAt`, `expiresAt`.
- [x] Implement deterministic project-scoped keyword retrieval, explicit conflict filtering and a 6 KB UTF-8 byte budget; global constraints remain in confirmed preferences.
- [x] Implement `refreshProject`, `list`, `search`, `markUsed`, `disable`, `remove` and `rebuild` with no full-text database copy.
- [x] Test no injection for light/query-only prompts, explicit conflict, disabled/deleted records and project isolation.

### Task 2: Memory-aware prompt boundary

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/context/context-profile.mjs`
- Test: `gateway/context/memory-service.test.mjs`

- [x] Refresh only the current project's Memory index before an action task or explicit memory request.
- [x] Inject a compact `<bridge-memory>` block before the user message while preserving confirmed preferences and the original user text boundary.
- [x] Record only non-sensitive Memory counts/reasons; do not expose hidden content in activity events.
- [x] Record retrieval reasons in structured logs without prompt text.

### Task 3: Built-in memory Skill

**Files:**
- Create: `gateway/agents/builtin-skills/bridge-memory/SKILL.md`
- Modify: `gateway/agents/skill-router.mjs`
- Test: `gateway/agents/skill-router.test.mjs`

- [x] Route only explicit memory/remember/project-convention requests and not generic code tasks.
- [x] Instruct the Agent to inspect existing Memory, write concise durable facts, include source and verification date, avoid secrets, and ask before changing global memory.
- [x] Add tests for explanation-only, unrelated code, explicit remember and explicit forget signals.

### Task 4: Memory UI and governance

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `desktop-ui/src/i18n.ts`
- Test: desktop UI tests/build

- [x] Add list/search/disable/delete/rebuild API responses with stable error codes.
- [x] Show scope, source, confidence, last verified and status in Settings; do not require opening every file to understand why it was recalled.
- [x] Preserve the existing “仅本次/项目/全局/不记住” preference-candidate decision flow.
- [x] Validate memory files with UTF-8, size limits and safe relative paths.
- [x] Run desktop tests and production build.
- [ ] 含真实 Memory 行的 Gateway + Electron runtime smoke 尚未执行；当前仅验证了 1280x720 的 Gateway 不可用/空状态。

## Acceptance

- Simple questions receive no Memory injection.
- Action tasks receive at most 6 KB of relevant, non-conflicting Memory.
- Every recalled item is inspectable and reversible.
- Deleted or disabled Memory is not recalled after restart.
