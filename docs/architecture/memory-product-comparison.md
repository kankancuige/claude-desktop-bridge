# Memory 产品模式对比与 Bridge 取舍

**日期：** 2026-08-18
**证据范围：** 当前 Bridge 工作区，以及本机 `D:/ckd/Projects/src` 中 Claude Code 源码快照。未把第三方宣传页或未验证行为写成事实。

## 三类状态必须分开

| 类型 | 目的 | 事实源 | 进入模型的条件 |
|---|---|---|---|
| 会话正文 | 恢复同一会话的用户/assistant 内容 | Claude transcript JSONL | 显式恢复当前会话 |
| 上下文压缩 | 在同一任务接近窗口上限时保留工作摘要 | transcript 中的压缩结果 | 上下文生命周期触发 |
| 长期 Memory | 跨任务复用稳定约定和已验证事实 | `memory/*.md` | 动作任务关键词匹配或明确 Memory 操作 |

压缩结果不能自动升级为长期 Memory；长期 Memory 也不能替代 transcript 恢复。这样可以避免压缩气泡、跨会话接力和用户偏好互相重复占用 token。

## 已验证的 Claude Code 模式

本地源码显示 Claude Code 的 Agent Memory 具有以下边界：

- `MemoryStep.tsx` 让用户显式选择 `user`、`project`、`local` 或 `none`，推荐作用域随 Agent 所在位置变化。
- `agentMemory.ts` 按 Agent type 隔离目录，对 Windows 不合法的命名空间字符做路径清理，并校验写入路径确实位于 Memory 目录。
- 只有启用 Memory 的 Agent 才将对应 Memory prompt 拼入 system prompt；会话压缩由独立的 `sessionMemoryCompact.ts` 负责。
- Memory 目录创建和文件写入由工具层兜底，作用域和写权限不是依赖提示词自觉维护。

## Bridge 当前能力

| 能力 | 当前实现 | 结论 |
|---|---|---|
| 正文与索引分离 | Markdown 保存用户可编辑副本，PostgreSQL 保存版本化正文、元数据和可选 embedding | 保留 |
| 简单问题零注入 | 只有动作任务或明确 Memory 请求进入召回 | 保留 |
| 有界召回 | 确定性关键词、单文件片段上限、总计 6 KB | 保留，后续用评测调整而非直接上向量库 |
| 来源与新鲜度 | 索引记录 source、hash、lastVerifiedAt、lastUsedAt | 已实现 |
| 用户治理 | 设置页搜索、启停、删除、重建并显示降级模式 | 已实现 |
| 明确记忆操作 | `bridge-memory` Skill 只路由记住/忘记/项目约定 | 已实现 |
| 作用域 | Markdown Memory 当前为项目级；结构化偏好另有 global/project | 不伪装成完整多作用域 Memory |
| Agent 私有 Memory | 尚未按 Agent type 隔离 | 后续仅在实际出现 Agent 间污染时增加 |

## 借鉴与不照搬

优先借鉴：显式作用域、路径所有权校验、Agent 级隔离选项、Memory 与压缩分离、禁用 `none`、可见来源和用户撤销。

暂不照搬：自动保存完整任务摘要、默认加载所有 Memory、向量数据库、云同步和多用户权限。这些功能会扩大敏感数据、依赖和故障面，也不符合当前单机一对一桌面端边界。

## 重新评估触发条件

- 同一项目超过 500 个 Memory 文件，关键词检索的有效命中率低于可接受水平。
- 不同 Agent 反复写入冲突约定，需要 Agent type 隔离。
- 用户明确需要本机全局 Memory 正文，而结构化全局偏好无法覆盖。
- 需要跨设备同步；届时必须先定义端到端加密、冲突合并、删除传播和恢复策略。

## PostgreSQL/pgvector 边界（2026-08-23）

pgvector 适合解决“Memory 数量大、关键词命中不足”的语义召回问题。当前 Bridge 的任务状态、会话索引、IM outbox、用量事件和 Memory 均由 PostgreSQL 统一承载；Markdown、transcript、规则和 Skill 仍保留用户可编辑或 SDK 兼容副本。

Memory 使用 PostgreSQL 关键词索引，并在 embedding provider 和向量列可用时启用 pgvector 语义召回；连接或 provider 不可用时明确报告 degraded，不切换到第二种结构化数据库。
