# Architecture Decision Record

**Verdict:** RECORDED
**Artifact:** `docs/architecture/decisions/0012-context-rebuild-cache-eligibility-and-usage-evidence.md`
**Decision status:** Accepted
**Date:** 2026-08-21

## Decision captured

Bridge 将“本地上下文连续性”、“Provider 推理缓存资格”和“计费/用量证据”建模为独立概念。会话以 `resume`、transcript 和有界 handoff 保持语义连续；缓存资格按 Provider 身份、具体模型、协议族和稳定上下文指纹隔离；只有 Provider 在实际响应中返回 cache usage 字段，Bridge 才记录观测到的 cache read 或 cache creation。不同模型默认不可共享 Provider 缓存；同模型重建 Query 默认缓存未知，不能显示免费、命中或节省。

## Context and drivers

- Bridge 会在模型、权限、thinking、context profile、Skill 或 Agent 路由变化时重建 SDK Query；这可能导致服务端重新建立上下文。
- SDK `resume` 可恢复 conversation identity，但 Provider 或中转服务的缓存分区、保留期限与计费策略不由 Bridge 控制。
- 不同模型一般不能复用同一内部推理缓存；将完整 transcript 重新输入新模型可能显著增加输入 token。
- 现有桌面端只根据 `input_tokens` 和 `output_tokens` 用本地价格估算费用，无法区分 cache read、cache creation 和 Provider 未返回用量的情形。
- 参考的 Claude 源码通过稳定内容哈希路径避免临时配置路径变化破坏 prompt cache prefix；该经验只说明本地稳定性可改善缓存资格，不能证明任何 Provider 会命中或按何种价格结算。

## Decision and boundaries

- `ContextEnvelope` 使用白名单稳定维度生成版本化 SHA-256 指纹；不含 Prompt、API Key、绝对路径、transcript 或思考正文。
- 只有相同 Provider identity、具体 model、API/SDK protocol family 和相同指纹可标为 `same_partition_possible`；这不是 cache hit。
- model 或 Provider 变化标记 `cross_model_unavailable`；规则、Skill、工具、权限或 context profile 变化标记 `unknown` 并列出原因。
- 模型切换的默认行为是完整历史/resume 连续性，用户可以显式选择有界 `handoff_summary` 或取消。handoff 必须声明可能丢失细节，且只包含目标、已确认事实、变更、验证和未决风险。
- usage ledger 保存脱敏的 input、output、cache read、cache creation、时长、retry、策略和来源。缺失字段为 `null` 和 `unknown/partial`，不能转写为零或账单金额。
- 本地价格表只能显示“本地估算”，带价格版本和时间；不等同 Provider 账单。首期不引入云端 telemetry。

## Alternatives and consequences

| 方案 | 结论 | 主要取舍 |
|---|---|---|
| 假定 resume 或同模型重连免费 | 不采用 | Provider/中转的计费与缓存并不由本地会话状态决定 |
| 让不同模型共享内部缓存 | 不采用 | Bridge 无法安全或可靠地导出/导入 Provider 推理状态 |
| 切换模型时总是压缩为摘要 | 不采用 | 可能丢失关键约束，且用户未必接受语义损失 |
| 始终重放全文且不告知 | 不采用 | 正确性较高但成本不可见，无法让用户选择 |
| 默认全文连续性 + 显式有界 handoff + 实测 usage | 采用 | 增加策略、UI 和 ledger 复杂度，但正确性、成本透明度和可验证性兼顾 |

## Review triggers and risks

- Provider 明确公开 cache partition、TTL 或计费契约时，可新增 capability 配置；仍以每次返回的实际 usage 为最终证据。
- 新增 Provider、协议族、工具描述来源或临时配置文件时，必须检查其是否影响 ContextEnvelope 的稳定维度。
- usage ledger 超过 90 天或单库增长超过 50 MB 时，需要增加聚合、过期清理和备份验证，但不得删除 transcript 事实源。
- 用户选择 handoff 后发生上下文遗漏时，任务必须允许回退到完整历史或新会话，不能把 handoff 当作完整恢复。

## Links

- `docs/architecture/target-design.md`
- `docs/architecture/migration-plan.md`
- `docs/superpowers/plans/2026-08-21-general-agent-workbench-architecture.md`
