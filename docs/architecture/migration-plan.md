# 会话恢复与异常提示迁移计划

Checklist: 30/30 complete
Incomplete: None

**Verdict:** READY

## 状态迁移

- 当前：workspace shell v1，只存 tab/session 描述；resume 缺失时可能静默新建；错误提示分散。
- 目标：保留 v1 读取兼容，新增独立 draft v1；resume 失败显式返回；共享传输错误事件和全局通知区域。
- source of truth 始终是 Claude SDK transcript，不迁移或重写现有 JSONL。
- 新增 fork 与按需接力均为 additive；现有 `resume` 请求和旧桌面端继续兼容。

## 阶段

| 阶段 | Entry gate | Change | Success evidence | Abort condition | Rollback/roll-forward |
|---|---|---|---|---|---|
| 1 兼容模块 | 现有测试通过 | 新增纯函数 draft/error/resume 模块 | 新失败用例先红后绿 | 旧 shell 无法解析 | 删除未接线模块即可回滚 |
| 2 Gateway 合约 | resume 决策测试通过 | 缺失 resume 返回 404；新增 stop API | 合约测试、Gateway tests | 现有历史恢复回归 | 保留旧 POST 形状；前端兼容无 `code` 错误 |
| 3 前端共性错误 | 全局事件无敏感内容 | fetch/WS/storage 产生限频 notice | 分类和去重测试、UI build | 后台请求刷屏 | feature-local listener 可移除，不影响 API |
| 4 草稿接线 | draft 存储边界通过 | 暂停/失败/关闭前保存，accepted 后清除 | 组件测试和 runtime smoke | 错误清除草稿或跨会话串台 | draft 为附加数据，停读即可回滚 |
| 5 稳定观察 | build/test 全绿 | 真实 Gateway/API 故障和重启 smoke | 日志+UI截图/步骤记录 | 会话重复、丢历史、密钥泄露 | 禁止清理旧 transcript；按阶段回滚代码 |
| 6 身份即时固化 | resume 缺失测试通过 | runtime 创建即绑定并持久化 SDK ID | 重启前后映射一致性测试 | 同一 SDK ID 产生两个 runtime | 停用即时写入，保留 `system/init` 校正路径 |
| 7 分支与按需接力 | SDK 支持 `forkSession`；上下文提取红测存在 | 新增 fork API/侧栏入口；引用短句按需读取最近 transcript | fork ID 不同且历史连续；普通首问零注入 | 源 transcript 被改写或错误会话被注入 | 移除新入口和接力调用；不删除已生成 fork transcript |
| 8 统一任务决策 | 现有模型和 Context Profile 测试通过 | 新增纯函数 `TaskDecision`，旧分类器改为适配层 | 决策表测试覆盖硬风险和用户约束 | 同一输入产生不稳定结果 | 保留旧函数入口，停用新决策调用即可回滚 |
| 9 自动模型模式 | 决策事件和模型档位校验通过 | 新客户端发送 `modelMode:auto`，Gateway 在回合边界选择模型 | 自动与固定模式契约测试；不会在执行中切换 | 重复执行消息或恢复到错误会话 | UI 默认切回 fixed；旧客户端路径不变 |
| 10 Workflow 与审查收敛 | 自动模型模式稳定 | Workflow/Agent 消费统一决策；实施任务由主会话唯一写入；高风险成功回合基于真实 checkpoint 使用 Power 只读复核 | Workflow 模型继承、重复写入抑制和审查升级测试 | Power 不可用却错误报告成功，或主会话与 Workflow 并行写入 | 禁用自动 Workflow；主会话与旧手工 Workflow 保持可用 |
| 11 TaskCommand 收口 | 旧 WebSocket 协议测试通过 | desktop 成为薄适配器，三个 IM 改用进程内提交/观察服务 | TaskCommand、IM runner、turn routing 和 queue 测试 | IM 消息重复执行或跨用户串台 | 保留旧协议形状，回退 adapter 调用但不迁移持久数据 |
| 12 Session Event Journal | task-state 恢复测试通过 | 新增不含正文的逐 Session JSONL；accepted 关键写入后才 ACK | 连续序号、半行、中间损坏、容量和敏感字段测试 | accepted 未落盘却返回成功，或 journal 出现正文/凭据 | 停止读取 journal，回退 `bridge-task-state`；保留隔离文件供诊断 |
| 13 Agent 能力与 Provider | SDK query 启动点已盘点 | 注册 `agent/claude-sdk`，主/定时/重建/Workflow 统一 Provider handle | 能力缺失前置失败、重复注册、disposer 隔离和接线守卫测试 | Provider 绕过能力校验或 shutdown 泄漏常驻资源 | 将调用恢复到 Claude Provider 适配器；Registry 不持有 transcript 数据 |
| 14 稳定观察 | Gateway/前端全量门禁通过 | desktop、停止、重连、journal crash 和真实 IM smoke | runtime 日志、可见 UI 状态和端到端通知 | 任务状态分裂、通知提前或恢复重复执行 | 保留旧协议和 task-state 兼容窗口，按入口逐项关闭新接线 |
| 15 Gateway 叶子模块归类 | 既有 Gateway/desktop 测试全绿 | 迁移 `shared/`、`security/`、`providers/`，只调整内部 import | 全量测试、所有 MJS 语法检查、入口导入 smoke | 任一 Provider 或启动导入失败 | 将对应目录文件移回根目录并恢复相对 import；不涉及数据回滚 |
| 16 Gateway 领域模块归类 | 阶段 15 全绿 | 迁移 `sessions/`、`projects/`、`tasks/`、`context/`、`tools/` | 对应单测与全量门禁；持久化路径断言不变 | Session 恢复、journal 或任务门禁契约变化 | 按目录移回；现有 transcript/journal 不迁移、不删除 |
| 17 Gateway 边界模块归类 | 阶段 16 全绿 | 迁移 `im/`、`agents/`、`workflows/`，保留根 `index.mjs` | 三个平台接线守卫、Workflow/Agent 测试和打包构建 | IM 重复提交、Workflow 状态或 Electron 启动路径变化 | 按目录移回，继续使用原根入口和原协议 |
| 18 组合根瘦身 | 目录归类稳定且有 runtime smoke | 从 `index.mjs` 依次提取 HTTP router、Session coordinator、SDK stream adapter 和 project repository | 每个提取步骤独立测试；根入口只负责配置、组合、启动和 shutdown | 提取后出现共享可变状态分叉或生命周期重复 | 保留上一阶段 coordinator；逐个恢复调用，不批量回滚数据 |

