# 当前架构：会话持久化与错误传播

Checklist: 26/26 complete
Incomplete: None

**Verdict:** DOCUMENTED
**Snapshot:** `main` @ `9838034b95cb92eceb03a3e3a138902da020081e`，dirty worktree，2026-08-14

## 组件与数据所有权

| 组件 | 当前职责 | 证据 |
|---|---|---|
| `WorkspaceView.vue` | 多 tab 运行态、历史加载、会话创建/恢复、WebSocket、局部 toast | `handleNewSession`、`connectWS`、`loadHistory` |
| `workspace-persistence.ts` | 将项目、tab、Gateway ID、SDK ID 写入 `localStorage` | `WorkspaceShell` v1 |
| `gateway/index.mjs` | 创建/恢复 SDK query，维护进程内 sessions，提供项目和 transcript API | `POST /api/sessions`、`startStreamPump` |
| `TaskCommandService` | 统一 desktop/IM 的提交、观察和取消契约 | `gateway/tasks/task-command.mjs`、`gateway/im/im-task-runner.mjs` |
| `SessionEventJournal` | 保存不含会话正文的 Bridge 任务事实并投影恢复状态 | `bridge-session-events/<sessionId>.jsonl` |
| `ProviderRegistry` | 校验 Agent 能力并统一启动/释放 Provider | `agent/claude-sdk`、`AGENT_CAPABILITY_UNSUPPORTED` |
| Claude SDK | 在 Gateway 强制设置的 `CLAUDE_CONFIG_DIR` 下写入 `~/.claude-desktop-bridge/projects/.../*.jsonl` | `providers/claude-agent-sdk-runtime.mjs`、`system/init.session_id` |
| `bridge-session-map.json` | Gateway UUID 与 SDK conversation ID 双向映射 | `persistSdkSessionId` |
| `bridge.session_index` | 保存可重建的会话目录、权限和 IM 镜像投影；不保存对话正文 | `sessions/session-catalog.mjs`、`storage/postgres-state-compat.mjs` |

## 当前关键流程

1. 新建会话：前端 `POST /api/sessions`；新会话可延迟到首条任务再建立 `query()`。恢复/分支会话在 runtime 创建时立即持有 SDK ID，`system/init` 再校正并落盘双向映射。
2. 暂停：前端调用统一 stop API，Gateway 取消主 runtime、待确认请求与排队输入并返回停止范围；前端收到成功结果后回填草稿并转为空闲。暂停是取消，不保存工具执行栈。
3. 应用重启：前端恢复 tab shell；Gateway 内存 sessions 已空时，使用 `historySessionId` 再次 `POST /api/sessions {resume}`；Gateway 将 SDK ID传给 `opts.resume`。
4. 关闭 tab：只关闭 WebSocket并移除 tab shell，不调用 DELETE，所以 transcript 仍在侧栏项目扫描中；当前确认文案声称会中断任务，但实现不会确定性停止后台 query。
5. 历史展示：`loadMessages`/`loadHistory`恢复用户和 assistant 文本；UI-only system 消息、实时工具进度、权限弹窗和宠物状态不是 transcript 正文。
6. 新建会话：仍建立全新 SDK conversation；仅当首条消息是引用性短句时，从最近有效主会话注入有界只读接力上下文，普通独立问题不注入。
7. 项目 Memory：设置页可以管理 `~/.claude-desktop-bridge/projects/<project>/memory/*.md`，但 Gateway 不会自动把上一会话整理为 Memory；引用性短句接力仍从有界 transcript 摘要派生。
8. 任务提交：desktop WebSocket 将旧消息协议适配为 `TaskCommand`；微信、飞书、钉钉直接调用同一进程内服务，不再创建到 Gateway 的任务注入 WebSocket。
9. 任务接收：`task/accepted` 先同步写入并 `fsync`；写入失败返回 `session_event_persist_failed` 且回滚输入。后续状态、Workflow/Agent、停止和 runtime 失败写入安全事件投影。
10. Agent 启动：主 Session、定时 Session、query 重建和 Workflow Agent 都通过 `agent/claude-sdk` Provider；只有 Provider 注册适配器可以直接调用 SDK `query()`。
11. 重启恢复：优先从连续 journal 投影任务状态；尾部半行自动修复，中间损坏或序号中断会隔离为 `.corrupt-*` 并回退 `bridge-task-state`。
12. 项目扫描：按 transcript 内真实 `cwd` 聚合 canonical 与旧编码物理目录；PostgreSQL 使用 canonical project key，JSONL 保留原路径。旧空 visibility sidecar 仅修复明确分类为 `main` 的 transcript，Agent/Workflow transcript 继续过滤。
13. Tab 恢复：Gateway runtime 404 且有 SDK history ID 时重建 runtime；没有 history ID 时清除失效 UUID并要求重新发送；网络、5xx 或无效响应才进入重连。

