# ADR 0001：会话正文与中断草稿分离持久化

Checklist: 25/25 complete
Incomplete: None

**Status:** Proposed
**Date:** 2026-08-11
**Owner:** Claude Desktop Bridge maintainer

## Context

Claude SDK 已持久化 conversation JSONL，桌面端另有 tab shell。当前暂停后的原文只存在 Vue 内存，完整保存 Vue 消息树又会与 SDK transcript 形成两个事实源。

## Decision

继续以 Claude SDK JSONL 作为会话正文唯一事实源；桌面端新增有界、脱敏的 session draft store，只保存未发送或中断的用户原文和 interrupted 标记。显式 resume 找不到 transcript 时必须失败，不允许用新会话伪装恢复成功。

## Alternatives

- 维持现状：实现最简单，但中断草稿丢失且 resume 失败不可见。
- 持久化完整 Vue 状态：可还原更多 UI 细节，但产生双写、一致性和敏感运行态风险。
- SQLite：提供事务和查询能力，但当前单机规模及既有 JSONL 不足以证明其成本合理。

## Consequences

- 正面：正文所有权明确；关闭 tab 不删除历史；resume 失败可检测；草稿恢复不触发自动副作用。
- 负面：思考展开状态、实时工具进度、权限弹窗等瞬时 UI 不保证跨重启还原。
- 中性：未来若需要跨设备同步，可在不改变 transcript 事实源的前提下迁移 draft store。

## Validation And Review Triggers

- 通过暂停/退出/重启恢复测试和 resume-not-found 合约测试后再将状态改为 Accepted。
- 若需要跨设备同步、审计保留或可搜索的百万级 transcript，重新评估 SQLite/服务端存储。