## 兼容、数据与删除

- 不修改现有 JSONL、session-map、snapshot、checkpoint 格式。
- 旧 workspace shell 继续解析；draft store 是 additive，损坏时隔离为空并提示。
- stop API 是新增端点；旧 WebSocket `stop_generation` 继续支持。
- 本次没有不可逆数据迁移。稳定期内不删除旧分支或兼容逻辑。
- 已存在的断裂 transcript 不自动合并或删除；后续只能显式归档，避免错误改写 SDK UUID 链。
- 只有确认所有用户操作调用方使用稳定错误码后，才考虑收敛散落字符串；该清理不属于本次必需步骤。
- `modelTiers` 保持原 JSON 结构；新增 `modelMode` 默认只影响新桌面端。旧客户端显式 `model` 继续视为 fixed，不需要批量迁移会话。
- 自动路由失败不能重复提交已经接受的用户消息；切换失败返回不完整/可重试状态，由用户决定重发。
- 回滚自动模式只需让桌面端恢复发送 fixed；不删除决策日志、transcript 或已完成任务结果。
- `bridge-session-events` 是 additive sidecar；迁移期始终保留 `bridge-task-state` 双写和旧 WebSocket 请求形状。只有 crash/IM runtime 验收稳定后才讨论移除兼容路径。
- journal 损坏文件只隔离不自动删除；显式删除 Session 时与 snapshot、checkpoint、task-state 一并清理。
- Provider 回滚不涉及数据迁移；任何第二 Provider 上线前必须补齐六项能力声明、释放测试和协议兼容证据。
- Gateway 目录迁移只改变内部模块位置，不修改 Electron `extraResources` 递归打包规则、`node gateway/index.mjs` 启动契约、HTTP/WebSocket 接口、配置键或持久化文件位置。
- 历史 implementation plan 保留旧路径作为当时证据；README、当前架构文档、静态 wiring 测试和有效源码引用随迁移同步更新。

## SQLite 运行状态与 Memory 索引迁移（2026-08-18）

### 状态转换

- 当前：IM inbox/outbox、消息去重和 Memory/会话候选依赖内存、JSON 重写或目录扫描；Rules、Skills、MCP、Agents、Hooks 和 transcript 是文件事实源。
- 目标：`BRIDGE_HOME/bridge-state.db` 保存 IM 原子状态与可重建索引；旧 JSON/JSONL、Markdown 和 SDK transcript 继续可读。
- 非目标：迁移配置正文、迁移 Claude transcript、引入服务端数据库、自动删除旧状态或做跨设备同步。

### 阶段