## 静态检查仍未关闭的风险

- Session Event Journal 只恢复 Bridge 自有任务事实，不恢复 SDK 进程栈、未完成工具调用或第三方副作用；中断任务必须由用户确认后继续，不能自动重放。
- 生命周期聚合快照已成为新版桌面端忙碌态权威来源，但旧 Session/Workflow 快照和部分展示字段仍处于兼容窗口，尚未删除。
- 当前只有 `agent/claude-sdk` 一个 Provider；第二 Provider 上线前仍需完成六项能力声明、协议兼容和资源释放验收。
- 强制崩溃、真实 provider 故障、桌面停止/重连及微信/飞书/钉钉端到端尚无 runtime 证据。

## 运行与证据限制

- 本文依据本地源码、2026-08-14 全量单元测试与静态/构建门禁，以及 2026-08-11 Gateway 日志；未执行强制杀进程、真实 provider 故障或 IM 端到端恢复。
- 现有 dirty worktree 中包含用户和前序工作，本文不把未提交内容视为已发布版本。

## 任务生命周期补充（2026-08-13）

- 当前进程内同时存在 Session runtime、父任务持久态、Workflow runner 和桌面展示四类状态；历史实现由多个事件处理器重复判断是否完成。
- Gateway 已增加统一生命周期聚合快照，父任务、runtime 与该会话全部 Workflow 共同决定 `active` 和发送/停止/继续能力。
- 旧 Session/Workflow 快照仍在兼容窗口内保留；`WorkspaceView.vue` 中部分 `status`、`_turnCompleted` 和展示字段写入口尚待后续迁移，不再作为新版客户端忙碌状态的权威来源。
- 微信、飞书和钉钉的最终通知仍由父任务终态事件驱动，不消费 SDK `result` 或单个 Workflow 完成事件。

## 任务接入基础补充（2026-08-14）

- desktop 与三个 IM 平台已共享任务校验、去重、排队、模型路由和停止实现；旧 WebSocket 消息形状继续兼容，但不再拥有第二份业务流程。
- Bridge journal 不保存用户/assistant 正文、Prompt、API Key、请求 body 或完整工具结果；正文仍只由 Claude SDK transcript 持有。
- journal 容量有界，Session 替换、删除和 Gateway shutdown 会释放对象；同一 Session 的模型/权限重建不会关闭 journal。
- Claude SDK Provider 声明六项稳定能力，调用要求在 SDK 启动前验证；Registry shutdown 会隔离单个 disposer 错误并继续释放其余 Provider。
- 该阶段当时的本地门禁证据为 Gateway 370/370、桌面端 97/97；当前 Workbench 证据见文末 2026-08-21 补充。真实微信/飞书/钉钉凭据端到端、强制杀进程恢复和桌面交互 smoke 仍需 runtime 验收。

## Gateway 源码布局补充（2026-08-14）

- `gateway/index.mjs` 仍是 OBSERVED 的唯一组合根和启动入口；Electron 继续按该路径启动，独立运行命令仍为 `node gateway/index.mjs`。
- 领域源码和测试已归入 `shared/`、`security/`、`providers/`、`sessions/`、`projects/`、`tasks/`、`agents/`、`workflows/`、`im/`、`context/` 和 `tools/`，测试与源码同目录。
- Gateway 根目录只保留组合入口、package/env 文件、OCR 运行资产、就近说明和人工 smoke 脚本；目录迁移未修改 HTTP/WebSocket API、配置键、transcript、journal、通知 outbox 或其他用户数据路径。
- `index.mjs` 仍是组合根和启动入口，但 HTTP REST 业务路由已迁入 `gateway/http/*-routes.mjs`，认证/CORS/Adapter 边界与分发位于 `gateway/http/request-handler.mjs`；Session coordinator、SDK stream adapter 和 StorageGateway 仍由组合根接线。
- 2026-08-24 代码闭合证据为 Gateway `572/572`、HTTP handler 直接契约测试、全量 MJS 语法检查和 `git diff --check`；桌面类型检查、生产构建与真实 IM/Provider runtime smoke 仍属于外部验收。

