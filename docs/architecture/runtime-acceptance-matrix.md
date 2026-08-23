# 运行验收矩阵

**目的：** 将 Bridge 的本地 Host Test 与真实运行、外部平台和代表性目标项目验收分开记录。没有对应证据时只能是 `not_verified`、`blocked_environment` 或 `blocked_external`，不得由构建或 Smoke 推导为通过。

**当前基线（2026-08-23）：** `node gateway/smoke/general-workbench-smoke.mjs` 已在临时 Node 目标项目执行并返回 `L2`；Gateway 代码范围的 L3/L5 受控 Provider/Desktop 验收已记录。Provider 账单、缓存读计费和签名需要供应商/发布环境证据，本轮标记为外部非阻塞项；登录业务接口按用户要求不纳入本轮。文件不保存 Provider 凭据、Prompt、IM 收件人、绝对工作目录或 transcript 正文。

| 场景 | 触发与前置条件 | 预期结果 | 最低证据级别 | 证据记录 | 失败判据 | 当前状态 |
|---|---|---|---|---|---|---|
| 普通消息 | Gateway 已启动，桌面创建会话并发送独立问题 | 单个 Task Command 被接受；阶段事件有 taskId、stepId；最终回复只在终态气泡出现 | L3 | 脱敏 Gateway 日志、桌面截图、task execution report | 空白回复、重复终态或中间事件被显示为最终总结 | passed：2026-08-21 真实桌面只读任务被判定为 `explicit_read_only / independent_simple_question`、`Light/query`；“任务已完成”之后只有一个最终 AI 总结气泡，输入框恢复可发送；Gateway 生命周期为 `active=false`、`pendingInputs=0`、`canSend=true` |
| 补充消息 | 首回合运行中或已完成后发送“继续/补充” | 输入按队列有界入队；同回合不强制模型切换；完成后继续项获得独立 turnId | L3 | 脱敏事件序列、task report | 输入丢失、重复执行、任务一直处于 active | passed：2026-08-21 真实桌面首消息运行中追加补充指令，界面显示“已接收补充指令”，两条用户输入顺序正确；补充要求进入最终总结，末尾是唯一权威 AI 总结气泡；终态 `active=false`、`pendingInputs=0`、`canSend=true` |
| 停止 | 运行中发送停止命令 | Query、Workflow、挂起输入被取消；父任务进入 paused/stopped，不发送成功总结 | L3 | 停止事件、task report | 继续输出、挂起输入仍执行或被标为 completed | passed：2026-08-21 真实桌面 Code Review Workflow 进入 Review 并启动 3 个 Agent 后，停止动作将 Workflow 置为 paused，父任务随后显示“任务已停止/任务已取消”，未出现成功总结 |
| Gateway 重启与 resume | 任务完成或暂停后重启 Gateway，再恢复已知会话 | 会话身份/任务投影可恢复；中断中的运行不伪装为 running；resume 不表示缓存命中 | L3 | restart 前后脱敏日志、恢复响应、task report | 新建替代会话、错误的成功终态、缓存费用断言 | passed：2026-08-21 受控终止 Electron child 后，桌面以同一 SDK 历史会话重建新的运行态会话并恢复到就绪；未声明缓存命中或费用 |
| WebSocket 重连 | 桌面在 Gateway 重启或网络暂断后重连 | 侧栏项目与会话重新加载；事件去重；草稿和恢复状态符合本地策略 | L3 | 桌面录屏或截图、WS 日志 | 左侧目录/会话为空且未给出可重试错误，或重复气泡 | passed：2026-08-21 child 崩溃后自动重启并重新监听；项目、会话、历史气泡保留，运行时会话缺失的 4000 关闭会转入历史会话重建而非循环重连 |
| Electron 冷启动 | 完全退出桌面进程后从安装包/开发入口启动 | 设置、项目目录、会话目录和活动投影正确加载；端口冲突显示明确诊断 | L3 | 冷启动截图、进程/端口诊断、日志 | 空白工作区、错误连接到旧 Gateway、未解释的启动失败 | passed（源码入口）：2026-08-21 多次完全退出后由 `electron .` 冷启动，Gateway、项目目录、会话目录、历史消息和活动投影均恢复；安装包、签名和升级验证归入 P3 发布验收，不阻塞 P0 源码桌面 L3 |
| 固定模型切换 | 已有历史的会话从模型 A 切换到模型 B | 用户只能选择完整历史、有限 handoff 或取消；切换显示 cross_model_unavailable | L3/L5 | context_rebuild_policy、model_usage_observed、桌面截图 | 显示跨模型 cache hit，或取消仍提交消息 | passed（Bridge 范围）：2026-08-21 真实桌面会话在不同实际模型间切换时显示完整历史、有限摘要和取消；取消不提交消息，完整历史选择获得非空 Provider 回复。`BRIDGE_RUN_CONTROLLED_MODEL_HANDOFF_ACCEPTANCE=1 node gateway/smoke/controlled-model-handoff-acceptance.mjs` 已验证两个真实回合、`handoff_summary`、`cross_model_unavailable` 和非空回复；SQLite usage ledger 亦记录完整历史路径。供应商账单语义由供应商页面决定，不作为本地代码 blocker |
| 同模型重连与 usage | 同 Provider/具体模型重新建立 Query，Provider 返回或未返回 usage | 仅显示 same_partition_possible/unknown；usage 缺失为 null；实际 cache read/creation 仅来自 Provider 响应 | L3/L5 | `BRIDGE_RUN_CONTROLLED_SAME_MODEL_RECONNECT_ACCEPTANCE=1 node gateway/smoke/controlled-same-model-reconnect-acceptance.mjs`；脱敏 usage ledger 行、Provider 响应字段映射记录 | 把 resume 说成免费/命中，或把未知写为 0 | passed（Bridge usage 契约）：2026-08-22 真实同模型重连通过，`resumed=true`、策略 `reuse_same_session`、资格 `same_partition_possible`；新 ledger 行 `usage_source=provider_observed`，缺失字段路径为 `null` 并有回归测试。Provider cache read/creation 与账单金额只接受供应商实际字段/页面 |
| 真实 Provider | 已由操作者配置最小权限的测试 Provider | 受控问题完成；timeout/cancellation 和 usage 账本符合契约 | L5 | Provider 控制脚本、脱敏响应、task report | 认证/限流/上游失败被标为成功 | passed（Bridge 范围）：2026-08-22 串行运行真实 Provider 普通回复、模型 handoff、同模型重连、补充队列、停止和受控 idle timeout 验收；均通过，usage ledger 已持久化 `provider_observed` 字段。供应商账单页面及真实上游并发限流属于外部扩展验收 |
| 真实 IM 会话双向链路 | 用户从微信发送消息，适配器转入已有会话，任务完成后回复同一微信会话 | 入站消息只执行一次；关键进度和最终总结按 outbox 投递；最终总结只出现一次 | L5 | 用户实测：微信消息进入 Bridge 会话，任务完成后收到微信回复；结合 IM runner、outbox 和终态测试 | 入站丢失、重复执行、完成后无回复、把排队误报为送达 | passed（用户实测）：微信入站、会话执行和完成回复链路可用 |
| 真实 IM 主动推送 | 没有对应入站会话，仅由 Bridge 主动向测试收件人发送 | 平台明确返回送达；失败不得标记 sent | L5 | 2026-08-22 本机主动投递收到平台 `HTTP 200 / ret=-2`，Bridge 返回 `sent=false, queued=true` | 未授权发送或排队被报告为送达 | blocked_external：需要有效 Bot 会话/授权；不影响已有微信会话的双向收发 |
| 代表性目标项目上下文 | 操作者指定一个可安全访问的实际项目及其命令 | Project Context、验证活动、报告和外部 blocker 与该项目匹配；不把目标项目业务结果冒充 Bridge 结果 | L6 | 项目上下文命令、task report | 使用写死命令，或把目标项目业务验收冒充为 Bridge 验收 | 当前 Bridge 只保留目标项目上下文能力验证；具体业务项目验收不属于本项目计划 |