| 阶段 | 入口门禁 | 变更 | 成功证据 | 中止条件 | 回滚或前滚 |
|---|---|---|---|---|---|
| 1 数据库准备 | 仓储红测存在 | 创建 schema、WAL、busy timeout 和健康状态 | schema/pragma/关闭测试 | native addon 不兼容或目录不可写 | 保持文件模式，修复依赖后重试 |
| 2 惰性导入 | 旧 JSON 解析测试通过 | 仅在 SQLite 缺少对应平台记录时导入 inbox/outbox | 重启后状态数量和 payload 校验一致 | 导入中断或出现重复主键 | 保留旧 JSON，删除未确认的新行并重试 |
| 3 IM 切换 | 三平台单元测试通过 | adapters 通过仓储接口读写 SQLite | 重复消息、失败重试、dead 状态和通知顺序一致 | 队列丢失或状态提前完成 | 关闭 SQLite adapter，回读旧文件 |
| 4 派生索引 | transcript/Memory 扫描基线固定 | 会话和 Markdown Memory 写入索引 | 索引结果与扫描结果一致；正文未复制 | 索引污染跨项目数据 | 停止索引读取，回退目录扫描 |
| 5 稳定观察 | Gateway/desktop 门禁通过 | 健康接口与 degraded 日志可见 | 重启、损坏 DB、锁等待和恢复 smoke | 无法判断数据是否可靠 | 保留双读和旧文件，不删除兼容代码 |

### 数据与回滚

- SQLite 数据库只新增，不覆盖旧 JSON；所有导入按 `platform + message_id` 或 `platform + notification_id` 幂等。
- 数据库损坏时重命名为 `.corrupt-<timestamp>`，切换文件模式并保留告警；不自动删除排队载荷。
- 只有连续一个发布周期确认 SQLite 与文件模式可互相恢复，才允许讨论移除文件兼容路径；本次不删除旧路径。
# Bridge 私有配置根目录迁移（2026-08-18）

**Verdict:** READY

## 状态转换

- 当前：Gateway、Electron、SDK、IM 和 Workflow 共用 `~/.claude`。
- 目标：所有 Bridge 数据位于 `~/.claude-desktop-bridge` 或绝对 `BRIDGE_HOME`；SDK 使用相同 `CLAUDE_CONFIG_DIR`；正常运行不读取 Claude/Codex 配置。
- 不变项：HTTP/WebSocket、Session ID、transcript JSONL、Rule/Skill/Agent/Hook 文件格式和供应商 API 契约。
- 非目标：替换 Claude Agent SDK、删除旧目录、引入 SQLite、云同步。

## 阶段

| 阶段 | 入口门禁 | 变更 | 成功证据 | 中止条件 | 回滚或前滚 |
|---|---|---|---|---|---|
| 准备 | 路径清单和现有数据所有权确认 | 增加统一根目录解析与迁移清单 | 单元测试验证绝对路径和幂等复制 | 目标目录不可创建 | 修复权限后重试，不改源目录 |
| 共存迁移 | 新目录可写 | 首次复制已知文件/目录，已有目标不覆盖 | 清单无失败，关键文件数量可核对 | 任一关键文件复制失败 | 保留源和已复制目标，下次仅重试缺失项 |
| 运行切换 | 迁移准备完成 | Gateway/Electron/SDK 全部切换到私有根目录 | 静态扫描无产品级旧路径，定向测试通过 | SDK transcript 仍写入旧目录 | 停止发布，修复 `CLAUDE_CONFIG_DIR` 后前滚 |
| 稳定观察 | 新旧数据均保留 | 验证设置、会话、IM 和 Workflow 重启恢复 | runtime smoke 与日志证据 | 会话或凭据不可恢复 | 用户可临时将 `BRIDGE_HOME` 指向备份副本；禁止自动删源 |
| 旧路径移除 | 至少一个发布周期且实测零读取 | 仅移除兼容迁移代码或由用户手工归档旧数据 | 明确授权和零读取证据 | 任一用户仍需旧数据 | 延后移除，不做破坏操作 |

## 数据与兼容

- 复制单位为单文件或单目录，使用“不覆盖已有目标”的幂等语义；迁移清单采用原子替换写入。
- `settings.json` 迁移时移除 Anthropic/provider 凭据字段，供应商继续以 `bridge-provider.json` 为事实源，避免重新引入 CCSwitch 代理配置。
- `projects/`、IM 配对、加密密钥和 provider 配置属于关键数据；复制失败必须记录并阻止把迁移标为完成。
- 旧目录始终只读且不删除；迁移后的所有新写入只进入 Bridge 私有目录，因此回滚是显式选择旧快照，而不是双写。

## 观测与验收

- 启动日志只记录根目录、迁移状态、文件数量和耗时，不记录 token、API Key 或 Hook 内容。
- smoke 后核对新会话 JSONL、`bridge-session-map.json`、IM pairing/outbox 和设置修改均只出现在私有目录。
- 发布前运行 Gateway 全量测试、桌面测试、Node 语法检查、Vue 类型检查、Vite build 和 `git diff --check`。