## 上下文规则与内置 Skill 补充（2026-08-18）

- `gateway/context/BRIDGE_RULES.md` 是所有目标项目共享的长期规则；Bridge 自身 Vue/Electron/Gateway 和会话生命周期约束已移入 `BRIDGE_PROJECT_RULES.md`。
- `bridge-rules.mjs` 从模块位置解析仓库根目录，只接受绝对 `workDir`，并通过目录包含关系选择专属规则；空路径、相对路径、相邻目录和前缀相似目录均按外部项目处理。
- `skill-router.mjs` 使用确定性语义选择 `digital-twin-cad` 和 `industrial-tightening-solution`。普通 CAD、普通 GLB Viewer、普通前端和普通代码任务不命中；只有明确连接或驱动实现时才联合加载 `device-driver`。
- `builtin-skill-installer.mjs` 在首次命中时将应用包内置 Skill 写入 `BRIDGE_HOME/skills`；已有同名文件属于用户且不会覆盖，准备失败会在 Query 创建前终止。当前 Bridge 内置源为 `bridge-memory`、`digital-twin-cad` 和 `industrial-tightening-solution`；技术方案 Skill 的通用 references 与 manifest 一起发布，其他路由名不代表随应用打包。
- 本层不读取 Codex/Claude 外部全局规则，不改变 Session、transcript、HTTP/WebSocket、IM 或持久化格式。

## 配置所有权补充（迁移前基线，2026-08-18）

- Gateway 虽通过 `settingSources: []` 阻止 SDK 自动扫描外部规则，但自身仍把 `~/.claude` 作为 Rule、Skill、MCP、Agent、Hook、Workflow、IM、项目和 transcript 的共同根目录。
- Electron 主进程也从 `~/.claude/bridge-token` 和 `~/.claude/bridge-store-key` 读取 Gateway token 与旧安全载荷密钥。
- Claude Agent SDK 是唯一执行 Provider；SDK 默认使用 `~/.claude`，除非 Query 子进程显式收到 `CLAUDE_CONFIG_DIR`。
- 设置页可管理 `rules/` 和 `hooks/`，但完整 Query 关闭了所有 `settingSources`，因此自定义 Rule/Hook 没有进入实际会话执行链路。
- Bridge 使用 PostgreSQL `bridge` schema 保存可重建的 IM、会话、任务和 Workflow 结构化投影；Claude transcript、事件正文、规则、Skill、Agent、Workflow 定义和附件正文仍保持 Markdown、JSON、JSONL 或脚本文件兼容格式。

## Bridge 私有配置实现补充（2026-08-18）

- `gateway/config/bridge-home.mjs` 统一解析默认 `~/.claude-desktop-bridge` 和绝对 `BRIDGE_HOME`，Gateway 业务模块不再自行读取 Claude/Codex 配置根目录。
- `providers/claude-agent-sdk-runtime.mjs` 在动态加载 Claude Agent SDK 前设置 `CLAUDE_CONFIG_DIR`；每个 Query 的 `env` 与 `runtimeEnv` 再显式携带同一路径。
- 首次迁移按允许清单递归补齐缺失文件、拒绝覆盖目标并原子写入 `.bridge-migration-v1.json`；失败项保留源数据并在下次启动重试。
- Gateway、Workflow、项目缓存、微信、飞书、钉钉、Electron token/安全密钥与手动 smoke 已统一使用 Bridge Home。
- 完整上下文启用 Bridge 私有 `user` setting source，使私有 Rules/Hooks 进入 SDK 执行链路；focused/light 仍使用空 setting source，并关闭 MCP/Agent 等扩展。
- `settings.json` 保存前剥离模型、供应商地址和凭据；`bridge-provider.json` 是供应商配置唯一事实源。
- 该阶段当时的静态证据为 Gateway 334/334、桌面端 94/94 和 169 个 Gateway MJS；当前证据见文末 2026-08-21 补充。尚未重启真实桌面进程执行旧数据迁移和 IM runtime smoke。

## PostgreSQL 统一存储与 Memory 实现补充（2026-08-23）

