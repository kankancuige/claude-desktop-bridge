# ADR 0010：Bridge 私有配置根目录

**Status:** Accepted
**Date:** 2026-08-18
**Owner:** Claude Desktop Bridge maintainer

## Context

Bridge 已拥有自己的任务、规则和 IM 流程，但 Rule、Skill、MCP、Agent、Hook、Workflow、会话及 SDK transcript 仍与 Claude Code 共用 `~/.claude`。这会造成设置互相污染、供应商配置被外部工具改写，并且无法证明 Bridge 的行为只由自身配置决定。用户明确要求这些能力完全独立于 Claude 和 Codex 配置。

## Drivers

- Bridge 的正常运行不得依赖或修改 Claude/Codex 的用户配置。
- 现有会话、IM 配对、供应商和自定义能力不能因迁移丢失。
- 迁移必须幂等、非破坏、可重试，且不得覆盖已存在的新目录文件。
- 配置资产需保持可读、可编辑和可备份；当前单机规模没有证据支持引入 SQLite。
- Claude Agent SDK 可继续作为执行引擎，但其本地文件必须归入 Bridge 根目录。

## Considered options

1. **维持 `~/.claude` 共用目录。** 改动最小，但无法满足配置独立和污染隔离。
2. **所有数据迁入 SQLite。** 可增强事务和查询，但不适合 Markdown Skill/Rule 与 Hook 脚本，并增加 native dependency、打包和恢复成本。
3. **Bridge 私有文件根目录并显式约束 SDK。** 保持现有格式，通过统一路径模块和 `CLAUDE_CONFIG_DIR` 隔离所有读写；首次启动复制旧数据。

## Decision

采用方案 3：默认根目录为 `~/.claude-desktop-bridge`，可由绝对路径 `BRIDGE_HOME` 覆盖。Gateway、Electron、IM、Workflow 和项目扫描只使用该根目录；SDK Runtime 显式设置 `CLAUDE_CONFIG_DIR` 为同一路径。完整会话允许 SDK读取该私有目录的 `user` setting source，使自定义 Rules/Hooks 真正生效；focused/light 仍保持隔离。

首次迁移只复制已知文件与目录，目标存在时跳过，源数据永不删除。迁移清单记录成功、跳过和失败项，失败项在后续启动重试。迁移完成后的业务代码不得包含 `~/.claude` 或 `~/.codex` 回退读取。

## Consequences

- 正面：Bridge 配置、会话和 IM 状态不再被 Claude/Codex 工具修改；Rules/Hooks 管理和执行形成闭环。
- 负面：首次迁移可能复制较大的 `projects/`，需要记录耗时和失败；旧数据会暂时占用额外磁盘。
- 中性：Claude Agent SDK 和 Claude Code executable 仍是执行依赖，但不再拥有 Bridge 配置数据。
- 已接受风险：本阶段仍使用文件扫描；达到数千会话、IM 投递要求跨文件事务或实测加载超标时重新评估 SQLite 状态库。

## Validation

- 单元测试覆盖根目录解析、绝对路径校验、幂等迁移、目标不覆盖和失败重试。
- 静态门禁确认产品代码不再自行拼接 `~/.claude`/`~/.codex`。
- Query option 测试确认 `CLAUDE_CONFIG_DIR` 与 Bridge 根目录一致，完整/轻量 setting source 边界正确。
- 运行 smoke 覆盖旧目录迁移、新会话 transcript、新增 Skill/Rule/Hook 和 IM 配对重启恢复。

## Review triggers

- Claude Agent SDK 取消或改变 `CLAUDE_CONFIG_DIR` 行为。
- 单项目 transcript 扫描超过 2 秒，或本地会话数量超过 1,000。
- IM 去重、outbox 与任务 journal 需要跨文件原子事务。
- 产品决定替换 Claude Agent SDK 执行 Provider。
