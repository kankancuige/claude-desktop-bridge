# ADR 0009：上下文规则分层与内置 Skill 按需准备

**Status:** Accepted
**Date:** 2026-08-18
**Owner:** Claude Desktop Bridge maintainer

## Context

Bridge 使用仓库内 `BRIDGE_RULES.md` 作为所有目标项目的长期规则来源，并通过 `settingSources: []` 隔离用户机器上的 `CLAUDE.md`、`AGENTS.md` 和外部设置。现有文件同时包含跨项目纪律和 Bridge 自身 Vue/Electron/Gateway 约束，导致处理 WinForms、Java 等外部项目时注入无关内容。Codex 全局规则新增数字孪生触发边界后，Bridge 不会自动继承，并且 Bridge 私有的 `BRIDGE_HOME/skills` 中没有对应 Skill。

## Drivers

- 外部项目只接收跨项目长期有效的规则，减少无关上下文和错误技术栈约束。
- 开发 Bridge 本身时仍必须保留 Electron IPC、Gateway 生命周期和桌面状态契约。
- 数字孪生能力必须按明确语义加载，不能因普通 CAD、GLB 或前端任务触发。
- Bridge 的核心能力不能依赖 Codex 安装目录或用户手工同步全局规则。
- 不覆盖用户已有同名 Skill，不新增依赖或公开配置。

## Decision

1. `BRIDGE_RULES.md` 只保存所有目标项目通用的规则；`BRIDGE_PROJECT_RULES.md` 保存 Bridge 仓库专属规则。
2. Gateway 从 `bridge-rules.mjs` 的模块位置解析仓库根目录。只有规范化后的 `workDir` 等于该根目录或位于其子目录时，才追加仓库专属规则；不硬编码本机绝对路径。
3. `applyContextProfile` 显式接收 `workDir`，完整上下文创建和因模型、权限、Skill 变化触发的重建都通过同一 `makeQueryOptions` 路径选择规则。
4. `digital-twin-cad` 由确定性 Skill Router 选择。数字孪生语义必须与 CAD/STEP/GLB、节点或设备映射、遥测状态、URDF/SDF、manifest 等集成语义同时出现；明确的遥测模型状态或 CAD/GLB 节点绑定视为直接证据。
5. `industrial-tightening-solution` 由确定性 Skill Router 选择，覆盖工业拧紧、扭矩校验、工位/追溯、MES/MOM/KMIS、技术方案/协议/招标响应和验收等项目方案语义；普通代码任务不加载它。
6. Bridge 保存内置 `digital-twin-cad/SKILL.md` 与 `industrial-tightening-solution/`（含通用 references）。应用包携带源文件，仅在路由命中且 `BRIDGE_HOME/skills` 不存在同名 Skill 时按需复制；存在同名文件时直接使用且不覆盖。不会写入 Claude/Codex 外部 Skill 目录。准备失败在 Query 创建前明确失败，不允许静默移除 Skill 后继续宣称完成。

## Alternatives

| 方案 | 结论 | 原因 |
|---|---|---|
| 所有内容继续放在一个全局文件 | 拒绝 | 外部项目持续收到 Bridge 自身架构约束 |
| 读取 Codex 全局 `AGENTS.md` | 拒绝 | 破坏 Bridge 独立规则来源和可发布性 |
| 只复制数字孪生规则，不提供 Skill | 拒绝 | 规则要求与运行能力断链 |
| 启动时安装所有内置 Skills | 拒绝 | 增加无关磁盘副作用和上下文管理成本 |
| 条件规则层 + 按需准备内置 Skill | 采用 | 数据所有权明确、行为可测试、对外部项目干扰最小 |

## Failure And Recovery

- `workDir` 缺失、无效或位于其他项目：只注入通用规则，不猜测为 Bridge 仓库。
- 内置 Skill 源文件缺失或目标目录不可写：Query 创建失败并返回明确错误；不降级为无 Skill 执行。
- 用户已有同名 Skill：保留 `BRIDGE_HOME/skills` 中的用户文件，不写备份、不覆盖；用户可通过设置页管理。
- 路由误判：普通 CAD、Viewer 和普通前端反例测试阻止扩大触发范围；调整正则不改变 Session 或 transcript 格式。
- 回滚：恢复单一规则注入和移除数字孪生路由即可；已复制的用户目录 Skill 保留，避免删除用户可能已修改的文件。

## Consequences

- 正面：外部项目上下文更小，Bridge 专属架构约束不再污染其他技术栈。
- 正面：数字孪生规则、路由和可执行 Skill 形成可验证闭环。
- 正面：开发和打包使用同一仓库内 Skill 源，不依赖 Codex 安装状态。
- 负面：规则由一个文件增加为两个文件，修改长期规则时必须判断归属层。
- 负面：首次命中数字孪生任务会向当前用户的 `BRIDGE_HOME/skills` 写入一个文件。

## Validation

- 单元测试覆盖仓库根目录、子目录、相邻项目、空路径和前缀相似路径。
- Skill Router 覆盖数字孪生正例以及普通 CAD、普通 GLB Viewer、普通前端和 Skill 解释反例。
- 内置 Skill 测试覆盖首次安装、重复调用不覆盖、未知 Skill 忽略和源文件有效性。
- Gateway 全量测试、`node --check`、桌面类型检查、Vite build 和 `git diff --check`。
- Runtime smoke：在 Bridge 项目和一个外部项目分别创建完整会话，检查 system prompt 规则层；首次数字孪生任务检查 Skill 文件生成和 SDK `system_init.skills` 可见性。

## Review Triggers

- Bridge 支持多个独立仓库副本或可配置的自开发仓库路径。
- Claude Agent SDK 提供不依赖用户目录的内存 Skill 注册接口。
- 新增 Bridge 内置 Skill，需要统一版本、更新和禁用策略；当前技术方案 Skill 已纳入 manifest、资源健康检查和路由测试。
- 数字孪生路由出现可测量的误触发或漏触发。