- PostgreSQL 17.11 的 `bridge` schema 是结构化运行态唯一事实源，承载 IM inbox/outbox、会话索引、Memory 正文/元数据/embedding、Task/Workflow、Pitfall、Execution Report、Verification Campaign 和 usage。Gateway 启动只创建 PostgreSQL StorageGateway，未配置或不可用时明确失败，不创建、不打开第二种结构化数据库。
- 项目与会话列表通过 PostgreSQL `bridge.session_index` 增量协调 transcript 的路径、mtime、size、标题、用户可见性、来源、权限、IM 镜像和最近打开时间。扫描先按 mtime 稳定选择最新记录，既有目录一次批量读取并批量 upsert；mtime/size 未变化时不重新读取 transcript。visibility sidecar 缺失或损坏时使用 PostgreSQL 中已确认的 `visible` 记录恢复。
- 微信、飞书、钉钉从 PostgreSQL 状态仓储恢复 inbox/outbox；空表不回读旧结构化状态文件，重配或解绑只清理 PostgreSQL 运行态。
- `PostgresStateCompat` 在启动时加载 PostgreSQL 内存投影，保留旧同步业务 API，写入通过 FIFO 队列串行提交；任务状态按 revision 幂等，PostgreSQL 失败进入 degraded，不回退旧数据库。最终回复、transcript 正文和凭据不进入状态投影。
- transcript 索引只保存路径和元数据，命中时走快速路径；文件删除或元数据失效后清理陈旧行并回退目录扫描，不复制会话正文。
- `context/memory-service.mjs` 对动作任务做确定性关键词召回，最多注入 6 KB；简单问题、无匹配内容、停用/过期记录和明确“不要记住”均不注入。
- 设置页可搜索、启停、删除和重建项目 Memory，展示来源、状态、作用域和最近验证时间。正文由 StorageGateway 写入 PostgreSQL `content_documents`，`memory/*.md` 作为用户编辑/SDK 兼容副本。
- 内置 `bridge-memory` Skill 只处理明确的记住、沉淀、忘记或项目约定操作；普通代码任务、探索和功能解释不加载该 Skill。

## 独立本地 Workbench 面板补充（2026-08-23）

- Desktop 新增 `/workbench` 独立路由和侧栏入口，面向本地单用户提供 MultiCA 风格的任务看板、运行概览、最近活动、Coordinator 详情、Agent/Workflow、验证证据、Execution Report 和 AI 层健康视图。
- 面板只读消费 `GET /api/workbench/tasks`、既有 reports/pitfalls/ai-health 接口；PostgreSQL Workbench Repository 支持可选 `projectKey` 与 `activeOnly`，查询仍使用参数化 SQL，状态库降级通过 `stateStoreDegraded` 明示。
- UI 通过 `workbench-view-model.ts` 聚合状态计数和展示数据，不创建第二套任务终态；5 秒轮询、手动刷新、加载/错误/空状态和窄屏布局均在页面内处理。任务带有 `encodedDir/sessionId` 时可从面板返回对应历史会话。
- 该面板是本地观测与协作管理层，不提供云工作区、成员权限、远程 Runtime、跨设备同步、供应商账单核验或设备/MQTT 业务能力；设置页既有 Workbench 治理 Tab 保持不变。
- Workbench 现支持 `任务 / Agent / 会话` 三种只读视图。Agent 投影显示 `name/agentType/role/purpose/goal/status/resultSummary`、文件/测试计数和所属任务；任务详情抽屉显示任务概述、原始请求、问题列表、Coordinator 步骤、Agent/Workflow、任务事件与 Agent 时间线、验证证据和 Execution Report，并可按问题的 `sessionId + turnId` 跳转回对应会话上下文。
- `GET /api/workbench/tasks/:taskId` 的 `questions` 对齐任务看板的 conversation reference 思路：根 `task/created` 和每个 `task/input-appended` 形成稳定问题项，问题项保存 bounded 摘要和独立 Session Link，不复制 Transcript 正文。
- Coordinator 内部仍保留结构化 Agent 结果用于完成门禁，但 PostgreSQL 只写白名单投影，不写 prompt、凭据、完整结果正文或绝对路径。

## PostgreSQL-only 运行时边界（2026-08-23）

