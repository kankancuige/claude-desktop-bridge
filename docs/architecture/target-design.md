# 目标设计：可恢复会话与统一异常提示

Checklist: 30/30 complete
Incomplete: None

**Verdict:** READY

## 目标边界

- 保持 Electron + Vue + 单 Gateway 的 modular monolith；使用本机 PostgreSQL 作为唯一结构化运行状态库，不引入云同步。
- transcript 继续由 Claude SDK 持有；桌面端只新增有界的 session draft store。
- API 层统一产生脱敏错误事件，页面继续负责业务语义和可执行重试。
- 会话入口明确区分恢复、分支和空白新建；按需接力只读取 transcript，不新增任务正文数据库。
- Bridge 使用 `~/.claude-desktop-bridge` 作为唯一默认配置根目录，并允许 `BRIDGE_HOME` 指向另一个绝对目录；不得回退读取 `~/.claude` 或 `~/.codex`。
- Claude Agent SDK 仍是执行 Provider，但父进程和 Query 子进程都必须使用同一 `CLAUDE_CONFIG_DIR`，使 transcript、settings 和 SDK 衍生文件归 Bridge 所有。

## Bridge 私有配置契约

- `config/bridge-home.mjs` 是根目录唯一解析入口；业务模块不得自行拼接 `homedir()/.claude*`。
- `settings.json` 保存 Bridge 自有 MCP、Hooks 和 SDK兼容设置；供应商凭据继续由 `bridge-provider.json` 隔离管理。
- `rules/`、`skills/`、`agents/`、`hooks/` 和 `workflows/` 保持可读文件格式，并通过 StorageGateway 管理数据库副本。
- `projects/` 同时保存 SDK transcript 与 Bridge 的 session map、journal、checkpoint、snapshot 和 preference；所有消费者使用同一根目录。
- PostgreSQL `bridge` schema 保存 IM inbox/outbox、消息去重、会话索引和 Memory 正文/索引；不保存凭据，transcript 仍保留 SDK 兼容 JSONL 路径。
- 会话目录以 `(project_key, session_id)` 为唯一身份，统一保存可重建 transcript 元数据以及权限、IM 镜像和最近打开状态；项目列表优先读取目录并按 mtime/size 增量协调，JSON/JSONL 与 sidecar 文件保持兼容事实源和降级路径。
- `project_key` 必须由 transcript 的真实 `cwd` 生成；同一 `cwd` 的 canonical 与旧编码目录合并协调。`transcript_path` 保留物理位置并全局唯一，项目键转移时原子继承权限和 IM 镜像投影。
- PostgreSQL 使用短事务、statement timeout 和 schema version；不可用时启动失败或进入明确 degraded，禁止静默切换事实源。
- PostgreSQL 的 `task_state`、`task_events` 和 `workflow_state` 只保存状态字段、revision、时间、计数和投影元数据；最终回复和凭据不写入状态投影。
- 任务终态与通知采用 at-least-once 契约：终态投影包含待投递意图，outbox 在网络调用前持久化并使用确定性 notification ID 去重；worker 结果回写任务投影，重启对账补建缺失记录。不得把跨平台网络调用包在 PostgreSQL 事务内。
- Gateway 重启时，数据库中的 `starting/running` Workflow 不得继续显示为存活进程；恢复层将其转换为 `paused`，由 journal 补充阶段、token 和受控参数后再 resume。
- 完整上下文只启用 Bridge 私有 `user` setting source；focused/light 继续关闭 setting source、MCP、Agent 和 Hook。
- 首次兼容迁移复制已知资源和 Bridge 数据，目标已存在时不覆盖；写入迁移清单后正常运行只访问新目录。旧目录保留供人工回退，绝不自动删除。

## 配置隔离失败模型

| 失败 | 行为 | 恢复 |
|---|---|---|
| `BRIDGE_HOME` 不是绝对路径 | 启动失败并给出稳定错误 | 修正环境变量后重启 |
| 创建私有目录失败 | Gateway 不启动，避免部分写入两个根目录 | 修复权限或磁盘后重试 |
| 单项迁移失败 | 记录失败项，不删除源；下次启动重试缺失目标 | 修复文件权限后重启 |
| SDK 未使用私有目录 | 隔离契约测试失败，禁止发布 | 检查 `CLAUDE_CONFIG_DIR` 注入和 Runtime wrapper |
| 旧数据不存在 | 建立空的 Bridge 私有目录并正常启动 | 无需恢复 |

## 契约

### 会话恢复

- `POST /api/sessions` 未传 `resume`：创建新会话。
- 传 `resume` 且 transcript/映射存在：返回 `resumed: true` 和稳定的 Gateway/SDK ID。
- 传 `resume` 但不存在：返回 `404`、`code: SESSION_RESUME_NOT_FOUND`；禁止静默创建新会话。
- 桌面端检查旧 Gateway UUID 返回 404 时，只有持有 SDK history ID 才重建 runtime；没有 history ID 的空壳会话停止自动重试并提示重新发送。网络与 5xx 不得被误判为会话丢失。
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
| 新增 PostgreSQL 运行状态与派生索引 | 采用 | 用于原子 IM 重试、去重和有界检索，不复制凭据 |
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

