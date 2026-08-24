# ADR 0013：PostgreSQL 结构化主库与 pgvector Memory

**状态：** Accepted（迁移目标；分阶段启用）
**日期：** 2026-08-23

## 背景

当前 Bridge 是本地单用户桌面应用。Memory 保留用户可编辑的 `memory/*.md` 副本，PostgreSQL 统一承载任务状态、会话索引、IM 队列、Workbench 投影和 Memory 索引，避免业务代码散落在多个结构化存储入口。

## 决策

1. PostgreSQL 是迁移后的唯一结构化运行态主库，承载任务状态、会话索引、IM inbox/outbox、Workbench 投影、Memory 元数据/embedding、Pitfall、执行报告、验证活动和 model usage。
2. 业务层只依赖统一 `StorageGateway`，不直接访问 PostgreSQL client 或 JSON 状态文件；Gateway 可以把 Markdown/JSONL 内容作为版本化记录保存到 PostgreSQL。
3. Markdown 和 JSONL 的格式、版本与 hash 保留；Markdown 仍可导出为用户可编辑文件，JSONL 仍可按 Claude SDK 要求物化为受控 transcript 文件，因为删除文件适配前会破坏会话恢复。
4. PostgreSQL-only 是当前运行时边界；旧迁移材料不参与启动、读写或 fallback。
5. pgvector、embedding provider、加密、删除传播、备份恢复和迁移回滚必须独立验收后才能启用语义检索。
6. PostgreSQL 连接和 embedding 选项统一读取 `BRIDGE_HOME/storage-config.json`；环境变量只作为显式覆盖，配置文件缺失或损坏时拒绝启动。

## 取舍

| 方案 | 结论 | 原因 |
|---|---|---|
| 全部结构化状态迁移 PostgreSQL | 采用为目标 | 统一业务入口和事务边界，减少多套结构化事实源；需要服务健康检查、备份和迁移回滚 |
| 仅 Memory 索引/embedding 使用 pgvector | 不作为最终结构 | 会继续保留 SQLite 运行态，短期可过渡但长期入口仍分裂 |
| 直接在 SQLite 中保存向量 | 不采用 | 缺乏可靠语义检索扩展，且不能解决全局结构化状态多入口问题 |

## 接口与失败恢复

`createStorageGateway()` 返回 `mode`、`db`、`transaction`、`health`、`content` 和 `close`；Memory、任务、会话、队列、报告、Markdown 和 JSONL 均从此入口访问。`BridgeMemoryService` 继续负责脱敏、作用域和 6 KB 注入上限；PostgreSQL 保存结构化状态、受控内容版本和可选 embedding。

- PostgreSQL-only：健康检查、schema 初始化、事务和状态投影均通过 StorageGateway；配置或连接失败时阻止启动，不维护两个并列写入事实源。
- 向量索引不可用：Memory 回退到 PostgreSQL 关键词索引；不得伪造 cache hit、相似度或免费计费结论。
- 删除或禁用 Memory：先更新 Markdown 正文，再在 PostgreSQL 事务中更新索引/向量；传播失败保持可重试状态，不删除唯一正文。

## 重新评估触发条件

- PostgreSQL 主库冷启动、重启、断线恢复和事务回滚已通过真实验收。
- 单项目 Memory 超过 500 个文件，关键词召回评测低于目标。
- 已确定 embedding provider、维度、成本、隐私和本地部署方式。
- 完成 PostgreSQL 备份恢复、断线重连、删除传播、迁移回滚和冷启动验收。