- Gateway 运行态 Memory 统一调用 `StorageGateway`，业务层不直接依赖 PostgreSQL client 或 JSON 状态文件；未注入 StorageGateway 时以稳定错误码阻止运行。
- PostgreSQL 目标承载所有结构化运行态：任务状态、会话索引、IM inbox/outbox、Workbench 投影、Memory 元数据/embedding、Pitfall、Execution Report、Verification Campaign 和 model usage。
- Markdown 继续保存用户可编辑的 Rules、Skills 和 Memory 正文，JSONL 继续作为 Claude SDK transcript/审计归档；二者由 StorageGateway 负责访问和兼容，不作为散落的业务入口。
- PostgreSQL-only 代码闭合已完成；旧迁移产物不再属于运行时入口。2026-08-23 已完成真实 pg_dump/临时库恢复、vector 类型、内容 hash 和 transcript 物化验收；真实 Claude SDK resume 重启 E2E 与外部 Provider/IM 送达仍是独立门禁。
- 当前本机 PostgreSQL 17.11 与 `pgvector 0.8.6` 已运行，`pg` 驱动、统一 StorageGateway、结构化状态导入和 Markdown/JSONL 内容导入已有真实探针；运行时结构化调用方已切换。真实 embedding endpoint、SDK transcript 文件物化/恢复和真实 IM/Provider 送达仍属于外部验收门禁。

### 增量运行时证据（2026-08-23）

- Gateway 启动从 `storage-config.json` 读取 PostgreSQL，初始化 `bridge` schema，并将 StorageGateway 注入 Memory 服务；关闭流程会释放连接。
- Memory 召回、管理 API 的列表/保存/启停/重建/删除操作已通过 PostgreSQL `content_documents` 统一入口；Markdown 文件仍保留为用户可编辑和 SDK 兼容的内容副本。
- `/api/health` 会返回 StorageGateway 的 PostgreSQL 健康状态、数据库名和 server version；本机已验证 `vector 0.8.6` 和 `vector(1536)`，但没有 embedding endpoint 时仍使用关键词召回，不宣称语义质量已验收。
- 任务、Session、IM、Workbench 和 Pitfall 已通过 PostgreSQL 同步兼容投影运行；JSONL transcript 仍保留真实路径以满足 Claude SDK resume 契约。
- Provider usage、任务、Session、IM、Workbench 和 Pitfall 均通过 PostgreSQL 统一状态入口写入，重复 event 使用 PostgreSQL 唯一键或 revision 幂等。
- Coordinator 每个 revision 串行写入 PostgreSQL `task_state`/`task_events`，事务锁拒绝迟到 revision；数据库只保存脱敏任务、Agent、Workflow、验证和 finding 投影，不保存完整 plan 或工作目录。

## 组合根纯端口收敛（2026-08-24）

- `gateway/index.mjs` 只负责启动失败边界；`gateway/gateway-runtime.mjs` 只暴露稳定的 `startGateway()` 契约。
- `gateway/gateway-runtime-impl.mjs` 仅负责依赖工厂、生命周期接线、端口包装、HTTP/WebSocket 上下文组装和启动组合；不再实现上传路径校验、Session ID 校验、SDK 事件转换或 SDK 输入 async iterable。
- Session 上传边界位于 `gateway/runtime/session-upload-runtime.mjs`；SDK 客户端事件适配位于 `gateway/sessions/sdk-stream-adapter.mjs`；SDK 输入队列位于 `gateway/runtime/push-stream.mjs`。这些模块均有独立契约测试。
- `gateway/runtime/composition-root-wiring.test.mjs` 对组合根执行静态门禁：拒绝 HTTP pathname 分支、直接数据库执行、SDK async iterator、直接 Session Map 状态变更和旧 `convertSdkToWs` 实现。
- 组合根仍允许保留顶层常量、依赖工厂、惰性生命周期监听器、稳定 wrapper 和 route context assembly；这些是启动组合职责，不代表业务实现迁回根文件。
- 本轮 `node --test gateway` 为 `684/684`；真实 Provider/IM 账单、外部签名安装和供应商缓存计费仍属于环境门禁，不由静态代码门禁替代。

## 通用 Workbench 实现补充（2026-08-21）

