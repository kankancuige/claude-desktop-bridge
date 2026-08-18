# Architecture Decision Record

**Verdict:** RECORDED
**Artifact:** `docs/architecture/decisions/0011-operational-sqlite-and-memory-index.md`
**Decision status:** Accepted
**Date:** 2026-08-18

## Decision captured

Bridge 采用一个位于 `BRIDGE_HOME/bridge-state.db` 的 SQLite 运行状态库，但只保存需要原子更新、去重、重试或检索的派生数据：IM inbox/outbox、消息去重、会话索引和 Memory 文件索引。Rules、Skills、Agents、Hooks、MCP、Provider 配置继续使用 Markdown/JSON/脚本；Claude SDK transcript 和 Bridge Session Event Journal 继续使用 JSONL，仍是正文和任务事实源。

SQLite 在 Electron 42 使用内置 `node:sqlite`，Node 20 独立运行时按需加载 optional `better-sqlite3`；两条路径都启用 WAL、外键、busy timeout 和 schema version。数据库不可用时保留现有文件实现作为明确降级路径并记录告警；确认损坏时先隔离为 `.corrupt-<timestamp>`，不覆盖原文件。迁移采用双读/惰性导入，不删除旧 JSON，只有运行状态成功写入 SQLite 后才确认新状态。

## Context and drivers

- IM inbox/outbox 当前每次状态变化都重写整个 JSON 文件，分别有 10,000 和 2,000 条容量上限；可靠领取、去重和重试需要原子状态转换。
- 项目会话列表和 Memory 文件目前依赖目录扫描，规模增加后打开项目和设置页会重复读取目录与 transcript。
- Markdown Memory 需要保留人工编辑、Git diff 和可恢复性，不能把数据库当作唯一正文源。
- 单机桌面端仍只有一个 Gateway，不能为了数据库引入服务端、云同步或多用户架构。
- 数据库文件包含运行状态和派生索引，不自动获得加密能力；IM payload 继续使用现有加密 codec，凭据继续由 safeStorage/安全载荷密钥保护。

## Alternatives and consequences

| 方案 | 结论 | 主要取舍 |
|---|---|---|
| 全部继续使用 JSON/JSONL | 不采用 | 可读性好，但 inbox/outbox 全文件重写、并发和索引性能会继续恶化 |
| 所有配置与 transcript 迁入 SQLite | 不采用 | 破坏 SDK 契约、人工编辑和现有恢复路径，形成第二正文事实源 |
| SQLite 只保存运行状态和可重建索引 | 采用 | 增加 native 依赖和迁移维护，但保持配置/正文边界，支持事务、唯一约束和检索 |
| 独立数据库服务 | 不采用 | 超出单机 Bridge 边界，增加部署、凭据和故障面 |

## Memory model

- `memory/*.md`：用户可读的项目知识正文，来源和最终编辑权属于用户。
- `bridge_memory_index`：文件路径、内容哈希、标题、关键词、mtime、大小、状态、作用域、置信度、验证和最近使用时间等可重建元数据，不保存全文。
- `bridge-preferences.json`：现有用户确认偏好继续作为规则事实源；候选仍需跨任务重复出现并经用户确认。
- 会话接力：继续从 transcript 派生有界上下文，不自动把所有历史注入新问题。
- 内置 `bridge-memory` Skill：只在明确记忆/沉淀/项目约定任务中加载，要求记录来源、验证时间、作用域和禁止保存凭据。

## Review triggers and risks

- `bridge-state.db` 持续超过 50 MB、WAL 长期不回收、或数据库加载失败率超过 0.1% 时，需要复核 checkpoint、压缩和备份策略。
- IM 需要跨进程多写入者时，当前单 Gateway 假设不再成立，必须补充锁、租约和多实例测试。
- 如果用户要求跨设备同步或全文语义检索，需另行评估加密同步和向量索引，不得直接扩展当前 SQLite 表。
- SQLite 降级到文件模式时，必须暴露 `state_store_mode` 和告警，不能静默宣称已使用数据库。

## Links

- `docs/architecture/target-design.md`
- `docs/architecture/migration-plan.md`
- `docs/superpowers/plans/2026-08-18-operational-sqlite.md`
- `docs/superpowers/plans/2026-08-18-memory-system.md`
- `docs/architecture/memory-product-comparison.md`
