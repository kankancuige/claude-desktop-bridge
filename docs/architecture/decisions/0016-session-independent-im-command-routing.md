# ADR 0016: IM 命令与当前 Session 解耦

## 状态

已接受，2026-08-27。

## 背景

微信、飞书和钉钉 adapter 已在命令识别前完成用户配对，但共用命令引擎仍对除帮助外的所有命令调用 `/api/sessions/resolve`。这让 `/p`、`/ss`、`/i`、项目切换和新建会话形成循环依赖：用户需要先打开 Session 才能执行本应用来选择或创建 Session 的命令。实际失败表现为命令已被识别，但目标 handler 未执行并返回“尚无活跃 Session”。

当前 Bridge 是本地单用户桌面应用。已配对用户可以控制同一桌面，但普通对话、停止、镜像和历史正文仍必须归属到明确 Session 或项目。

## 候选方案

1. 保持所有命令先绑定 Session：安全边界最简单，但项目选择和新建命令在无 Session 时不可用，不能满足命令契约。
2. 恢复“最近活跃用户/Session”回退：兼容旧体验，但会猜测接收人和目标 Session，存在串发、串操作风险。
3. 分离配对身份、目录访问和 Session ownership：目录及桌面导航依赖已认证 adapter，当前会话操作继续要求精确 binding。

## 决策

采用方案 3。

- `im-commands.mjs` 使用显式集合，只让 `stop` 和 `mirror` 执行 `/api/sessions/resolve`。
- `/api/projects` 向通过 Gateway adapter 认证的本地 IM 命令返回项目摘要；`/api/sessions-by-label` 要求 adapter identity，并只返回匹配项目的 `id/title`。
- `/api/desktop/nudge` 允许导航类命令投递 control client；`stop` 仍要求 adapter 拥有当前聚焦 Session。
- 配对身份持久化在平台白名单中，独立于 Adapter 运行状态和 Session 路由；只有用户显式解绑平台时才删除。状态接口在 Adapter 未运行时读取持久化白名单，不把历史 Session 路由表述为配对失效。
- 主动通知优先使用仍在白名单内的精确 Session binding；缺失或目标已解除配对时，只允许回退到对应平台唯一的已配对用户。零用户或多个用户都返回缺少接收人，不使用最近活跃用户猜测。
- 普通 IM 文本继续执行 `resolve -> queue -> injectAndWait`，历史消息和项目 Memory 等正文接口的 ownership 不变。
- 网络调用沿用 3–5 秒 timeout；桌面 control client 未收到 nudge 时返回未送达，不进行无界重试，也不更新成功状态。

## 取舍与后果

正面结果是项目查询、会话目录、状态和桌面导航在冷启动无 Session 状态可用，单用户主动通知不再依赖微信先发消息，同时不会恢复“最近用户/Session”猜测。代价是本地所有已配对身份可看到项目和会话标题摘要；这符合当前单用户产品边界，但不适用于互不信任的共享用户。

失败恢复保持显式：Gateway 不可用返回连接错误；目录为空返回空状态；桌面控制通道离线返回未送达；当前会话命令无 binding 返回 Session 提示。没有新增数据表、迁移或不可逆副作用，代码回滚不需要数据回滚。

## 验证

- 命令测试覆盖 `/p` 与 `/ns` 不请求 Session resolve、`/stop` 仍在 409 时停止。
- HTTP route 测试覆盖无 binding 的项目/会话摘要、无 Session 的 `new_session` nudge，以及 `stop` ownership 拒绝。
- adapter binding 测试覆盖有效的精确接收人优先、已解除配对的旧路由回退、唯一配对用户 fallback 和多用户拒绝；设置接口测试覆盖 Adapter 停止后的持久化配对数量与历史 Session 路由分离。
- 自动测试不能替代真实微信收发、桌面 control client 在线投递和重启后的配对状态验收。

## 重新评估触发条件

- Bridge 支持远程 Gateway、多个操作系统账号或互不信任的多用户。
- 项目目录开始返回 transcript 正文、文件内容、凭据或其他敏感数据。
- 导航 nudge 从 UI 控制升级为直接执行外部副作用。

触发后必须引入独立 project ACL、授权/撤销审计和多用户隔离测试，不能重新依赖当前 Session binding 充当项目授权。