## 统一任务命令、事件日志与 Provider

- Gateway 提供进程内 `TaskCommandService`，desktop WebSocket 与三个 IM adapter 只负责协议转换；提交、观察和取消不再由 adapter 各自解释。
- Claude SDK transcript 继续拥有用户和 assistant 正文。Bridge 另外保存不含正文的 append-only Session Event Journal，只记录任务接收、状态转换、Agent/Workflow 生命周期、停止和 runtime 失败。
- `bridge-task-state` 在迁移期保留；恢复优先从 journal 投影，journal 缺失或损坏时才回退旧快照。
- Agent Provider 注册六项能力：`writable`、`resumable`、`modelOverride`、`structuredOutput`、`toolFiltering`、`continuation`。调用前验证 requirements，不支持时返回 `AGENT_CAPABILITY_UNSUPPORTED`。
- Provider registry 负责注册、查找和释放。Claude SDK 作为首个 `agent/claude-sdk` Provider，Gateway shutdown 统一调用 `disposeAll()`。
- 详细取舍、失败恢复和兼容策略见 ADR 0006。

## 统一任务生命周期聚合

- Gateway 输出版本化 `session_lifecycle_snapshot`，聚合父任务、runtime、全部 Workflow 和操作能力。
- 桌面端通过 reducer/store 消费快照；活动文字、Agent 卡片和 Workflow 面板只做展示投影。
- SDK `result`、单个 Agent 完成或单个 Workflow 完成都不能产生父任务成功；只有 `task_completed` 可触发成功气泡、队列清理和 IM 最终通知。
- 停止命令提交 `user_stopped` 父任务事件，并取消主 runtime、确认请求、已接受输入与所有活跃 Workflow。
- 迁移完成后，普通、恢复、scheduled 和 Agent Session 使用统一 runtime 工厂；IM adapter 使用统一 command API，不再各自解释完整 WebSocket 生命周期。

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

## Gateway 模块目录与依赖边界

Gateway 保持单进程 modular monolith。`gateway/index.mjs` 是唯一组合根和兼容启动入口，领域实现按职责放入下列目录：

| 目录 | 职责 | 允许依赖 |
|---|---|---|
| `shared/` | 日志、文本分片、内部客户端和无领域归属的小型基础能力 | Node 标准库和第三方基础库 |
| `security/` | 路径、URL、WebSocket、配置脱敏和安全载荷边界 | `shared/` |
| `providers/` | 上游 Provider、协议转换、代理生命周期和 Agent Provider registry | `shared/`、`security/`、`agents/` |
| `sessions/` | Session 身份、runtime、历史、事件 journal、可见性和停止 | `shared/`、`security/`、`tasks/`、`context/` |
| `projects/` | 项目缓存、transcript 定位/分类和跨会话接力 | `shared/`、`security/`、`sessions/` |
| `tasks/` | 任务命令、决策、状态、生命周期、完成门禁和模型路由 | `shared/` |
| `agents/` | Agent 能力、运行元数据、工具生命周期和 skill 路由 | `shared/`、`tasks/` |
| `workflows/` | Workflow 脚本、运行状态、子进程和最终审查编排 | `shared/`、`tasks/`、`agents/`、`providers/` |
| `im/` | 微信、飞书、钉钉适配器、IM 命令、进度和通知投递 | `shared/`、`tasks/`、`sessions/` |
| `context/` | Bridge 规则、上下文档位、压缩生命周期和结构化偏好 | `shared/`、`security/`、`tasks/` |
| `tools/` | 附件、上传和 RTK 等可复用工具支持 | `shared/`、`security/` |

`shared/` 不得反向依赖任何领域目录；IM adapter 不直接修改 Session 内部状态；Workflow 不解释 HTTP、WebSocket 或 IM 协议。`tasks/task-coordinator.mjs` 已承担显式任务权威，跨领域依赖仍由 `index.mjs` 组合；后续瘦身组合根时不得复制 Coordinator 状态或改变公开 API、持久化格式和运行进程数。

## 上下文规则分层与内置 Skill

- 跨项目规则由 `BRIDGE_RULES.md` 持有；Bridge 仓库专属规则由 `BRIDGE_PROJECT_RULES.md` 持有。完整 Query 创建和重建统一传递当前 `workDir`，只有绝对路径位于运行时仓库根目录或子目录时才追加专属层。
- 完整会话仅启用 Bridge 私有 `user` setting source，不读取用户机器上的 Claude/Codex 配置、目标项目 `CLAUDE.md`、`AGENTS.md` 或 Codex Skill；轻量问答和聚焦只读上下文继续使用 `settingSources: []`。
- 数字孪生路由要求孪生上下文与 CAD/STEP/GLB、节点映射、遥测状态、URDF/SDF 或 manifest 集成证据同时出现；CAD/GLB 节点绑定和遥测驱动模型状态可作为直接证据。
- `digital-twin-cad` 是 Bridge 自带但按需准备的 Skill。应用包携带源文件，首次命中且 `BRIDGE_HOME/skills` 不存在同名文件时写入；已有文件不覆盖，不写入 Claude/Codex 外部目录，源缺失或目录不可写时在 Query 创建前明确失败。其他 Skill 只有在用户自己的 Bridge 私有目录中存在时才可用。
- 回滚只需恢复单层规则选择并移除路由接线；已经写入 `BRIDGE_HOME/skills` 的文件不自动删除，防止删除用户后续修改。

