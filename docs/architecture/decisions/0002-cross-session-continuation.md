# ADR 0002：显式分支与按需跨会话接力

Checklist: 25/25 complete
Incomplete: None

**Status:** Proposed
**Date:** 2026-08-12
**Owner:** Claude Desktop Bridge maintainer

## Context

同一项目的新 SDK conversation 不包含其他 transcript。此前恢复失败后，引用性短句“加上”进入空白会话，模型无法知道所指任务。另一方面，默认把最近完整 transcript 注入每个新会话会污染独立问题并增加上下文成本。

## Decision

保留三种可区分语义：`resume` 继续同一 conversation；`forkFrom` 使用 SDK `forkSession` 创建继承完整历史的新 conversation；未指定来源时创建空白 conversation。空白 conversation 仅在首条消息是有明确省略关系的短句时，从同项目最近有效主 transcript 派生不超过 6 KB 的只读接力上下文。

Claude SDK transcript 继续作为唯一正文事实源。接力上下文不单独持久化；断裂 transcript 不自动合并或删除。

## Alternatives

- 维持现状：没有额外复杂度，但新会话无法理解引用上一任务的短句。
- 所有新会话自动继承最近会话：操作简单，但会污染无关问题，且无法表达“真正空白”。
- 独立任务摘要数据库：查询明确，但产生新的持久化事实源和迁移/一致性成本。

## Consequences

- 正面：用户可以选择完整分支；常见“继续/加上”能轻量接力；普通首问不增加旧上下文。
- 负面：引用分类和最近有效会话选择是启发式，无法保证所有自然语言省略都命中。
- 中性：未来若需要跨设备任务索引，可在 transcript 事实源之上增加可重建索引，不改变本决策的会话语义。

## Validation And Review Triggers

- 验证 resume 身份即时固化、fork 源不变/新 ID 唯一、断裂会话排除、6 KB 上限和普通首问零注入。
- 若引用误判率不可接受、需要用户选择任意祖先节点，或 transcript 数量导致接力扫描超过 500 ms，重新评估显式来源选择和可重建索引。
