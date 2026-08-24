# Architecture Diagram Skills Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将 `ln-75-architecture-diagram-builder` 与 `diagram-design` 接入 Bridge 的可版本化内置 Skill 资源和任务路由。

**Architecture:** 两个 Skill 作为 Bridge 私有 `builtin-resources/skills` 的独立资源，由 manifest 管理安装、校验、启停和用户定制保护。Skill Router 只在明确的架构图、系统图、流程图、时序图、Mermaid/draw.io 或 diagram-design 任务中加载，普通架构讨论和 Skill 解释不自动加载。

**Tech Stack:** Markdown Skill、Node.js ESM、Node test、Bridge builtin resource manifest。

## Global Constraints

- 不修改 Claude/Codex 全局 Skill 目录。
- 不覆盖用户已经定制的 Bridge 私有 Skill。
- 不把架构图 Skill 用于架构审计、普通 UI 设计或没有图表交付物的解释任务。
- 不新增 npm 依赖。

### Task 1: 内置资源

- [x] 从当前已安装版本导入 `ln-75-architecture-diagram-builder`，从 `cathrynlavery/diagram-design` 对应内容导入 `diagram-design`。
- [x] 在 `gateway/builtin-resources/manifest.json` 注册两个可启停 Skill。

### Task 2: 路由与测试

- [x] 增加明确架构图/diagram-design 关键词路由。
- [x] 增加路由测试，覆盖架构图任务、Mermaid/draw.io、普通架构解释和 Skill 解释不误加载。
- [x] 增加内置资源安装测试断言。

### Task 3: 验证

- [x] 运行资源检查、定向测试、语法检查和 `git diff --check`。