- Desktop、微信、飞书和钉钉输入统一进入 `TaskCommandService`，新任务直接由 `TaskWorkbenchRuntime` 接受并通过 `Task Coordinator` 生成稳定的 task/turn/step/agent-run 身份。SDK result 只作为 Primary Agent 结构化结果输入，Workflow/Agent 生命周期直接回写 Coordinator；`coordinator-compatibility.mjs` 只用于旧投影恢复和兼容测试，不能成为第二套主链。
- `Project Context` 只按有限深度读取允许的 manifest、锁文件和规则元数据，跳过源码正文、构建目录与密钥文件。Light 任务不扫描目标项目；Windows 的 npm/pnpm/yarn 命令使用受限 `.cmd` shim，命令适配器仍拒绝 Project Context 白名单之外的字符串。
- 阶段计划固定为 Prime、Plan、Implement、Validate、Review、Report 的按风险子集。Light 为 0 个子 Agent，Focused 最多 1 个，Balanced 最多 2 个，Power 通常 3–6 个且上限 8 个。
- `Agent Registry` 将内置角色和用户 Agent 分开，并以统一输入、结构化结果、能力和文件边界调度。`Verification Campaign` 提供适配器生命周期、timeout/cancellation、基线/候选、失败指纹、回归检测和 L0–L6 证据等级。
- `Repair Loop` 对同类失败最多自动尝试两种策略；重复策略进入 RCA，新回归冻结候选。`Pitfall Ledger` 使用 PostgreSQL 按 global/project/bridge 隔离，正文只保存脱敏摘要和引用。
- 完成门禁要求必需步骤结束、Agent/Workflow 无活动实例、阻断 finding 已关闭、实际测试和必要验证通过，并且确定性通知意图已持久化。成功及所有稳定非成功终态都生成状态一致的 Execution Report；`paused`、验证不足、环境阻塞、回归和 RCA 终态都不会显示为完成。Coordinator 与旧 task-state 使用独立 PostgreSQL task key，避免两套 revision 互相覆盖；重启时活动 Coordinator 投影降级为 `inconclusive` 并要求显式继续和重新验证。
- `gateway/smoke/general-workbench-smoke.mjs` 使用临时 Node 目标项目验证 Light、Focused、Balanced、Power、L2 Host Test、修复循环、Pitfall、桌面事件、IM 终态去重和结构化投影。该 Smoke 不等于真实 Provider、真实 IM 或真实业务项目端到端验收。
- 2026-08-23 当前代码门禁为 Gateway 全量测试、62 项内置资源检查、桌面端 Vue 类型检查和 Vite 生产构建全部通过；Windows NSIS 生产打包成功。源码 Desktop 冷启动、普通消息、补充消息、停止、重连和崩溃恢复 L3 已通过；真实 Provider 普通回复、handoff、同模型重连、补充队列、停止和受控 idle timeout 均通过，usage ledger 保留 `provider_observed` 与未知字段 `null`；微信入站、会话执行和完成回复双向链路已有用户实测。Provider 账单/缓存读计费、无入站会话的 IM 主动推送、安装/升级签名与失败回滚仍分别属于供应商/发布外部门禁，不能由本地代码门禁替代；认证业务接口按当前范围不验收。

## 组合根迁移增量（2026-08-24）

- `gateway/runtime/session-context-runtime.mjs` 现在独立拥有项目 transcript 接力、用户偏好和 PostgreSQL Memory 注入；`gateway-runtime-impl.mjs` 只通过显式依赖和稳定 wrapper 接线。
- `gateway/runtime/project-session-runtime.mjs` 独立拥有项目分组、可见性迁移、Session Catalog 协调、项目/Session 查询、删除标记和 Session 文件清理；transcript 正文仍由 Claude SDK 文件契约拥有，结构化索引仍进入 PostgreSQL。
- 本增量的定向契约、语法检查、`git diff --check` 和 Gateway 全量测试均通过（`614/614`）。项目/Session legacy 实现已从组合根删除，当前仅保留稳定 wrapper；`gateway-runtime-impl.mjs` 仍包含其他生命周期与配置组合逻辑，尚未宣称整个实现文件已完全收敛。

## 运行时兼容闭合增量（2026-08-24）

- Memory、Pitfall、IM Inbox/Outbox 和通知状态路由均已改为显式领域 Repository；生产 Context、Runtime、HTTP、IM 和 Workflow 不再使用 `stateStore`、文件 outbox/inbox fallback 或 Workflow 全局依赖槽。
- `NotificationOutbox` 的去重、延迟、失败重试、dead、恢复、容量上限和 Repository 写失败回滚均通过 Repository fixture 验证；三平台适配器只接收 Repository port。
- `PitfallService` 不再自行创建兼容仓储，启动组合根只注入 `repositories.pitfall`；IM Runtime 通过 `getSessionRepository`、`getImRepository` 和 `getNotificationRepository` 取领域端口。
- 2026-08-24 全量 Gateway 回归为 `674/674`，`vue-tsc` 和 Vite 生产构建通过，相关 Node 语法检查和 `git diff --check` 通过。代码层面的本轮闭合完成。
- 真实 Gateway/Provider/IM/PostgreSQL 断线恢复、SDK resume 及 Electron 签名安装仍是外部运行时门禁，不能由本地单元或静态测试替代。
