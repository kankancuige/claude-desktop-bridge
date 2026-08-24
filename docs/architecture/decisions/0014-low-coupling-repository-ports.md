# ADR 0014：以领域 Repository Port 收敛 PostgreSQL 访问

## 背景

PostgreSQL 已是唯一结构化运行时入口，但组合根和业务服务仍可直接接触 `PostgresStateCompat` 或内容存储对象。一次性拆分 `gateway/index.mjs` 会扩大回归面，也难以为 Session、Task、IM 和 Pitfall 建立可验证的迁移边界。

## 决策

1. `StorageGateway` 负责连接、事务、健康检查和 Repository 组装；业务服务通过领域 port 访问数据。
2. Memory 和 Transcript 先使用独立 Repository，隐藏 `content_kind`、SQL 参数和表名；旧 `content` 属性保留为迁移兼容入口。
3. Workbench 健康、任务、报告、项目和 Pitfall 查询先迁移为依赖注入的 HTTP route handler；鉴权和生命周期仍由 Gateway 组合根负责。
4. `PostgresStateCompat` 只作为 Session/Task/IM/Pitfall 迁移期间的适配器，不新增依赖它的业务服务；每迁移一个领域必须有 port contract、wiring test 和全量回归证据。
5. Transcript 正文在 PostgreSQL 中版本化保存，但 Claude SDK 继续使用受控 JSONL 路径；缺失文件时采用 hash 校验、临时文件和原子 rename 物化，失败不覆盖现有文件。

## 取舍

- 优点：领域方法、错误边界和数据所有权可独立测试；HTTP/Session 拆分可以按路由组渐进发布；回滚只需撤销 wiring，不需要恢复第二数据库。
- 代价：迁移期间同时存在 Repository 和兼容入口；必须监控旧入口调用量，直到 Session、Project、Workbench、Pitfall 和 IM 全部迁移。
- 不接受：为避免重构而重新引入 SQLite、JSONL 结构化事实源或无界 SQL 查询。

## 验证与重新评估

- 当前已验证：Memory 回填、质量门禁、Memory/Transcript Repository、Workbench route、transcript 物化、PostgreSQL 超时/事务/断线重连单测，以及仓库根目录执行的 Gateway `543/543` 全量测试。
- 尚未验证：真实 PostgreSQL 主库断线、`pg_dump` 临时库恢复、真实 embedding endpoint/质量数据集、SDK 重启后从数据库物化 transcript 的端到端 resume，以及 Session/IM/Pitfall 领域完全脱离兼容层。
- 当 `PostgresStateCompat` 的生产调用量降为零、真实备份恢复和 SDK resume smoke 通过时，重新评估并删除兼容入口。
