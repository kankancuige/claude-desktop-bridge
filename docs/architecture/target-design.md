# 目标设计：可恢复会话与统一异常提示

Checklist: 30/30 complete
Incomplete: None

**Verdict:** READY

## 目标边界

- 保持 Electron + Vue + 单 Gateway 的 modular monolith，不引入数据库或新服务。
- transcript 继续由 Claude SDK 持有；桌面端只新增有界的 session draft store。
- API 层统一产生脱敏错误事件，页面继续负责业务语义和可执行重试。
- 会话入口明确区分恢复、分支和空白新建；按需接力只读取 transcript，不新增任务正文数据库。

## 契约

### 会话恢复

- `POST /api/sessions` 未传 `resume`：创建新会话。
- 传 `resume` 且 transcript/映射存在：返回 `resumed: true` 和稳定的 Gateway/SDK ID。
- 传 `resume` 但不存在：返回 `404`、`code: SESSION_RESUME_NOT_FOUND`；禁止静默创建新会话。
- `POST /api/sessions/:id/stop`：幂等停止当前生成，返回 `stopped`、`resumable`、`historySessionId`；不删除 transcript。
- `POST /api/sessions {forkFrom}`：校验源 transcript 后调用 SDK `forkSession`，返回新的 SDK conversation ID；源会话保持不变，fork 不复制 undo/file-history。
- 恢复或 fork 生成的 SDK ID 在 runtime 创建时立即写入 `lastSessionId` 并尝试持久化双向映射；重复 `system/init` 只校正同一身份。

### 跨会话接力

- 空白新会话的普通首问不加载旧会话。
- 空白新会话首条消息为“继续、加上、接着做”等有明确省略关系的短句时，Gateway 从同项目最近的有效主 transcript 派生接力上下文。
- 接力来源排除当前会话、agent/workflow transcript、只有单条引用性短句且无实质结果的断裂会话。
- 注入只保留最近两条实质用户请求和两条 assistant 结果，总长度不超过 6 KB；使用内部边界标记，历史 UI 只显示当前用户原文。
- 找不到可靠来源时不猜测、不注入，由模型正常要求用户补充。

### 草稿

- key 优先使用 SDK conversation ID，尚未获得时使用项目路径和 Gateway ID组成的临时 key。
- value 只含文本、更新时间和 interrupted 标记；文本限制 900 KB，最多 100 项，默认保留 30 天。
- 发送被 Gateway 接受后清除对应草稿；暂停、发送失败、断线或关闭 tab 前立即保存。

### 错误事件

```ts
interface BridgeNotice {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  source: 'http' | 'websocket' | 'storage' | 'session'
  status?: number
  path?: string
  retryable: boolean
  dedupeKey: string
}
```

- 网络不可达、timeout、最终认证失败、429、5xx 由共享 API 层产生全局事件。
- 400/404/409 等业务错误由用户操作调用方解析稳定 `code` 后提示。
- 后台错误按 `dedupeKey` 限频；连接恢复产生一次 recovery 事件并清除持久 banner。
- App 持有跨路由通知区域，Workspace/Settings 可继续显示局部错误和 retry。

## 失败与恢复

| 失败 | 行为 | 用户可见结果 |
|---|---|---|
| Gateway 未启动/重启中 | 请求失败、WS退避；不套用伪默认数据 | 持久连接提示，恢复后自动消失 |
| token 轮换 | 刷新一次 token 后重试 | 重试失败才提示认证异常 |
| resume 目标丢失 | 不创建替代会话 | 提示历史会话不存在，保留项目与草稿 |
| fork 目标丢失/复制失败 | 不创建空白替代会话 | 提示无法从源会话分支，源会话不变 |
| 接力来源不存在或损坏 | 跳过接力，继续发送原消息 | 不阻塞新会话，不伪造历史 |
| transcript 读取失败 | 不显示“空白即成功” | 历史加载失败并提供重试 |
| localStorage 不可写 | 维持内存状态 | 明确提示草稿/工作区不会在重启后恢复 |
| provider/API 失败 | 保留表单和会话 | 显示状态、脱敏错误和可重试说明 |

## 方案比较

| 方案 | 结论 | 原因 |
|---|---|---|
| 保存完整 Vue 消息树 | 不采用 | 重复 transcript、结构易漂移、可能保存敏感运行态 |
| 新增 SQLite 会话库 | 不采用 | 单机规模没有证据支付迁移和双写成本 |
| JSONL 为正文事实源 + 本地有界草稿 | 采用 | 与 Claude SDK 一致、改动可逆、能覆盖中断原文恢复 |
| 每个 fetch 手写 toast | 不采用 | 109 个调用点易漏且提示不一致 |
| 共享传输错误事件 + 业务调用方补充 | 采用 | 可覆盖网络共性，同时避免后台轮询刷屏 |
| 所有新会话默认注入最近 transcript | 不采用 | 容易污染简单问题并增加 token 成本 |
| 显式 fork + 引用短句按需接力 | 采用 | 完整继承和轻量接力边界清楚，且不新增正文事实源 |