## 通用 AI 编程工作台目标架构

## 模型上下文连续性、缓存资格与用量证据

Bridge 将三类状态严格分离：会话连续性由 SDK `resume` 和 transcript 负责；Provider 推理缓存资格由 `ContextEnvelope` 判断；账单/用量以 Provider 的真实 response usage 为准。`resume` 不表示 cache hit、免费或折扣，Bridge 也不会导出、传递或伪造任何模型内部推理状态。

- `ContextEnvelope` 只包含版本、Provider 的哈希身份、具体模型、协议族、resume 可用性及规则/Skill/Agent/工具/上下文档位的稳定哈希；不包含 Prompt、凭据、绝对路径、transcript 或思考正文。
- `same_partition_possible` 只表示同 Provider、同具体模型、同协议和同稳定 envelope 的本地资格可能存在；没有实际 usage 时缓存状态为 `unknown`。
- 模型或 Provider 切换为 `cross_model_unavailable`。用户可选完整历史、有限 handoff 或取消；handoff 仅含目标、确认状态、变更文件和验证状态，明确不能替代完整历史。
- `model_usage_observed` 与 PostgreSQL `model_usage_events` 保存 input、output、cache read、cache creation、策略和时长。缺失字段为 `null`，source 为 `partial` 或 `unknown`，不把未知写为 0 或账单事实。
- 自动模型路由和进行中的补充消息仍遵守回合边界，运行中的 Query 不因新模型选择而中断。

```text
Desktop / WeChat / Feishu / DingTalk
              -> Task Command API
              -> Task Coordinator
              -> Project Context + Resource Routing
              -> Agent / Workflow Execution
              -> Verification Campaign
              -> Completion Gate
              -> Desktop events + IM notification outbox
```

### 边界与所有权

- Bridge 拥有 Task ID、阶段、模型档位、权限、Agent 生命周期、资源开关、验证状态、Pitfall 索引和通知意图；目标项目拥有代码、构建、测试、运行时、设备与业务验收。
- Coordinator 是任务状态的唯一权威。Workflow 只编排步骤，Agent 只返回结构化结果，IM 只消费 Coordinator 关键事件与终态 outbox。
- `bridge_task_state` 仅保存有界投影，不复制 transcript、最终回复或审查正文。Coordinator 使用 `<taskId>:coordinator` 键，与兼容 task-state revision 隔离；Session Event Journal 和旧 JSON 在迁移期继续可读。
- 新任务由 `TaskWorkbenchRuntime` 直接驱动 Coordinator；SDK result、Workflow 和 Agent 不经过独立完成判断，只能回写结构化结果与生命周期事件。兼容映射不参与新任务生产推进，只负责旧投影恢复与兼容验证。

### 完成与失败契约

- `completed` 必须同时满足步骤、子执行、finding、测试、验证和通知意图门禁。L0/L1 不能替代要求 Runtime 或端到端证据的验收。
- `paused`、`not_verified`、`inconclusive`、`blocked_environment`、`regression_detected` 和 RCA 终态均提供继续入口或明确下一步，但不是成功。重启中断的活动执行转为 `inconclusive`，不会恢复成虚假的 running。
- 每个稳定终态都生成 Execution Report；终态后只允许附加报告和 RCA 只读投影，迟到阶段、Agent 或 Workflow 事件不得改写结果。
- 命令适配器只执行 Project Context 生成的结构化可执行名和参数；Windows shim 在拒绝 shell 元字符后才启用系统 shell，其他命令保持 `shell:false`。

### 非功能目标与证据状态

| 维度 | 目标或当前门禁 |
|---|---|
| 上下文成本 | Light 零项目扫描；其余扫描有限深度、文件数和单文件大小 |
| 并发 | 单任务 Coordinator 串行 revision；最多 8 个已选择 Agent |
| durability | task-state、Journal、PostgreSQL 投影并存；通知使用确定性 ID 幂等重试 |
| security | 不持久化凭据/正文；命令白名单、路径边界、timeout/cancellation |
| observability | 每个阶段事件包含 taskId、stepId、phase、role、sequence 和验证摘要 |
| availability | PostgreSQL 不可用时明确阻止启动或进入 degraded；外部环境不可用时明确阻塞 |

延迟、吞吐、长时间稳定性和真实 IM 送达目前没有生产测量数据，不能由单元测试或临时项目 Smoke 代替。
