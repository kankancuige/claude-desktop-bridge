# 会话恢复与异常提示架构基线

Checklist: 29/29 complete
Incomplete: None

**Verdict:** READY
**观察日期:** 2026-08-12
**范围:** 桌面工作区、Gateway 会话、Claude SDK transcript、本地 API/WebSocket 错误提示

## 业务目标与边界

- 主要用户是单机桌面用户；同一桌面进程可同时打开多个项目/会话，并接收微信、飞书、钉钉消息。
- 已接受的用户消息和 AI 正文在应用重启后必须可查询，并能使用原 SDK conversation ID 继续后续回合。
- “暂停”表示取消当前生成，不承诺恢复进程栈、未完成工具调用或正在运行的第三方副作用。
- 关闭项目页签不得删除 transcript；只有显式删除会话才允许删除持久化记录。
- 本次不新增云端同步、数据库或跨设备漫游，不改变 IM 注入/完成通知契约。
- 同一项目的新会话默认保持干净；只有用户显式分支，或首条消息是明确引用上一任务的短句时，才允许继承旧会话上下文。

## 关键质量场景

| 场景 | 目标/不变量 | 证据状态 | 来源与复核触发条件 |
|---|---|---|---|
| 已接受回合恢复 | 重启后从同一 SDK conversation ID 恢复；找不到 transcript 时明确失败，不静默新建 | DRIVER / CONFIRMED | 用户要求；`gateway/index.mjs`；resume 契约变化时复核 |
| 中断草稿恢复 | 暂停或异常断开后的用户原文 1 秒内写入本地草稿；重开同一历史会话可恢复 | DRIVER / ASSUMED | 用户要求；浏览器存储不可用时降级并提示 |
| 错误可见性 | 用户操作失败 1 秒内提示；Gateway 断开首次提示、恢复后提示；后台轮询错误去重 | DRIVER / CONFIRMED | 用户要求；新增轮询或 API 时复核 |
| 数据安全 | API Key/token 不进入错误提示、草稿或普通日志 | DRIVER / CONFIRMED | 全局规则；认证/日志实现变化时复核 |
| 多标签并发 | 每个 tab 的 session、WebSocket、草稿和错误归属不得串台 | DRIVER / CONFIRMED | 当前多 tab 实现；状态容器变化时复核 |
| 恢复时间 | 本地 transcript 列表和正文加载不引入额外网络依赖；Gateway 重连退避上限 30 秒 | SUPPORTING / ASSUMED | 当前实现；实测超过 2 秒时采样优化 |
| 数据保留 | transcript 沿用 Claude SDK 的本地保留策略；本地草稿限制数量、长度和保留期 | SUPPORTING / ASSUMED | 无产品保留期要求；出现磁盘/隐私要求时复核 |
| 跨会话接力 | 显式分支继承完整 transcript；空白新会话只在首条引用性短句时读取最近有效主会话，注入文本不超过 6 KB | DRIVER / CONFIRMED | 用户要求；引用分类或 SDK fork 契约变化时复核 |
| 上下文隔离 | 普通新问题不得自动注入旧 transcript；agent/workflow/单轮断裂会话不得成为接力来源 | DRIVER / CONFIRMED | 用户此前要求减少无关注入；项目列表过滤规则变化时复核 |
| 统一任务入口 | desktop、wechat、feishu、dingtalk 和内部 Workflow 的任务接收必须共享校验、去重、排队、模型路由和停止语义 | DRIVER / CONFIRMED | 用户要求；新增入口或任务协议变化时复核 |
| Bridge 事件恢复 | 已接受任务在 100ms 内写入不含正文的连续事件日志；强制重启后能投影最后任务状态 | DRIVER / ASSUMED | 本阶段目标；完成 crash smoke 后升级证据 |
| Agent 能力协商 | 必需能力不满足时在 SDK query 启动前失败，不允许接受后忽略或静默降级 | DRIVER / CONFIRMED | 用户此前遇到 Agent 只分析不修改；新增 Provider 时复核 |
| Provider 释放 | Gateway shutdown 后 Provider、observer、timer 和子进程必须在 2.2s 总关闭窗口内进入释放流程 | DRIVER / ASSUMED | 当前 shutdown 上限；增加长驻 Provider 时复核 |

## 数据语义与恢复

- `~/.claude/projects/<encoded>/*.jsonl` 是会话正文 system of record。
- `bridge-session-map.json` 只保存 Gateway ID 与 SDK conversation ID 映射，不替代 transcript。
- 恢复目标通过校验后必须在返回成功前写入 runtime identity，并尝试同步持久化映射；不得等待下一条 `system/init` 才建立身份。
- 跨会话接力只从现有 transcript 派生有界只读上下文，不建立第二份会话正文存储。
- 工作区 shell 只保存项目/tab/session 描述；中断草稿单独保存，禁止保存 token、WebSocket、`File`、权限确认对象。
- 已收到 `message_accepted` 但尚未形成 SDK transcript 的回合可能在强制崩溃时丢失；客户端保留原文草稿用于人工重发，不自动重复执行可能有副作用的工具调用。
- RPO：已完成回合为 0；中断回合允许丢失未被 SDK 持久化的执行进度，但用户原文目标 RPO 不超过 1 秒。RTO：本地 Gateway 可用后由用户打开会话立即恢复。

## 安全、运维与约束

- 不新增依赖，不改变 `127.0.0.1:3456` 信任边界和 `x-bridge-token` 认证。
- 错误提示只能显示稳定错误码、HTTP 状态和脱敏说明，不显示 secret、请求 body 或堆栈。
- 后台轮询采用去重/限频提示；用户触发的保存、恢复、发送、停止必须逐次给出结果。
- 当前单机负载没有可信生产指标；设计按最多数十个打开 tab、数百个本地 transcript 工作，超过该量级后以扫描延迟和存储占用重新评估。
