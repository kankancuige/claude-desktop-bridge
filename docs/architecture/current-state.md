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
| `bridge-state.db/bridge_session_index` | 保存可重建的会话目录、权限和 IM 镜像投影；不保存对话正文 | `sessions/session-catalog.mjs`、`storage/bridge-state-db.mjs` |

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
12. 项目扫描：按 transcript 内真实 `cwd` 聚合 canonical 与旧编码物理目录；SQLite 使用 canonical project key，JSONL 保留原路径。旧空 visibility sidecar 仅修复明确分类为 `main` 的 transcript，Agent/Workflow transcript 继续过滤。
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
- `index.mjs` 仍接近 10,000 行，目录分类只提高职责可发现性，尚未完成 HTTP router、Session coordinator、SDK stream adapter 和 project repository 的提取。
- 目录迁移后的静态证据为 156 个 MJS 语法检查和 Gateway 296/296 单元测试通过；桌面类型检查、生产构建与真实 IM runtime smoke 在最终门禁阶段补充。

## 上下文规则与内置 Skill 补充（2026-08-18）

- `gateway/context/BRIDGE_RULES.md` 是所有目标项目共享的长期规则；Bridge 自身 Vue/Electron/Gateway 和会话生命周期约束已移入 `BRIDGE_PROJECT_RULES.md`。
- `bridge-rules.mjs` 从模块位置解析仓库根目录，只接受绝对 `workDir`，并通过目录包含关系选择专属规则；空路径、相对路径、相邻目录和前缀相似目录均按外部项目处理。
- `skill-router.mjs` 使用确定性语义选择 `digital-twin-cad`。普通 CAD、普通 GLB Viewer 和普通前端不命中；只有明确连接或驱动实现时才联合加载 `device-driver`。
- `builtin-skill-installer.mjs` 在首次命中时将应用包内置 Skill 写入 `BRIDGE_HOME/skills`；已有同名文件属于用户且不会覆盖，准备失败会在 Query 创建前终止。当前 Bridge 内置源为 `bridge-memory` 和 `digital-twin-cad`，其他路由名不代表随应用打包。
- 本层不读取 Codex/Claude 外部全局规则，不改变 Session、transcript、HTTP/WebSocket、IM 或持久化格式。

## 配置所有权补充（迁移前基线，2026-08-18）

- Gateway 虽通过 `settingSources: []` 阻止 SDK 自动扫描外部规则，但自身仍把 `~/.claude` 作为 Rule、Skill、MCP、Agent、Hook、Workflow、IM、项目和 transcript 的共同根目录。
- Electron 主进程也从 `~/.claude/bridge-token` 和 `~/.claude/bridge-store-key` 读取 Gateway token 与旧安全载荷密钥。
- Claude Agent SDK 是唯一执行 Provider；SDK 默认使用 `~/.claude`，除非 Query 子进程显式收到 `CLAUDE_CONFIG_DIR`。
- 设置页可管理 `rules/` 和 `hooks/`，但完整 Query 关闭了所有 `settingSources`，因此自定义 Rule/Hook 没有进入实际会话执行链路。
- Bridge 使用位于 `BRIDGE_HOME` 的 SQLite 运行状态库保存可重建的 IM、会话、任务和 Workflow 结构化投影；Claude transcript、事件正文、规则、Skill、Agent、Workflow 定义和附件正文仍保持 Markdown、JSON、JSONL 或脚本文件事实源。

## Bridge 私有配置实现补充（2026-08-18）

- `gateway/config/bridge-home.mjs` 统一解析默认 `~/.claude-desktop-bridge` 和绝对 `BRIDGE_HOME`，Gateway 业务模块不再自行读取 Claude/Codex 配置根目录。
- `providers/claude-agent-sdk-runtime.mjs` 在动态加载 Claude Agent SDK 前设置 `CLAUDE_CONFIG_DIR`；每个 Query 的 `env` 与 `runtimeEnv` 再显式携带同一路径。
- 首次迁移按允许清单递归补齐缺失文件、拒绝覆盖目标并原子写入 `.bridge-migration-v1.json`；失败项保留源数据并在下次启动重试。
- Gateway、Workflow、项目缓存、微信、飞书、钉钉、Electron token/安全密钥与手动 smoke 已统一使用 Bridge Home。
- 完整上下文启用 Bridge 私有 `user` setting source，使私有 Rules/Hooks 进入 SDK 执行链路；focused/light 仍使用空 setting source，并关闭 MCP/Agent 等扩展。
- `settings.json` 保存前剥离模型、供应商地址和凭据；`bridge-provider.json` 是供应商配置唯一事实源。
- 该阶段当时的静态证据为 Gateway 334/334、桌面端 94/94 和 169 个 Gateway MJS；当前证据见文末 2026-08-21 补充。尚未重启真实桌面进程执行旧数据迁移和 IM runtime smoke。

## SQLite 与 Memory 实现补充（2026-08-18）

