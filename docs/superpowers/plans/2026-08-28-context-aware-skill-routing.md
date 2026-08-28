# Context-Aware Skill Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Bridge 先识别并缓存项目架构，再依据当前原始请求和架构事实选择兼容 Skill，避免 Avalonia 项目误注入 Vue/WinForms。

**Architecture:** `ProjectContext` 是结构化架构事实来源，保存在 Bridge 私有缓存中并用受信 Manifest 指纹判断陈旧。Skill Router 只接收原始用户文本、目标文件和有效 ProjectContext，先产生意图候选，再按框架互斥规则过滤；Memory、Pitfall、历史 transcript 和模型扩写文本不参与路由。

**Tech Stack:** Node.js ESM、Node test runner、JSON 私有缓存、现有 Claude Agent SDK options。

**Implementation Status:** 已实现。定向测试与语法检查通过；Gateway 全量测试为 860 项中 857 通过，3 项既有工作区失败与本变更无关，详见最终交付说明。

## Global Constraints

- 不新增依赖、不升级 framework、不覆盖无关 dirty worktree。
- 路由未知架构时宁可少注入，不根据目录名或历史文本猜测框架。
- 日志只记录 Skill 名称、抑制原因和证据摘要，不记录完整用户正文。
- 保留手动 `skillRoute`，但仍过滤不存在或禁用的内置 Skill。

---

### Task 1: ProjectContext 架构识别与陈旧缓存

**Files:**
- Modify: `gateway/projects/project-context.mjs`
- Test: `gateway/projects/project-context.test.mjs`

**Interfaces:**
- `buildProjectContext(workDir, options)` 返回新增 `manifestFingerprint`。
- `loadProjectContext(workDir, options)` 仅返回版本、工作目录和当前 Manifest 指纹均有效的缓存。
- 新增 `loadOrBuildProjectContext(workDir, options)`，优先复用有效缓存，陈旧或缺失时重建。

- [ ] 为 `.csproj` 的 `Avalonia` PackageReference 和 `UseAvalonia` 属性写失败测试。
- [ ] 为 Manifest 路径、size、mtime、sha256 指纹和缓存陈旧重建写失败测试。
- [ ] 实现有界 Manifest 指纹计算；避免读取源码和敏感文件。
- [ ] 实现 Avalonia 框架归一化，保留 WinForms/WPF 识别。
- [ ] 运行 `node --test gateway/projects/project-context.test.mjs`。

### Task 2: Context-aware Skill Router

**Files:**
- Modify: `gateway/agents/skill-router.mjs`
- Test: `gateway/agents/skill-router.test.mjs`

**Interfaces:**
- `routeSkills({text, targetFiles, projectContext, profile, availableSkills})` 返回去重后的 Skill 名称。
- 路由只基于 `text`、`targetFiles` 和结构化 `projectContext`，不读取 `workDir`、Memory 或 transcript。

- [ ] 写 Avalonia 页面任务只选择 `avalonia-ui`，不选择 `vue-frontend` 或 `ui-winforms`。
- [ ] 写否定语义测试：明确“不使用 Vue/WinForms”时抑制对应 Skill。
- [ ] 写未知架构测试：普通“页面/组件/按钮/设备”词不再独立触发框架 Skill。
- [ ] 写框架过滤测试：Vue 项目才允许 `vue-frontend`，WinForms 项目才允许 `ui-winforms`，无上下文不猜测。
- [ ] 实现候选、框架过滤、否定语义和可用 Skill 过滤，并保留数字孪生/协议/数据库等独立路由。
- [ ] 运行 `node --test gateway/agents/skill-router.test.mjs`。

### Task 3: 统一新建与续聊入口

**Files:**
- Modify: `gateway/runtime/query-options-runtime.mjs`
- Modify: `gateway/runtime/task-command-runtime.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs`
- Test: `gateway/runtime/query-option-mappers.test.mjs`, `gateway/runtime/task-command-runtime.test.mjs`

**Interfaces:**
- Query options 和续聊均传递 `projectContext` 与原始 `command.content`，不传拼接后的 Pitfall/Memory 文本作为路由输入。

- [ ] 在 query options 路由前加载或复用有效 ProjectContext。
- [ ] 在 task command 中复用会话 ProjectContext，并只用当前 command.content 路由。
- [ ] 记录 selected/suppressed/evidence 的受限诊断。
- [ ] 运行对应 Runtime 定向测试。

### Task 4: Workflow 和回归验证

**Files:**
- Modify: `gateway/workflows/workflow-runner.mjs`（仅在 workflow agent query 入口需要时）
- Modify: 相关 Workflow 测试
- Create: `docs/architecture/adr-context-aware-skill-routing.md`

**Interfaces:**
- Workflow agent 使用父任务的 `projectContext` 或按 `workDir` 获取有效上下文，保持与普通任务相同的路由规则。

- [ ] 添加 ADR，记录候选方案、取舍、失败恢复和重新评估条件。
- [ ] 验证 Workflow/定时任务不会把历史结果或 Pitfall 重新送入路由器。
- [ ] 运行 Gateway 全量测试、`git diff --check`，并检查工作区只包含本次相关改动。