## 验收

- 单元测试：workspace shell/draft 兼容、错误分类/脱敏/去重、resume 缺失决策、stop 幂等结果。
- 构建：Gateway tests、`vue-tsc --noEmit`、Vite build、`git diff --check`。
- runtime：新建回合 -> 暂停 -> 退出 -> 重启 -> 历史正文和草稿恢复 -> 继续发送；断开 Gateway 时出现提示，恢复后消失。
- runtime：源会话 -> 显式分支 -> 新 SDK ID 保留源历史；空白新会话发送“加上”时命中最近有效会话，普通独立问题不注入。

## 统一任务决策与模型路由

### 目标边界

- Gateway 新增无副作用的 `TaskDecision` 决策器，统一输出 `action`、`complexity`、`risk`、`modelTier`、`contextProfile`、`workflow`、`finalReview`、`reasons` 和 `hardTriggers`。
- 桌面端只表达 `modelMode: auto | fixed`：自动模式由 Gateway 选择模型，固定模式使用用户显式选择的模型。旧客户端只要继续发送 `model` 且不发送 `modelMode`，就按固定模式兼容。
- Context Profile 继续决定工具和注入范围，但由统一决策结果驱动；Workflow、Agent 和最终审查不再维护互相冲突的任务分类。
- 模型档位仍只有 `light / balanced / power`。确定性构建、测试、类型检查和凭据扫描由工具执行，不为它们单独调用 Power。

### 决策优先级与不变量

1. 用户明确固定模型或只读约束优先。
2. 安全、认证、会话身份、持久化、并发、协议、消息投递、公开契约和迁移是硬风险触发器；命中后不能被短文本或少文件降级。
3. 动作和影响范围决定基础复杂度；文本长度和代码块数量只能作为辅助信号。
4. `risk=high|critical` 必须 `modelTier=power` 且 `finalReview=power`；普通实现由 Balanced 执行，Power 负责设计或最终裁决。
5. Light 仅负责简单问答、结构探索和机械提取，不得修改代码或作最终完成判断。
6. 自动模式可以在回合边界切换实际模型；同一回合中不得切换，运行中的工具调用不得因模型路由被中断。
7. 档位没有配置模型时回退到默认模型，并把 `fallback` 原因写入决策事件；不得静默伪装成已经切换。

### 运行契约

```ts
interface TaskDecision {
  version: 1
  action: 'query' | 'inspect' | 'implement' | 'review' | 'refactor' | 'operate'
  complexity: 'light' | 'balanced' | 'power'
  risk: 'low' | 'medium' | 'high' | 'critical'
  modelTier: 'light' | 'balanced' | 'power'
  contextProfile: 'light' | 'focused' | 'full'
  workflow: 'none' | 'code-review' | 'bug-hunter' | 'audit-sweep' | 'deep-research' | 'judge-panel' | 'generate-critic-fix' | 'default'
  finalReview: 'none' | 'balanced' | 'power'
  reasons: string[]
  hardTriggers: string[]
}
```

- 每条已接受用户消息在进入 SDK 前计算一次决策。Gateway 解析档位到实际模型，必要时沿用现有安全重建 Query 流程，然后向桌面广播 `task_decision`。
- Workflow 自动触发直接消费 `decision.workflow` 和 `decision.modelTier`；Workflow 内未显式指定模型的 Agent 继承档位模型。内置 Workflow 不再写死供应商不一定支持的 `sonnet`。
- 代码修改结束后的审查深度取任务决策风险与真实差异风险的较高值。高风险或关键路径最终审查必须使用 Power；低中风险由 Balanced 定向审查。
- `task_decision` 仅包含模型 ID、档位、稳定原因码和非敏感描述，不包含 Prompt、API Key、请求体或内部思考内容。

### 失败与降级

| 失败 | 行为 |
|---|---|
| 自动档位未配置 | 使用默认模型，事件标记 `tier_model_unconfigured` |
| 指定模型不在当前供应商列表 | 不在客户端猜测；Gateway 使用已保存默认模型并提示配置问题 |
| 自动切换重建失败 | 当前消息失败并保留草稿，不回退到旧模型重复执行有副作用任务 |
| 分类器不可用 | 使用本地确定性规则，不阻塞任务 |
| Workflow 不存在或已运行 | 主会话继续执行，记录 Workflow 跳过原因 |
| Power 不可用 | 高风险任务不得降级后宣称完成；返回可重试的不完整状态 |