- `BRIDGE_HOME/bridge-state.db` 已保存 IM inbox/outbox、会话索引和 Memory Markdown 派生索引；Rules、Skills、MCP、Agents、Hooks、Provider 配置、Memory 正文和 Claude transcript 继续使用文件事实源。
- Electron 使用内置 `node:sqlite`，Node 20 可选加载 `better-sqlite3`。数据库使用 WAL、5 秒 busy timeout 和 schema v7；除原会话、任务和 Workflow 投影外，当前还包含 Pitfall、Execution Report 与 Verification Campaign 表。驱动不可用时显式进入文件模式，确认损坏时隔离数据库并在健康接口暴露原因和隔离计数。
- 项目与会话列表通过 `bridge_session_index` 增量协调 transcript 的路径、mtime、size、标题、用户可见性、来源、权限、IM 镜像和最近打开时间。扫描先按 mtime 稳定选择最新记录，既有目录一次批量读取并在一个短事务内批量 upsert；mtime/size 未变化时不重新读取 transcript。visibility sidecar 缺失或损坏时可用 SQLite 中已确认的 `visible` 记录恢复，SQLite 不可用时继续使用原 JSON/JSONL 扫描和 sidecar 设置。
- 微信、飞书、钉钉按平台惰性导入旧 JSON。重配或解绑会同时清理 SQLite 和兼容文件；适配器停止时通知统计仍读取 SQLite。
- 任务状态通过 `bridge_task_state`/`bridge_task_events` 双写 SQLite 与旧 task-state/Event Journal；状态和事件在同一短事务内按 revision 接受或拒绝，迟到 revision 不再进入事件流。终态任务先保存平台通知意图，通知使用确定性 ID 进入 outbox；worker 的 sent/failed/dead 结果回写任务投影，重启时对账缺失 outbox 记录并重新入队。Workflow 通过 `bridge_workflow_state` 保存阶段、token、父 Session 和运行键；重启后存活态降为可恢复的 paused，并结合 journal 恢复阶段和 token。SQLite 不复制最终回复或事件正文。
- transcript 索引只保存路径和元数据，命中时走快速路径；文件删除或元数据失效后清理陈旧行并回退目录扫描，不复制会话正文。
- `context/memory-service.mjs` 对动作任务做确定性关键词召回，最多注入 6 KB；简单问题、无匹配内容、停用/过期记录和明确“不要记住”均不注入。
- 设置页可搜索、启停、删除和重建项目 Memory，展示来源、状态、作用域和最近验证时间。SQLite 只保存索引，`memory/*.md` 仍可直接编辑和恢复。
- 内置 `bridge-memory` Skill 只处理明确的记住、沉淀、忘记或项目约定操作；普通代码任务、探索和功能解释不加载该 Skill。

## 通用 Workbench 实现补充（2026-08-21）

- Desktop、微信、飞书和钉钉输入统一进入 `TaskCommandService`，新任务直接由 `TaskWorkbenchRuntime` 接受并通过 `Task Coordinator` 生成稳定的 task/turn/step/agent-run 身份。SDK result 只作为 Primary Agent 结构化结果输入，Workflow/Agent 生命周期直接回写 Coordinator；`coordinator-compatibility.mjs` 只用于旧投影恢复和兼容测试，不能成为第二套主链。
- `Project Context` 只按有限深度读取允许的 manifest、锁文件和规则元数据，跳过源码正文、构建目录与密钥文件。Light 任务不扫描目标项目；Windows 的 npm/pnpm/yarn 命令使用受限 `.cmd` shim，命令适配器仍拒绝 Project Context 白名单之外的字符串。
- 阶段计划固定为 Prime、Plan、Implement、Validate、Review、Report 的按风险子集。Light 为 0 个子 Agent，Focused 最多 1 个，Balanced 最多 2 个，Power 通常 3–6 个且上限 8 个。
- `Agent Registry` 将内置角色和用户 Agent 分开，并以统一输入、结构化结果、能力和文件边界调度。`Verification Campaign` 提供适配器生命周期、timeout/cancellation、基线/候选、失败指纹、回归检测和 L0–L6 证据等级。
- `Repair Loop` 对同类失败最多自动尝试两种策略；重复策略进入 RCA，新回归冻结候选。`Pitfall Ledger` 使用 SQLite 按 global/project/bridge 隔离，正文只保存脱敏摘要和引用。
- 完成门禁要求必需步骤结束、Agent/Workflow 无活动实例、阻断 finding 已关闭、实际测试和必要验证通过，并且确定性通知意图已持久化。成功及所有稳定非成功终态都生成状态一致的 Execution Report；`paused`、验证不足、环境阻塞、回归和 RCA 终态都不会显示为完成。Coordinator 与旧 task-state 使用独立 SQLite task key，避免两套 revision 互相覆盖；重启时活动 Coordinator 投影降级为 `inconclusive` 并要求显式继续和重新验证。
- `gateway/smoke/general-workbench-smoke.mjs` 使用临时 Node 目标项目验证 Light、Focused、Balanced、Power、L2 Host Test、修复循环、Pitfall、桌面事件、IM 终态去重和 SQLite 投影。该 Smoke 不等于真实 Provider、真实 IM 或真实业务项目端到端验收。
- 2026-08-21 当前代码门禁为 Gateway 449/449、桌面端 106/106、249 个普通 Gateway MJS、9 个内置 Workflow DSL、61 项内置资源和 Vue 类型检查全部通过；Vite 与 Windows NSIS 构建通过。真实 Provider、桌面冷启动、至少一个真实 IM 平台和代表性业务项目 L3–L6 仍是外部验收 blocker。
