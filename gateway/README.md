# Gateway 模块边界

`index.mjs` 是唯一组合根和兼容启动入口。Gateway 保持单进程 modular monolith，不按目录拆成独立服务。

| 目录 | 职责 |
|---|---|
| `shared/` | 日志、文本分片、内部客户端和无领域状态的基础能力 |
| `security/` | 路径、URL、WebSocket、配置脱敏和安全载荷边界 |
| `providers/` | Provider registry、上游代理和协议转换 |
| `sessions/` | Session 身份、runtime、历史、journal、可见性和停止 |
| `projects/` | 项目缓存、transcript 定位/分类和跨会话接力 |
| `tasks/` | 任务命令、决策、状态、生命周期、模型路由和完成门禁 |
| `agents/` | Agent 能力、运行元数据、工具生命周期和 Skill 路由 |
| `workflows/` | Workflow 脚本、运行状态、子进程和最终审查编排 |
| `im/` | 微信、飞书、钉钉适配器、IM 命令、进度和通知投递 |
| `context/` | Bridge 规则、上下文档位、压缩生命周期和结构化偏好 |
| `tools/` | 附件、上传和 RTK 支持 |
| `smoke/` | 需要显式环境开关、不会随应用打包的人工运行验证 |

依赖方向为 `index.mjs -> 领域目录 -> shared/security`。`shared/` 不得反向依赖领域目录；IM adapter 不直接修改 Session 内部状态；Workflow 不解释 HTTP、WebSocket 或 IM 协议。测试与被测源码放在同一目录。