## 执行规则

1. Host Smoke 不读取真实凭据、不启动 Electron、不发送 IM，始终只产出 L2 及外部项 `not_verified`。
2. L3-L6 由操作者在受控环境手动触发；启动/停止 Gateway、Electron、真实 Provider 或真实 IM 发送前必须获得明确授权。
3. 每次人工验收记录日期、应用版本、脱敏证据位置、实际结果和 blocker。失败保留原始终态与下一步，不通过重试覆盖事实。
4. Provider 账单以供应商的实际 usage 或账单页面为准；Bridge 仅记录脱敏 token 数与来源，不计算或承诺费用。
5. CI `quality` Job 仅执行 Gateway 契约测试、L2 Host Smoke、语法/资源/依赖检查与前端类型/生产构建；它不替代本矩阵的 L3-L6 行。
6. 技术方案类请求按需路由 `industrial-tightening-solution`；其通用资源不得包含客户、价格、账号、密码或 Provider 凭据。

## 当前人工验收记录

| 日期 | 场景 | 结果 | 证据 | Blocker/下一步 |
|---|---|---|---|---|
| 2026-08-21 | 本地 Host Smoke | L2 passed | `node gateway/smoke/general-workbench-smoke.mjs` | L3-L6 需要操作者授权重启运行实例及提供测试 Provider/IM/目标项目环境 |
| 2026-08-21 | 会话停止与恢复 L2 | passed | `node --test gateway/sessions/session-lifecycle-l2.test.mjs gateway/sessions/session-stop.test.mjs gateway/sessions/session-resume.test.mjs gateway/sessions/session-runtime-state.test.mjs gateway/sessions/session-coordinator.test.mjs gateway/sessions/task-input-queue.test.mjs gateway/tasks/task-completion.test.mjs gateway/tasks/task-lifecycle.test.mjs`，49 项通过 | 只验证纯状态、队列和恢复契约；真实 Gateway/网络中断仍需 L3 |
| 2026-08-21 | Electron Gateway 崩溃退避 L2 | passed | `node --test desktop-ui/electron/gateway-restart-policy.test.cjs`，3 项通过 | 只验证重启决策；真实 child process 崩溃、窗口重连和侧栏恢复仍需 L3 |
| 2026-08-21 | Electron 源码冷启动与项目加载 | partially verified | 新增路径回归测试覆盖源码/打包分支；实际冷启动日志确认 Gateway 从源码目录启动，桌面请求项目接口并得到 `200` | 尚缺桌面截图和安装包冷启动；不以接口 `200` 代替左栏视觉验收 |
| 2026-08-21 | 真实 Provider 受控普通回复 | partially verified | `gateway/smoke/controlled-provider-acceptance.mjs`：单个 `result`、非空回复、零个重复 `task_completed` | 此为普通单回合，不产生任务最终总结；停止、usage、完整任务终态气泡仍需单独验收 |
| 2026-08-21 | Electron 托管 Gateway 崩溃恢复 | partially verified | 受控终止当前 Electron child 后，日志记录一次异常退出、`2s` 退避、重新启动及新的 child PID 监听 | 尚缺桌面 WebSocket 自动重连、会话 resume 与侧栏的可视化验收 |
| 2026-08-21 | 真实连续停止 | partially verified | `gateway/smoke/controlled-stop-acceptance.mjs`：受控单回合连续发送两次 stop，只收到一个 `generation_stopped`，零个 `task_completed` 与 `result` | 已修复重建阶段主 turn 重复通知；补充输入、Workflow 和桌面气泡仍需独立验收 |
| 2026-08-21 | 真实补充消息 | partially verified | Bridge 桌面会话 `e448b5cd` 中补充消息和非空回复可见 | Provider 未遵从“只回复、不执行验证”约束而创建 Balanced 验证活动；需修正任务分级后复验 |
| 2026-08-21 | 真实补充指令 Gateway 队列 | passed | `BRIDGE_RUN_CONTROLLED_SUPPLEMENTAL_ACCEPTANCE=1 node gateway/smoke/controlled-supplemental-input-acceptance.mjs`：两个 messageId 被接受，队列位置 `[0,1]`，两个 result，唯一 task_completed 晚于第二个 result | Gateway 队列证据已由下方真实桌面补充消息 L3 验收补齐 |
| 2026-08-21 | 真实桌面 WebSocket 重连 | passed | 受控终止 Electron Gateway child；新 child 自动监听 `127.0.0.1:3456`。桌面保留项目、会话和历史气泡，顶部最终显示“就绪” | 运行时 UUID 在 Gateway 重启后不存在时，服务端按契约返回 4000；前端已改为基于原 SDK 历史会话重建运行态，未产生循环重连 |
| 2026-08-21 | 固定模型真实受控回合 | partially verified | 不同实际模型间切换显示三种上下文选择；取消后输入保留且未新增用户气泡，选择完整历史后出现一条用户气泡和非空 Provider 回复 | 有限交接摘要路径及 Provider usage 账本仍需独立验收；不推断缓存命中或费用 |
| 2026-08-21 | Light 审查活动展示 | passed | 新 Electron 实例的真实 Light 受控回合未显示“开始定向审查”；实际回复和运行模型均可见 | 已验证显式审查事件过滤；其他档位的完整活动时间线不由此行覆盖 |
| 2026-08-21 | 正常入口冷启动恢复 | passed | 关闭带调试端口的验收实例后按 `electron .` 启动；项目、历史会话、非空 Provider 回复和 Gateway 连接均恢复 | 仅覆盖源码入口，不代表安装包升级/签名验收 |
| 2026-08-21 | 真实桌面终态呈现回归 | passed | 重新构建并重启源码 Electron；只读任务正确标记 `explicit_read_only / independent_simple_question` 与 `Light`。修复重复总结和终态 busy 后，真实成功回合只在“任务已完成”之后显示一个权威 AI 总结，输入区恢复；终态探针为 `active=false`、`pendingInputs=0`、`canSend=true` | 本项已关闭；安装包、签名和升级归入 P3 |
| 2026-08-21 | 桌面停止与 Workflow L3 | passed | 受控只读 Code Review 真实进入 `Review`，3 个 reviewer Agent 已启动；桌面停止后先显示“工作流已暂停”，随后显示“任务已停止/任务已取消”，无成功总结；Workflow 脚本启动未再出现 `cwd` 异常 | 本项已关闭 |
| 2026-08-21 | 普通消息与补充消息 L3 | passed | 真实桌面普通任务正确路由 `Light/query`，成功总结位于末尾唯一 AI 气泡；运行中补充消息显示已接收，两条输入按顺序消费，补充要求进入末尾总结；终态探针为 `active=false`、`pendingInputs=0`、`canSend=true` | 本项已关闭；安装包冷启动仍按独立 Electron L3 行验收 |
| 2026-08-21 | 真实 Provider 模型 handoff | passed | `BRIDGE_RUN_CONTROLLED_MODEL_HANDOFF_ACCEPTANCE=1 node gateway/smoke/controlled-model-handoff-acceptance.mjs`：两个真实回合均收到 `result`，观察到 `handoff_summary` 与 `cross_model_unavailable`，最终回复非空 | 本项 handoff 策略已关闭；同模型重连、timeout/cancellation 和 Provider 账单核对仍未关闭 |
| 2026-08-22 | 重启后真实 Provider 与串行生命周期验收 | partially passed | 重启源码 Gateway 后，普通 Provider、handoff、停止脚本通过；补充脚本串行运行通过（2 accepted、2 result、唯一 completion）；SQLite 新 usage 行已产生 | 同模型重连、timeout/cancellation、账单核对仍未关闭；并发运行多个真实 Provider 验收会造成上游回合延迟，后续验收必须串行 |
| 2026-08-22 | 真实同模型重连 | passed | `controlled-same-model-reconnect-acceptance.mjs`：`resumed=true`、2 个 result、策略 `reuse_same_session`、资格 `same_partition_possible` | 不代表 Provider cache hit 或免费重连；timeout 和账单核对仍需外部证据 |
| 2026-08-22 | 真实 Provider idle timeout | passed | 本轮 NSIS `win-unpacked` 以 `BRIDGE_STREAM_IDLE_TIMEOUT_MS=30000` 和显式测试 relay idle 注入启动；`BRIDGE_RUN_CONTROLLED_TIMEOUT_ACCEPTANCE=1 node gateway/smoke/controlled-timeout-acceptance.mjs` 输出 `verified=true`、`timeoutCode=stream_idle_timeout`、`resultCount=0` | 仅测试变量开启时延迟真实上游请求，随后已重启无测试变量的正常 Desktop；这证明 Bridge watchdog 收口，不替代供应商 SLA |
| 2026-08-22 | Windows 1.5.0 安装/启动/卸载烟测 | passed | 新 NSIS 安装包在临时目录安装退出码为 0；安装后的打包应用启动并使 Gateway 真实监听 `127.0.0.1:3456`；静默卸载退出码为 0 且安装目录已清理 | 仅关闭安装/启动/卸载烟测；覆盖升级、数据保留、失败回滚和签名仍未验证 |
| 2026-08-22 | Windows 覆盖升级、数据保留与卸载边界 | passed | 临时安装目录从 1.4.2 覆盖升级到 1.5.0；专用 `BRIDGE_HOME` 的 sentinel、SQLite `bridge-state.db` 与 token 保留，升级后 Gateway 监听 `3456`；静默卸载只删除安装目录，保留专用数据目录 | 旧 1.4.2 包缺少 Gateway 运行依赖，不能作为旧版可启动证据；中断安装的原子回滚和签名仍未验证 |
| 2026-08-22 | 微信 IM 主动投递 | blocked_external | 手工投递复用运行中微信适配器的配对白名单、outbox 和重试链路；平台返回 `HTTP 200 / ret=-2`，Bridge 入队且不宣称送达；定向 IM 契约测试 14/14 通过 | 仅影响无入站会话的主动推送，需要在微信 Bot 侧重新建立有效会话或重新扫码授权 |
| 2026-08-23 | 微信会话双向收发 | passed（用户实测） | 用户微信发送的信息可进入 Bridge 会话，任务完成后可收到微信回复；与 IM runner、终态 outbox 契约一致 | 主动推送场景仍单独保持 `blocked_external`，不混入本项 |
| 2026-08-23 | 内置工业拧紧技术方案 Skill | passed | `node scripts/check-builtin-resources.mjs`、内置资源安装测试、Skill 路由测试；manifest 包含 Skill 与 references，技术方案触发词确定性路由，普通代码任务不加载 | 资源内容保持通用，不包含客户、价格、账号、密码或 Provider 凭据 |
