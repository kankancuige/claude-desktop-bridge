# ADR: Context-Aware Skill Routing

- Status: Accepted
- Date: 2026-08-28

## Context

Bridge 过去用宽泛关键词直接从拼接文本选择 Skill。项目工作目录没有被路由器消费，ProjectContext 也没有参与过滤，因此 C# Avalonia 项目可能因“页面/组件/按钮”等词被注入 Vue 或 WinForms。Memory、Pitfall、历史 transcript 和模型扩写文本还会把不属于当前请求的词带入路由。

## Decision

1. 以结构化 ProjectContext 作为项目架构事实；首次或受信 Manifest 指纹变化时重建并持久化。
2. Skill Router 只消费当前原始请求、目标文件和有效 ProjectContext。
3. 路由分为意图候选和项目兼容性过滤；未知架构不猜测框架。
4. 框架互斥：Avalonia 抑制 Vue/WinForms，Vue 抑制 Avalonia/WinForms，WinForms 抑制 Vue/Avalonia。
5. 保留用户显式 Skill 路由，但最终仍经过存在性和启用状态过滤。

## Alternatives

- 继续扩大关键词表：实现简单，但会继续把自然语言中的泛词误判为框架。
- 让模型自行选择全部 Skill：上下文成本和误注入不可控，且无法提供确定性诊断。
- 每次全量扫描源码识别架构：事实更丰富，但启动开销和隐私面明显扩大。

## Consequences

正面：架构事实可追踪、路由确定性更高、跨新建/续聊/Workflow 一致。负面：Manifest 不完整时可能少注入 Skill；通过显式 Skill、目标文件和后续人工选择补救。缓存陈旧时会同步重建，首次启动增加有限 IO。

## Verification and Re-evaluation

必须覆盖 Avalonia 误注入回归、否定语义、未知架构和缓存陈旧测试，并区分静态、Runtime、端到端证据。若项目类型无法由受信 Manifest 稳定识别，重新评估是否引入显式项目配置，而不是恢复目录名猜测。
