# ADR 0015: 有界任务续跑与上下文预算

## 状态

已接受，2026-08-24。

## 背景

当前 Bridge 的用户场景是一次会话解决问题，而不是常驻自主 Agent。用户明确要求“按计划执行到最后一个 Task”时，系统需要继续固定计划，但必须控制 Token、轮次、时长、重试和上下文输入，避免自动续跑变成无界后台消耗。

## 决策

- `session` 是默认模式，SDK 达到 `max_turns` 后暂停，等待用户继续。
- `workflow` 只沿 Coordinator 已持久化的步骤依赖推进；`mission` 保留为显式、有预算的实验模式。
- 自动续跑在 `task-auto-continuation` 唯一入口检查模式、会话可恢复性、进展和运行预算；超限写入结构化暂停原因。
- Context Planner 输出 L0/L1/L2、estimated input tokens、references 和 omitted 原因；Provider 实际 usage 单独记录，未知字段保持 null。
- Memory 默认按 project/global 作用域召回，agent/task 作用域必须匹配身份；检索 trace 只保留候选、分数、选择和原因，不保存正文。
- Agent Mailbox 使用幂等 messageId、TTL、Hop 和队列上限，通过事件触发唤醒，不使用固定轮询。

## 取舍与后果

优点是默认请求不会产生后台自主消耗，Workflow 可恢复且可审查，WorkBench 能展示预算和上下文裁剪。代价是长任务可能在预算边界暂停，需要用户显式恢复；真实 Provider 的精确成本仍以 response usage 为准，估算值不能替代账单证据。

## 验证

`gateway/smoke/bounded-plan-context-smoke.test.mjs` 使用本地 fake 逻辑覆盖五步计划、Task 3 阻塞恢复、上下文裁剪和预算边界；Gateway 项目测试、Vue 类型检查和 Vite 构建通过。真实 Provider、IM、PostgreSQL 备份恢复和桌面运行时未在本次 Smoke 中验证。
