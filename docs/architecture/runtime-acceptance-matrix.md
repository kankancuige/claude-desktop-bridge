# 运行验收矩阵

**目的：** 将 Bridge 的本地 Host Test 与真实运行、外部平台和代表性目标项目验收分开记录。没有对应证据时只能是 `not_verified`、`blocked_environment` 或 `blocked_external`，不得由构建或 Smoke 推导为通过。

**当前基线（2026-08-21）：** `node gateway/smoke/general-workbench-smoke.mjs` 已在临时 Node 目标项目执行并返回 `L2`。本文件不保存 Provider 凭据、Prompt、IM 收件人、绝对工作目录或 transcript 正文。

| 场景 | 触发与前置条件 | 预期结果 | 最低证据级别 | 证据记录 | 失败判据 | 当前状态 |
|---|---|---|---|---|---|---|
| 普通消息 | Gateway 已启动，桌面创建会话并发送独立问题 | 单个 Task Command 被接受；阶段事件有 taskId、stepId；最终回复只在终态气泡出现 | L3 | 脱敏 Gateway 日志、桌面截图、task execution report | 空白回复、重复终态或中间事件被显示为最终总结 | not_verified |
| 补充消息 | 首回合运行中或已完成后发送“继续/补充” | 输入按队列有界入队；同回合不强制模型切换；完成后继续项获得独立 turnId | L3 | 脱敏事件序列、task report | 输入丢失、重复执行、任务一直处于 active | not_verified |
| 停止 | 运行中发送停止命令 | Query、Workflow、挂起输入被取消；父任务进入 paused/stopped，不发送成功总结 | L3 | 停止事件、task report | 继续输出、挂起输入仍执行或被标为 completed | not_verified |
| Gateway 重启与 resume | 任务完成或暂停后重启 Gateway，再恢复已知会话 | 会话身份/任务投影可恢复；中断中的运行不伪装为 running；resume 不表示缓存命中 | L3 | restart 前后脱敏日志、恢复响应、task report | 新建替代会话、错误的成功终态、缓存费用断言 | not_verified |
| WebSocket 重连 | 桌面在 Gateway 重启或网络暂断后重连 | 侧栏项目与会话重新加载；事件去重；草稿和恢复状态符合本地策略 | L3 | 桌面录屏或截图、WS 日志 | 左侧目录/会话为空且未给出可重试错误，或重复气泡 | not_verified |
| Electron 冷启动 | 完全退出桌面进程后从安装包/开发入口启动 | 设置、项目目录、会话目录和活动投影正确加载；端口冲突显示明确诊断 | L3 | 冷启动截图、进程/端口诊断、日志 | 空白工作区、错误连接到旧 Gateway、未解释的启动失败 | not_verified |
| 固定模型切换 | 已有历史的会话从模型 A 切换到模型 B | 用户只能选择完整历史、有限 handoff 或取消；切换显示 cross_model_unavailable | L3/L5 | context_rebuild_policy、model_usage_observed、桌面截图 | 显示跨模型 cache hit，或取消仍提交消息 | not_verified |
| 同模型重连与 usage | 同 Provider/具体模型重新建立 Query，Provider 返回或未返回 usage | 仅显示 same_partition_possible/unknown；usage 缺失为 null；实际 cache read/creation 仅来自 Provider 响应 | L3/L5 | 脱敏 usage ledger 行、Provider 响应字段映射记录 | 把 resume 说成免费/命中，或把未知写为 0 | not_verified |
| 真实 Provider | 已由操作者配置最小权限的测试 Provider | 受控问题完成；timeout/cancellation 和 usage 账本符合契约 | L5 | Provider 控制台或脱敏响应、task report | 认证/限流/上游失败被标为成功 | not_verified |
| 真实 IM | 已配置测试收件人且得到发送授权 | 仅关键进度和最终总结投递；outbox 去重重试；最终总结只出现一次 | L5 | 测试会话截图、outbox 投影 | 未授权发送、重复总结、投递失败仍报告送达 | not_verified |
| 代表性目标项目 | 操作者指定一个可安全构建/测试的实际项目及其命令 | Project Context 命令、验证活动、报告和外部 blocker 均匹配该项目 | L6 | 项目构建/测试输出、task report | 使用写死命令、仅 build 就声称端到端通过 | not_verified |

## 执行规则

1. Host Smoke 不读取真实凭据、不启动 Electron、不发送 IM，始终只产出 L2 及外部项 `not_verified`。
2. L3-L6 由操作者在受控环境手动触发；启动/停止 Gateway、Electron、真实 Provider 或真实 IM 发送前必须获得明确授权。
3. 每次人工验收记录日期、应用版本、脱敏证据位置、实际结果和 blocker。失败保留原始终态与下一步，不通过重试覆盖事实。
4. Provider 账单以供应商的实际 usage 或账单页面为准；Bridge 仅记录脱敏 token 数与来源，不计算或承诺费用。
5. CI `quality` Job 仅执行 Gateway 契约测试、L2 Host Smoke、语法/资源/依赖检查与前端类型/生产构建；它不替代本矩阵的 L3-L6 行。

## 当前人工验收记录

| 日期 | 场景 | 结果 | 证据 | Blocker/下一步 |
|---|---|---|---|---|
| 2026-08-21 | 本地 Host Smoke | L2 passed | `node gateway/smoke/general-workbench-smoke.mjs` | L3-L6 需要操作者授权重启运行实例及提供测试 Provider/IM/目标项目环境 |
| 2026-08-21 | 会话停止与恢复 L2 | passed | `node --test gateway/sessions/session-lifecycle-l2.test.mjs gateway/sessions/session-stop.test.mjs gateway/sessions/session-resume.test.mjs gateway/sessions/session-runtime-state.test.mjs gateway/sessions/session-coordinator.test.mjs gateway/sessions/task-input-queue.test.mjs gateway/tasks/task-completion.test.mjs gateway/tasks/task-lifecycle.test.mjs`，49 项通过 | 只验证纯状态、队列和恢复契约；真实 Gateway/网络中断仍需 L3 |
| 2026-08-21 | Electron Gateway 崩溃退避 L2 | passed | `node --test desktop-ui/electron/gateway-restart-policy.test.cjs`，3 项通过 | 只验证重启决策；真实 child process 崩溃、窗口重连和侧栏恢复仍需 L3 |
