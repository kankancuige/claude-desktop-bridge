# 通用 AI 编程桌面端架构完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将 Bridge 完善为类似 Codex Desktop 的通用 AI 编程工作台：由一个任务协调器统一管理目标项目上下文、模型、权限、Agent、Skill、Workflow、验证、踩坑记录和最终通知。

**Architecture:** Bridge 保持 Electron + Vue + 单 Gateway 模块化单体。Bridge 负责会话、任务、Agent 调度、资源和消息适配；用户选择的目标项目负责自身代码、构建、测试和运行时。主任务由 `Task Coordinator` 作为唯一权威，专业 Agent 只执行被分配的步骤；普通任务只执行开发和最小验证，复杂任务才执行完整 PIV 流程。`Verification Campaign` 是通用的多轮验证编排器，不绑定 WiFi、扳手或任一具体领域；设备、浏览器、WebSocket 等属于可选目标项目适配器。

**Tech Stack:** Node.js ESM Gateway、Claude Agent SDK、Electron、Vue 3、Pinia、SQLite `bridge-state.db`、JSON/JSONL/Markdown transcript 与资源文件、现有 WebSocket/HTTP/IM 适配器。

**Execution status (2026-08-23):** Task 1–11 的代码、持久化、桌面/IM 消费链和 Host Smoke 已闭合；本轮 Gateway 全量回归、内置资源检查、Gateway 生产依赖审计、Vue 类型检查、Vite 构建和 Windows NSIS 生产构建均有通过证据。真实 Provider 普通回复、补充队列、停止、模型 handoff、同模型重连及受控 idle timeout 均已有 L3/L5 证据；微信入站、会话执行和完成回复的双向链路已有用户实测。Provider 账单/缓存读计费由供应商实际 usage 或账单页面决定，Bridge 不估算费用；签名、失败升级原子回滚和无入站会话的 IM 主动推送属于外部发布门禁，本轮不阻塞代码闭环；认证业务接口按用户要求不纳入本轮验收。工业拧紧与数字工厂项目技术方案 Skill 已作为内置资源接入并加入确定性路由。

**Closure boundary:** Coordinator 是新任务的唯一生产状态主链；SDK result、Workflow 和 Agent 只能提交结构化结果或生命周期事件，不能绕过 Completion Gate。兼容模块仅用于旧投影恢复与兼容测试。`paused`、验证不足、环境阻塞、回归和 RCA 状态均为可恢复或可解释的非成功终态，并生成执行报告。

## Global Constraints

- Bridge 是通用 AI 编程桌面端，不把 WiFi、扳手、Bridge 自身或任何单一目标项目当作核心业务。
- Bridge 仓库规则只在操作 Bridge 仓库时注入；目标项目只加载自身规则、Skill 和项目上下文。
- 保留用户已有改动、会话、transcript、SQLite、配置和自定义资源；不执行 destructive Git 操作。
- 不自动 commit、push、创建 PR、删除用户文件或覆盖用户修改过的内置资源。
- 普通简单问题不得加载完整 Skill、MCP、Agent 或 Workflow；普通开发任务默认不做全量审查。
- API Key、token、密码、本地绝对路径和用户 MCP 命令不得进入内置资源包、日志或 SQLite 正文。
- 所有状态变化必须由 Coordinator 和 Completion Gate 收口；IM 适配器不得自行判断任务完成。
- 任务未达到验证证据要求时只能标记 `inconclusive`、`blocked` 或 `not_verified`，不得声称已修复。
- 新代码使用 UTF-8，注释使用简体中文并解释 WHY；不得使用空 `catch` 或静默吞错。
- 修改后必须运行与风险相称的测试、类型检查、构建、运行时或目标项目验证，并标记缺失证据。

---

## 目标架构与边界

```text
Desktop / WeChat / Feishu / DingTalk
              ↓
        Task Command API
              ↓
        Task Coordinator
   Prime → Decide → Plan → Dispatch
              ↓
        Agent Execution Layer
 Explorer / Planner / Developer / Tester / Reviewer / Runtime
              ↓
       Verification Campaign
              ↓
        Completion Gate
              ↓
 Desktop detailed bubbles + IM final summary
```

### Bridge 边界

- 会话和任务身份、任务步骤、Agent 生命周期、模型档位、权限、资源开关、验证状态、Pitfall 索引和 IM 投递意图。
- 不拥有目标项目业务模型，不替目标项目伪造构建、设备或生产验收结果。

### 目标项目边界

- 项目代码、项目测试、项目构建命令、项目运行时、项目设备或服务、项目本地规则和项目级 Pitfall。
- 目标项目的技术能力通过 Project Context、Skill 和可选 Verification Adapter 提供给 Coordinator。

### 角色数量

- 内置角色目录：`coordinator`、`explorer`、`planner`、`developer`、`frontend-developer`、`backend-developer`、`test-engineer`、`build-validator`、`runtime-validator`、`reviewer`、`security-reviewer`、`release-validator`。
- Light 任务使用 0 个子 Agent；Focused 使用 1 个；Balanced 通常使用 1-2 个；Power 通常使用 3-6 个，最多 8 个。
- 角色目录不等于每次运行全部启用；Coordinator 必须按任务决策动态选择。

## 任务分级契约

| 档位 | 典型任务 | 默认流程 | 子 Agent |
|---|---|---|---:|
| Light | 闲聊、解释配置、模型身份 | 主会话直接回答 | 0 |
| Focused | 查目录、定位文件、只读调用链 | Prime → Explorer → Report | 1 |
| Balanced | 局部代码修改、单模块 Bug | Decide → Developer → Validate | 1-2 |
| Power | 跨模块、持久化、协议、并发、安全、长时间验证 | Prime → Plan → Implement → Validate → Review → Report | 3-6 |

普通任务不因“检查”“看看”自动触发全量审查；只有任务决策、风险触发器或用户明确要求才进入 Reviewer。

---

### Task 1: 建立目标项目上下文层

**Files:**
- Create: `gateway/projects/project-context.mjs`
- Create: `gateway/projects/project-context.test.mjs`
- Modify: `gateway/projects/project-cache.mjs`
- Modify: `gateway/context/context-profile.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `buildProjectContext(workDir, options) -> ProjectContext`
- `loadProjectContext(workDir) -> ProjectContext | null`
- `ProjectContext` 包含 `workDir`、`projectKey`、`languages`、`frameworks`、`packageManager`、`commands`、`rules`、`skills`、`git`、`generatedAt`。

- [x] **Step 1: 写失败测试**：空目录、Vue/Node、Java/Maven、C#、未知项目、无 package manager 时都返回稳定的有限摘要。
- [x] **Step 2: 运行 `node --test gateway/projects/project-context.test.mjs`，确认新接口尚未实现。**
- [x] **Step 3: 实现确定性扫描**：只扫描有限深度和允许文件名，跳过 `.git`、`node_modules`、`target`、`dist`、构建缓存和密钥文件。
- [x] **Step 4: 复用现有 project-cache 和规则解析**，不把完整项目文件内容写入 SQLite。
- [x] **Step 5: 在任务 Prime 阶段加载上下文**；Light 任务不执行项目扫描。
- [x] **Step 6: 运行定向测试、UTF-8 检查和 `git diff --check`。**

### Task 2: 建立 Task Coordinator 与统一任务状态

**Files:**
- Create: `gateway/tasks/task-coordinator.mjs`
- Create: `gateway/tasks/task-coordinator.test.mjs`
- Create: `gateway/tasks/task-plan.mjs`
- Create: `gateway/tasks/task-plan.test.mjs`
- Create: `gateway/tasks/task-contract.mjs`
- Modify: `gateway/tasks/task-lifecycle.mjs`
- Modify: `gateway/tasks/task-command.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `createTaskPlan(input) -> TaskPlan`
- `transitionTask(task, event) -> TaskSnapshot`
- `dispatchTask(taskId) -> Promise<TaskSnapshot>`
- `getTaskSnapshot(taskId) -> TaskSnapshot`
- `TaskPlan` 使用稳定的 `taskId`、`turnId`、`stepId`、`agentRunId`。

- [x] **Step 1: 写失败测试**：接受、规划、运行、验证、暂停、阻塞、恢复、完成、失败、重复事件和迟到 revision。
- [x] **Step 2: 运行定向测试并确认状态聚合接口不存在。**
- [x] **Step 3: 实现状态机**：`accepted`、`planning`、`running`、`verifying`、`reviewing`、`waiting_user`、`paused`、`blocked`、`inconclusive`、`completed`、`failed`、`regression_detected`。
- [x] **Step 4: 将 desktop、微信、飞书、钉钉输入统一转成 Task Command**，保留旧消息协议兼容层，但不保留第二套业务流程。
- [x] **Step 5: 让 SQLite `bridge_task_state` 和现有 Event Journal 保存任务投影与 revision**；transcript 正文继续由 SDK 文件保存。
- [x] **Step 6: 将当前分散的完成判断迁移到 Coordinator，禁止 SDK `result`、单个 Workflow 或单个 Agent 直接发出最终完成。**
- [x] **Step 7: 运行任务生命周期、命令、恢复和重复事件测试。**

### Task 3: 接入 PIV 执行闭环

**Files:**
- Create: `gateway/tasks/task-phase.mjs`
- Create: `gateway/tasks/task-phase.test.mjs`
- Modify: `gateway/tasks/task-decision.mjs`
- Modify: `gateway/tasks/model-routing.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `resolveTaskPhases(decision, context) -> PhasePlan`
- `PhasePlan` 阶段：`prime`、`plan`、`implement`、`validate`、`review`、`report`。

- [x] **Step 1: 写失败测试**：Light 不进入 Prime/Plan；Focused 只进入 Prime；Balanced 不自动进入全量 Review；Power 进入完整流程。
- [x] **Step 2: 将现有 `decideTask()` 输出映射为 PhasePlan**，保留现有复杂度、风险、模型和权限契约。
- [x] **Step 3: 将 `workflow-runner` 限定为步骤编排器**，状态和最终结果回写 Coordinator。
- [x] **Step 4: 为每个阶段广播结构化事件**：开始、完成、失败、阻塞、跳过，事件中必须包含 taskId、stepId、phase、role 和 sequence。
- [x] **Step 5: 将最终报告阶段统一交给 Coordinator，包含实际修改、测试、未验证风险和下一步。**
- [x] **Step 6: 运行任务决策、模型路由、Workflow 状态和自动继续测试。**

### Task 4: Agent Registry 与统一 Agent 协议

**Files:**
- Create: `gateway/agents/agent-registry.mjs`
- Create: `gateway/agents/agent-registry.test.mjs`
- Create: `gateway/agents/agent-dispatcher.mjs`
- Create: `gateway/agents/agent-dispatcher.test.mjs`
- Create: `gateway/agents/agent-result.mjs`
- Create: `gateway/agents/agent-result.test.mjs`
- Modify: `gateway/agents/agent-capabilities.mjs`
- Modify: `gateway/agents/agent-runtime-metadata.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `registerAgent(definition) -> AgentDefinition`
- `resolveAgents(context, decision) -> AgentDefinition[]`
- `dispatchAgent(input) -> Promise<AgentResult>`
- `normalizeAgentResult(value) -> AgentResult`

统一 Agent 输入必须包含：`taskId`、`stepId`、`role`、`goal`、`workDir`、`targetFiles`、`modelTier`、`permissionMode`、`acceptanceCriteria`。

统一 Agent 输出必须包含：`status`、`summary`、`changedFiles`、`tests`、`findings`、`blockers`、`regressions`、`nextAction`。

- [x] **Step 1: 写失败测试**：缺少 taskId/stepId、Agent 越权修改、未执行测试却声称通过、结构化结果非法和能力不支持。
- [x] **Step 2: 实现 Registry**：内置角色和用户自定义 Agent 分开，按项目语言、任务动作和风险筛选。
- [x] **Step 3: 将现有 `loadAgentDefinitions()` 接入 Registry**，保留 Agent 文件编辑和内置资源开关。
- [x] **Step 4: 将 Workflow `agent()` 调用包装为统一 dispatcher**，所有结果回传 Coordinator。
- [x] **Step 5: 为 Developer、Tester、Runtime Validator、Reviewer 增加最小内置定义；语言差异由 Skill 和 Project Context 提供。**
- [x] **Step 6: 运行 Agent 能力、生命周期、结构化结果和权限测试。**

### Task 5: 通用 Verification Campaign 验证活动

**Files:**
- Create: `gateway/validation/verification-campaign.mjs`
- Create: `gateway/validation/verification-campaign.test.mjs`
- Create: `gateway/validation/verification-adapter.mjs`
- Create: `gateway/validation/verification-adapter.test.mjs`
- Create: `gateway/validation/command-adapter.mjs`
- Create: `gateway/validation/command-adapter.test.mjs`
- Modify: `gateway/tasks/task-completion.mjs`
- Modify: `gateway/tasks/task-result-outcome.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `createVerificationCampaign(input) -> Campaign`
- `runVerificationCampaign(campaignId) -> Promise<CampaignResult>`
- `compareVerificationRuns(baseline, candidate) -> Comparison`
- `registerVerificationAdapter(adapter)`

验证引擎只负责通用能力：场景、轮次、基线、候选版本、成功率、失败指纹、回归和证据等级。它不绑定 WiFi、扳手或任一行业。

适配器类型可包括：`command`、`build`、`test`、`runtime`、`browser`、`websocket`、`database`、`device`，其中 device 只是目标项目可选扩展。

- [x] **Step 1: 写失败测试**：单次命令、重复场景、基线/候选对比、失败聚类、新回归、取消、超时和环境阻塞。
- [x] **Step 2: 实现 `VerificationAdapter` 契约**：`prepare`、`execute`、`collectEvidence`、`cleanup`、`evaluate`，每个阶段都有 timeout/cancellation。
- [x] **Step 3: 实现命令适配器**：使用 Project Context 已识别的构建/测试命令，禁止直接执行未经确认的任意字符串。
- [x] **Step 4: 实现验证状态**：`not_started`、`baseline_running`、`candidate_running`、`passed`、`failed`、`inconclusive`、`regression_detected`、`blocked_environment`。
- [x] **Step 5: 引入证据等级**：L0 未验证、L1 静态、L2 Host Test、L3 单次 Runtime、L4 多轮 Runtime、L5 长时间/异常、L6 目标项目端到端。
- [x] **Step 6: 将 `inconclusive`、`blocked_environment` 和 `regression_detected` 接入 Completion Gate，禁止误报完成。**
- [x] **Step 7: 运行验证活动单元测试，并用临时目标项目完成命令适配器 Smoke。**

### Task 6: 修复循环、RCA 和回归保护

**Files:**
- Create: `gateway/tasks/repair-loop.mjs`
- Create: `gateway/tasks/repair-loop.test.mjs`
- Create: `gateway/tasks/failure-fingerprint.mjs`
- Create: `gateway/tasks/failure-fingerprint.test.mjs`
- Create: `gateway/agents/root-cause-agent.mjs`
- Modify: `gateway/tasks/task-coordinator.mjs`
- Modify: `gateway/tasks/task-completion.mjs`

- [x] **Step 1: 写失败测试**：一次失败自动重试、同一策略重复失败、不同策略失败、新回归、外部阻塞和无法复现。
- [x] **Step 2: 实现错误指纹**：结合 error code、模块、阶段、测试失败位置、目标项目和脱敏消息，不使用完整错误文本简单比较。
- [x] **Step 3: 设置默认修复预算**：同类失败自动修复最多 2 次；同一策略重复失败立即停止；第三次只有在 RCA 产生新根因和新策略后才允许。
- [x] **Step 4: 新回归出现时冻结候选方案，记录候选版本与基线差异，不继续叠加 Patch。**
- [x] **Step 5: RCA 输出触发输入、数据转换、状态变化、持久化/消息传递、下游消费、生命周期、并发和架构边界证据。**
- [x] **Step 6: 将任务转为 `diagnosis_required`、`awaiting_reproduction`、`blocked_external` 或 `architecture_change_required`，并要求 Coordinator 决定下一步。**
- [x] **Step 7: 运行修复循环、指纹、取消和回归测试。**

### Task 7: Pitfall Ledger 踩坑知识库

**Files:**
- Create: `gateway/context/pitfall-service.mjs`
- Create: `gateway/context/pitfall-service.test.mjs`
- Create: `gateway/context/pitfall-admin.mjs`
- Create: `gateway/context/pitfall-admin.test.mjs`
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/storage/bridge-state-db.test.mjs`
- Modify: `gateway/context/memory-service.mjs`
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/SettingsView.vue`

**Interfaces:**
- `recordPitfallOccurrence(input) -> PitfallOccurrence`
- `findRelevantPitfalls(context) -> Pitfall[]`
- `transitionPitfall(id, status) -> Pitfall`
- `verifyPitfallPrevention(id, evidence) -> Pitfall`

范围：`global`、`project`、`bridge`。Memory 保存偏好和背景；Pitfall 保存错误、根因、预防和验证，不互相混用。

- [x] **Step 1: 写失败测试**：首次观察、重复指纹、项目隔离、冷却期、确认、缓解、过期和重新激活。
- [x] **Step 2: 新增 SQLite 表**：`bridge_pitfalls`、`bridge_pitfall_occurrences`、`bridge_pitfall_links`；正文只保存脱敏摘要和引用，不保存 Key、Token、完整 transcript。
- [x] **Step 3: 实现状态**：`observed`、`candidate`、`confirmed`、`mitigated`、`retired`。
- [x] **Step 4: 同一 taskId 内同一指纹只记录一次；冷却期内只更新 occurrence，不重复触发 Agent 或用户提示。**
- [x] **Step 5: 任务开始时只注入与目标项目、目标文件、Provider 或验证场景相关的有界提醒。**
- [x] **Step 6: 设置页增加项目 Pitfall 查看、确认、忽略、归档和验证入口。**
- [x] **Step 7: 运行 SQLite、项目隔离、脱敏和重启恢复测试。**

### Task 8: 系统执行报告与 AI 层演进

**Files:**
- Create: `gateway/tasks/task-execution-report.mjs`
- Create: `gateway/tasks/task-execution-report.test.mjs`
- Create: `gateway/context/ai-layer-health.mjs`
- Create: `gateway/context/ai-layer-health.test.mjs`
- Modify: `gateway/index.mjs`
- Modify: `desktop-ui/src/views/SettingsView.vue`

- [x] **Step 1: 写失败测试**：计划偏离、重复重试、被跳过步骤、未命中 Skill、Agent 失败、规则漂移和新 Pitfall 候选。
- [x] **Step 2: 每个任务终态生成有界执行报告**：计划步骤、实际步骤、修改文件、测试、验证证据、重试、回归和未决风险。
- [x] **Step 3: 实现内置资源健康检查**：manifest 完整性、Skill/Agent/Workflow 引用、规则文件编码、资源 checksum 和启用状态。
- [x] **Step 4: 实现规则漂移候选报告**，只报告事实和证据，不自动修改规则、Skill 或 Hook。
- [x] **Step 5: 设置页增加“执行报告”和“AI 层健康”只读视图；规则变更仍需用户确认。**
- [x] **Step 6: 运行报告、资源健康、漂移和空数据测试。**

### Task 9: 内置资源统一管理与运行时接入

**Files:**
- Continue: `gateway/config/builtin-resources.mjs`
- Continue: `gateway/builtin-resources/manifest.json`
- Modify: `gateway/index.mjs`
- Modify: `gateway/agents/skill-router.mjs`
- Modify: `gateway/context/bridge-rules.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `desktop-ui/package.json`

- [x] **Step 1: 为 Skill、Rule、Agent、Hook、Command、Workflow、MCP 完成 manifest 分类和版本字段。**
- [x] **Step 2: 启动时安装缺失内置资源；旧内置 checksum 未变化时允许升级；用户修改过的文件标记 customized 并保留。**
- [x] **Step 3: 统一实现逐项 enable/disable；required 生命周期 Hook 不允许关闭。**
- [x] **Step 4: 接入运行时加载过滤：只加载启用且与当前任务相关的资源；用户自定义资源独立保留。**
- [x] **Step 5: MCP 只固化元数据，不固化密钥、本地命令和路径；保留旧 Skill/MCP 开关 API 兼容。**
- [x] **Step 6: 前端统一显示 source、version、installed、customized、enabled 和 required。**
- [x] **Step 7: 修改 Electron Builder extraResources，执行资源清单、敏感信息和打包 Smoke。**

### Task 10: 桌面端过程显示与 IM 通知出口

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/task-activity.ts`
- Modify: `desktop-ui/src/task-lifecycle.ts`
- Modify: `desktop-ui/src/stores/gateway.js`
- Modify: `gateway/im/im-progress-policy.mjs`
- Create: `gateway/im/im-progress-policy.test.mjs`
- Modify: `gateway/index.mjs`

- [x] **Step 1: 写失败测试**：短任务不发中间进度，长任务发送关键阶段，失败立即通知，最终通知只发送一次。
- [x] **Step 2: 桌面端按事件追加独立步骤气泡**，不把所有实时执行内容覆盖在一个气泡中；底部活动框只显示当前摘要、耗时和 token。
- [x] **Step 3: 展示 Coordinator、Agent 角色、阶段、当前动作、验证轮次、证据等级和阻塞原因。**
- [x] **Step 4: IM 只消费 Coordinator 的关键事件和终态；不直接消费单个 SDK result 或 Agent 完成事件。**
- [x] **Step 5: 长任务使用阶段阈值和时间冷却，避免每个工具调用都推送 IM。**
- [x] **Step 6: 运行桌面事件恢复、刷新、WebSocket 重连和 IM 去重测试。**

### Task 11: 完成门禁、迁移和端到端验收

**Files:**
- Modify: `gateway/tasks/task-completion.mjs`
- Modify: `gateway/tasks/task-lifecycle.mjs`
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/sessions/session-event-journal.mjs`
- Create: `gateway/smoke/general-workbench-smoke.mjs`
- Modify: `README.md`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/target-design.md`
- Modify: `docs/architecture/migration-plan.md`

- [x] **Step 1: 完成门禁只允许以下条件进入 `completed`**：Coordinator 可完成、必需步骤结束、Agent 结果已回传、测试实际执行、必要验证达标、blocking finding 已处理、活动 Workflow/Agent 已结束、通知意图已持久化。
- [x] **Step 2: 为 `not_verified`、`inconclusive`、`blocked_environment`、`regression_detected` 提供稳定的终态解释和继续入口。**
- [x] **Step 3: 设计旧任务迁移：旧 Session/Workflow/journal/transcript/SQLite 可恢复；旧资源和用户自定义文件不覆盖。**
- [x] **Step 4: 使用临时目标项目执行完整 Smoke**：Light 问答、Focused 探索、Balanced 修改+测试、Power 规划+多 Agent+验证、失败重试、Pitfall 提醒、桌面事件和 IM 最终通知。
- [x] **Step 5: 运行 Gateway 全量测试、MJS 语法检查、桌面类型检查、前端生产构建、资源打包检查、UTF-8 检查和 `git diff --check`。**
- [x] **Step 6: 分开记录静态、Host Test、Runtime、目标项目上下文和真实 IM 证据；没有凭据或外部平台条件时明确标记 blocker。**
- [x] **Step 7: 更新 README 和架构文档，说明 Bridge 与目标项目边界、Agent 数量策略、验证证据等级和 Pitfall 生命周期。**

## Agent 与验证调度规则

### 普通目标项目代码任务

```text
Coordinator → Developer → Tester → Completion Gate
```

### 复杂目标项目任务

```text
Coordinator → Explorer → Planner → Developer → Tester → Reviewer → Report
```

### 间歇性或长时间问题

```text
Coordinator → Test Planner → Baseline Campaign → Developer
→ Candidate Campaign → Regression Detector → Completion Gate
```

### 外部环境不可用

```text
静态/Host 验证完成
→ 标记 blocked_environment 或 not_verified
→ 不声称目标项目运行时已修复
```

## 关键失败策略

| 情况 | 处理 |
|---|---|
| 一次测试失败 | 记录失败并允许一次新证据驱动的修复 |
| 同一策略连续失败 | 停止 Patch，进入 RCA |
| 新回归出现 | 冻结候选方案，记录回归并回到稳定基线 |
| 无法稳定复现 | `awaiting_reproduction`，不猜测修改 |
| 外部 Provider/环境失败 | `blocked_external` 或 `blocked_environment` |
| 验证轮次不足 | `inconclusive` |
| Reviewer 仍在运行 | 主任务不能进入 `completed` |
| IM 通知失败 | 任务状态和通知 outbox 分离，按确定性 ID 重试 |

## 验证命令

### Gateway

```powershell
node --test gateway/**/*.test.mjs
Get-ChildItem gateway -Recurse -Filter '*.mjs' | ForEach-Object { node --check $_.FullName }
```

### Desktop UI

```powershell
Set-Location desktop-ui
pnpm exec vue-tsc --noEmit
pnpm build
```

### 资源和编码

```powershell
node scripts/check-builtin-resources.mjs
git diff --check
```

### 目标项目验证

目标项目的构建和测试命令必须从 `ProjectContext.commands` 或用户确认的配置取得，不允许写死为某一种语言或框架。

## 验收标准

- [x] 桌面端、微信、飞书、钉钉使用同一个 Coordinator 和 Task ID。
- [x] Light 任务不加载完整上下文，不启动子 Agent 或 Workflow。
- [x] Balanced 普通代码任务默认只执行 Developer + Tester，不自动全量审查。
- [x] Power 任务能够执行 Prime、Plan、Implement、Validate、Review、Report。
- [x] 所有 Agent 都有统一输入、输出、能力和生命周期协议。
- [x] Workflow 不能绕过 Coordinator 直接结束主任务。
- [x] Verification Campaign 支持一次性、重复、多轮、基线、候选和回归比较。
- [x] 验证不足、环境阻塞和新增回归不会被显示为完成。
- [x] 同一错误在同一任务内不会重复触发完整 Agent 链路。
- [x] Pitfall 按 global/project/bridge 隔离，相关任务才会收到有界提醒。
- [x] 内置资源随安装提供，支持逐项启用/关闭且不覆盖用户修改。
- [x] 桌面端显示详细阶段和 Agent 气泡，IM 只发送关键进度和最终总结。
- [x] 会话、任务、Workflow、验证、Pitfall 和通知在重启后可恢复或明确降级。
- [x] 静态、构建、Host Test、Runtime、E2E 和真实外部环境证据分开记录。

## 非目标与后续扩展

- 不在本计划内实现 Jira、Confluence、PR 自动创建和自动 Push。
- 不在本计划内默认启用 Worktree 并行；只有用户明确要求或目标任务确有隔离价值时再增加。
- 不在本计划内把设备、WiFi、扳手或某个工业领域做成 Bridge 核心模块；它们只能作为目标项目适配器。
- 不在本计划内建立云端多用户调度服务；当前保持单用户桌面端。
- 不在本计划内让 Agent 自由互聊；所有协作通过 Coordinator、Task Step 和结构化结果完成。

## 交付顺序

```text
1. 目标项目上下文
2. Task Coordinator
3. PIV 阶段
4. Agent Registry 和结果协议
5. Developer/Tester/Runtime Validator
6. Verification Campaign
7. 修复循环、RCA、回归保护
8. Pitfall Ledger
9. AI 层执行报告和资源健康
10. 内置资源统一运行时接入
11. 桌面端和 IM 出口
12. 完成门禁、迁移和端到端验收
```

计划完成后，主窗口应按 Task 1 到 Task 11 顺序执行；每个 Task 完成后先运行本 Task 的测试，再进入下一 Task。除非用户另行授权，本计划不包含 commit、push 或发布操作。

---

## 稳定化与模型上下文成本治理（2026-08-21 追加）

### 设计前提

- 模型内部推理缓存属于 Provider；Bridge 不能、也不会尝试在不同模型或不同 Provider 间复制、伪造或共享它。
- 同一 `provider + concrete model` 重建 Query 后，是否命中服务端缓存及如何计费均为 `unknown`，直到 Provider 返回实际用量字段；`resume` 只表示会话连续性，不代表缓存命中、免费或折扣。
- 跨模型的正确性默认优先于成本：用户显式切换模型时默认保留完整会话恢复路径；有界 handoff 仅在用户明确选择或策略明确允许时使用，且必须显示其可能遗漏细节。
- Bridge 只持久化脱敏指纹、原因码、计数、时间和 Provider 实测 usage；不持久化 Prompt、transcript 正文、API Key、绝对路径或模型内部思考。

### Task 12: 真实运行稳定性基线与验收矩阵

**Files:**
- Create: `docs/architecture/runtime-acceptance-matrix.md`
- Modify: `gateway/smoke/general-workbench-smoke.mjs`
- Test: `gateway/smoke/general-workbench-smoke.mjs`

**Interfaces:**
- Consumes: Gateway WebSocket、HTTP session、真实 Provider/IM/桌面端的受控人工环境。
- Produces: L3 Runtime、L4 E2E、L5 外部平台和 L6 真实项目证据状态；未授权或无凭据时必须为 `not_verified`，不是通过。

- [x] **Step 1: 写入验收场景与证据边界**

在矩阵中逐项定义普通消息、补充消息、停止、Gateway 重启、Electron 冷启动、WebSocket 重连、真实 Provider、真实 IM 和代表性目标项目的触发、预期状态、证据文件与失败判据。禁止 Smoke 自动读取真实凭据或发送真实 IM。

- [x] **Step 2: 为本地可测部分补充断言**

```js
assert.equal(result.lifecycle.active, false)
assert.equal(result.task.status, 'succeeded')
assert.equal(result.evidence.level, 'L2')
```

- [x] **Step 3: 运行 Host 验证并记录环境阻塞**

Run: `node gateway/smoke/general-workbench-smoke.mjs`

Expected: 本地场景给出 L2；真实 Provider、桌面、IM 和目标项目未授权时明确 `not_verified`。

### Task 13: 上下文重建、缓存资格与切换策略

**Files:**
- Create: `gateway/context/context-envelope.mjs`
- Create: `gateway/context/context-envelope.test.mjs`
- Create: `gateway/context/context-cache-policy.mjs`
- Create: `gateway/context/context-cache-policy.test.mjs`
- Modify: `gateway/tasks/model-routing.mjs`
- Test: `gateway/tasks/model-routing.test.mjs`

**Interfaces:**
- `buildContextEnvelope(input) -> {version, providerKey, model, resumeMode, fingerprint, stableDimensions}`：hash 输入只能是已归一化的稳定维度，返回值不得包含 Prompt、Key 或原始路径。
- `compareContextEnvelopes(previous, next) -> {changedDimensions, sameCachePartition}`：partition 至少由 provider identity、具体模型、SDK/API 协议族和稳定上下文指纹隔离。
- `resolveContextReusePolicy({previous, next, providerCapability, switchIntent}) -> {mode, cacheEligibility, reasonCodes, requiresUserChoice}`：`mode` 只能是 `reuse_same_session | rebuild_full_history | handoff_summary | start_fresh`；`cacheEligibility` 只能是 `same_partition_possible | cross_model_unavailable | unknown`。

- [x] **Step 1: 写入失败测试**

```js
assert.equal(policy.cacheEligibility, 'cross_model_unavailable')
assert.equal(policy.requiresUserChoice, true)
assert.equal(policy.mode, 'rebuild_full_history')
```

覆盖同模型稳定输入、模型变化、Provider 变化、规则/Skill/工具/profile 变化、无 resume ID 和 handoff 显式选择。测试必须断言 JSON 序列化结果不含 prompt、secret 或 rawPath。

- [x] **Step 2: 运行红测**

Run: `node --test gateway/context/context-envelope.test.mjs gateway/context/context-cache-policy.test.mjs`

Expected: 因模块尚不存在而失败。

- [x] **Step 3: 实现无副作用策略层**

使用 Node `crypto.createHash('sha256')` 和规范化的白名单字段生成版本化 fingerprint；不同模型永远不报告 `same_partition_possible`。Provider capability 只能缩小已知范围，不能把未知宣称为命中。

- [x] **Step 4: 运行绿测及回归测试**

Run: `node --test gateway/context/context-envelope.test.mjs gateway/context/context-cache-policy.test.mjs gateway/tasks/model-routing.test.mjs`

Expected: 全部通过。

### Task 14: Provider 实测 Usage 与成本证据账本

**Files:**
- Create: `gateway/context/model-usage.mjs`
- Create: `gateway/context/model-usage.test.mjs`
- Modify: `gateway/storage/bridge-state-db.mjs`
- Modify: `gateway/storage/bridge-state-db.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `normalizeProviderUsage(rawUsage) -> {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, source}`，`source` 为 `provider_observed | partial | unknown`。
- `createUsageEvent({sessionId, envelope, policy, usage, durationMs, retryCount}) -> event`：不含正文、凭据或内部思考；未返回缓存字段时 `cache*` 为 `null`，不是 `0`。
- `BridgeStateDb.appendModelUsageEvent(event)`：只写入有界脱敏事件及聚合，不建立第二 transcript。

- [x] **Step 1: 写入 usage 正规化和持久化失败测试**

```js
assert.deepEqual(normalizeProviderUsage({input_tokens: 10, output_tokens: 2}), {
  inputTokens: 10, outputTokens: 2, cacheReadInputTokens: null,
  cacheCreationInputTokens: null, source: 'partial',
})
```

覆盖 snake_case/camelCase、缺失字段、非法负数、Provider 返回 cache 字段、数据库不可用降级和事件脱敏。

- [x] **Step 2: 实现 ledger 并接入 `result`**

只在 SDK `result` 后写入；Query 重建时另广播重建策略事件，但不合成 token 或账单金额。SQLite schema 迁移必须幂等，失败时以可见 `state_store_degraded` 降级。

- [x] **Step 3: 运行验证**

Run: `node --test gateway/context/model-usage.test.mjs gateway/storage/bridge-state-db.test.mjs`

Expected: usage 字段、脱敏和重启后的聚合均可验证；缺失 Provider 字段仍为未知。

### Task 15: 模型切换 handoff 与用户选择

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/projects/project-continuation-context.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Create: `desktop-ui/src/model-context-switch.ts`
- Create: `desktop-ui/src/model-context-switch.test.mjs`

**Interfaces:**
- Gateway 在回合边界广播 `context_rebuild_policy`，包含 `policy`、reason code、cache eligibility 和不可信成本说明；不得广播 fingerprint 输入或 Prompt。
- Desktop 返回 `contextSwitchMode: full_history | handoff_summary | cancel`；`cancel` 不创建 Query、不提交用户消息。
- handoff 只含任务目标、已确认事实、已改文件、验证证据和未决风险，并标注版本/长度；不得替代完整 transcript。

- [x] **Step 1: 写入模型切换 reducer 红测**

```ts
assert.equal(resolveModelContextSwitch({modelChanged: true}).requiresChoice, true)
assert.equal(resolveModelContextSwitch({modelChanged: false}).mode, 'reuse_same_session')
```

- [x] **Step 2: 在回合边界接入策略**

沿用现有活跃回合继承模型约束。未选择 handoff 时使用 `resume`/完整历史路径；切换模型从不显示为 Provider cache hit。

- [x] **Step 3: 渲染与类型验证**

Run: `node --test desktop-ui/src/model-context-switch.test.mjs; Set-Location desktop-ui; pnpm exec vue-tsc --noEmit; pnpm build`

Expected: 用户可取消、保留完整历史或选择有界 handoff，窄屏与桌面均不覆盖任务输入区。

### Task 16: Gateway Query、输入队列与会话协调器拆分

**Files:**
- Create: `gateway/sessions/task-input-queue.mjs`
- Create: `gateway/sessions/sdk-stream-adapter.mjs`
- Create: `gateway/sessions/session-coordinator.mjs`
- Modify: `gateway/index.mjs`
- Test: 对应 `*.test.mjs`

**Interfaces:**
- 输入队列拥有接受、去重、确认、回滚和取消；SDK Stream Adapter 只转换和清理流；Session Coordinator 拥有 Query rebuild、resume、context policy、timeout 和 cancellation。
- HTTP/WebSocket/IM 继续只调用 Task Command API，原有公开事件和 SQLite/transcript 契约保持兼容。

- [x] **Step 1: 逐模块先写契约测试，再迁移调用点**

每次只移动一个纯边界，运行旧 `session-runtime-state`、`task-lifecycle`、`task-completion` 和新模块测试。不得一次性重写 `gateway/index.mjs`。

- [x] **Step 2: 回归与语法门禁**

Run: `node --test gateway/sessions/*.test.mjs gateway/tasks/*.test.mjs; node --check gateway/index.mjs`

Expected: 补充消息、停止、重建失败、重复回调和 cleanup 仍符合既有生命周期。

### Task 17: 本地可观测性、CI 与发布门禁

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `gateway/smoke/general-workbench-smoke.mjs`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`

**Interfaces:**
- 本地诊断事件包含时长、retry、重建原因、cache capability、usage source 和 cleanup outcome；不发送云端 telemetry。
- CI 必须区分 Gateway Host Test、Vue 类型/构建、资源检查、语法检查、依赖审计和发布包；真实 Provider/IM 验收仍为人工受控门禁。

- [x] **Step 1: 增加不含凭据的诊断断言与 CI job**

```powershell
node --test gateway/**/*.test.mjs
node scripts/check-builtin-resources.mjs
Set-Location desktop-ui; pnpm exec vue-tsc --noEmit; pnpm build
git diff --check
```

- [x] **Step 2: 在用户授权的受控环境执行 L3-L6 验收（Bridge 范围）**

Gateway 或 Electron 启停、真实 Provider 和真实 IM 发送属于外部副作用；执行前确认环境与目标，结果写入 Task 12 矩阵，失败保持 blocker，不降级成成功。

### 追加阶段验收

- [x] 模型切换、Provider 切换、规则/Skill/profile 变动和 resume 缺失均产生可解释策略，且不伪造跨模型缓存共享。
- [x] 同模型重连在无实际 usage 时显示缓存/计费 `unknown`；有 Provider 字段时区分 cache read、cache creation、input 和 output。
- [x] 用户可在模型切换时选择完整历史、受控 handoff 或取消；运行中回合不被切换中断。
- [x] usage ledger、UI 和日志都不保存 Prompt、凭据、绝对路径或推理正文。
- [x] 真实运行验收、CI 和可观测性有明确证据边界，不能由 Host Test 代替。

---

## P0-P4 执行重排与阶段准入（2026-08-21）

本节覆盖前文任务编号的执行顺序。已完成的局部模块保留，但在 P0 的基线与真实生命周期验收关闭前，不继续扩展新的架构能力。端口号不是本计划的验收条件，也不作为排障对象；只在真实启动命令返回冲突时记录为环境 blocker。

### P0：基线与真实生命周期验收

#### P0.1：建立可回滚 Git 基线

**Files:**
- Create: `docs/architecture/git-baseline-candidate-2026-08-21.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Inspect: 全部已跟踪与未跟踪改动、`.gitignore`、`git diff --check`

**Interfaces:**
- 基线候选文档逐项标注 `Gateway`、`Desktop`、`内置资源`、`架构文档` 或 `排除项`，并给出风险、测试证据和回滚范围。
- 只有用户明确授权后，才允许创建只包含候选范围的本地提交；提交 SHA 和工作树剩余改动必须回填到矩阵。

- [x] **Step 1: 只读采集基线候选**

Run: `git status --short; git diff --name-status; git ls-files --others --exclude-standard; git diff --check`

Expected: 每个改动都能分类；未知来源、生成物、凭据风险或与工作台无关的文件均标为排除项，不暂存、不提交、不删除。

- [x] **Step 2: 为候选范围运行完整可重复门禁**

Run: `node --test <全部 Gateway 测试>; node scripts/check-builtin-resources.mjs; Set-Location desktop-ui; pnpm exec vue-tsc --noEmit; pnpm exec vite build`

Expected: 记录精确命令、通过数和失败项。Workflow DSL 只由其专用包装编译测试验证，不以 `node --check` 直接检查 DSL 源文件。

- [x] **Step 3: 等待并执行明确授权的本地提交**

Run: `git add <候选清单>; git commit -m "..."; git status --short; git rev-parse HEAD`

Expected: 仅在用户明确授权“创建本地基线提交”后执行；提交后保留所有排除项和用户已有改动。

2026-08-21 状态：用户已明确授权仅创建本地基线、不推送；fresh 门禁通过 489/489 项 Gateway 测试、61 项内置资源检查、Desktop 类型检查、Vite 生产构建和 `git diff --check`。提交 SHA 与提交后工作树状态由 Git 记录及交接结果提供。

#### P0.2：真实 Provider 与 Desktop 冷启动验收

**Files:**
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Inspect: `desktop-ui/electron/main.cjs`、`gateway/index.mjs`、Provider 配置读取路径

**Interfaces:**
- L3 Desktop Cold Start 记录 Electron 启动、Gateway child process、项目目录与会话列表加载、首条任务气泡、最终总结气泡的位置。
- L4 Provider 记录真实模型请求、同模型重连、模型切换 `full_history | handoff_summary | cancel` 的可见策略及 Provider 实测 usage；未知字段保持 `null`。

- [x] **Step 1: 固化可执行的受控验收脚本与断言**

覆盖：启动后左侧项目/会话可见；普通回答非空；详细步骤只追加独立气泡；最终总结只出现在最后一个完成气泡；跨模型不报告共享推理缓存。

- [x] **Step 2: 在用户明确授权启动 Desktop/Gateway 与真实 Provider 后执行 L3-L4（Bridge 范围）**

Expected: 凭据只从环境或既有配置读取，不打印、不写入文档；结果按 `verified`、`failed` 或 `not_verified` 写入矩阵，L2 不得替代 L3/L4。

2026-08-23 状态：源码 Desktop 冷启动、普通消息、补充消息、停止、重连和崩溃恢复的 L3 已通过；重启 Gateway 后真实 Provider 普通回复、完整历史、取消、串行补充队列、停止、受控 `handoff_summary` 和同模型重连均通过。真实 usage ledger 已采集新行，跨模型记录为 `cross_model_unavailable`，同模型重连记录为 `same_partition_possible`；relay 缺失 usage 字段补零问题已修复并加入回归测试。供应商账单/缓存读计费仍由供应商账户页面决定，作为外部非阻塞核对项，不影响 Bridge 代码闭环。

#### P0.3：补充指令、停止、重连与崩溃恢复

**Files:**
- Modify: `gateway/sessions/session-runtime.mjs`
- Modify: `gateway/sessions/session-runtime-state.mjs`
- Modify: `gateway/sessions/session-coordinator.mjs`
- Modify: `desktop-ui/electron/main.cjs`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Test: `gateway/sessions/*.test.mjs`、新增受控 L2/L3 harness

**Interfaces:**
- 补充指令只通过输入队列进入当前活跃会话；停止必须使本回合及其子资源进入可观察的取消终态；重连必须重建状态而不伪造 cache hit；崩溃恢复必须受 Electron 重启上限与持久化恢复状态约束。

- [x] **Step 1: 先写四类失败路径的确定性 fake-L2 测试**

覆盖输入正在 drain 时补充指令、重复 stop、流中断后重连、Gateway child process 非零退出并恢复；每例断言最终状态、清理结果、用户可见气泡和无重复最终总结。

- [x] **Step 2: 实现并验证最小生命周期补齐**

Run: `node --test gateway/sessions/*.test.mjs gateway/tasks/task-lifecycle.test.mjs gateway/tasks/task-completion.test.mjs`

Expected: 同一故障路径既验证状态机又验证下游 UI/IM 消费事件；无真实授权时只关闭 L2。

- [x] **Step 3: 在用户授权的真实环境执行 L3 恢复验收**

Expected: 手工触发停止、网络中断/重连和受控 Gateway 崩溃；保留实际日志证据但不记录 token、prompt 或绝对路径。

### P1：会话运行时所有权收口

#### P1.1：输入队列与 SDK Stream Adapter

状态：已实现并关闭；P0.3 的真实补充、停止、重连和崩溃恢复 L3 已于 2026-08-21 通过。

#### P1.2：Abort Tree 与 Cleanup Registry

**Files:**
- Create: `gateway/sessions/cleanup-registry.mjs`
- Create: `gateway/sessions/cleanup-registry.test.mjs`
- Modify: `gateway/sessions/session-runtime.mjs`
- Modify: `gateway/sessions/session-coordinator.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- `createCleanupRegistry({parentSignal}) -> {signal, register, abort, dispose, snapshot}`；`register` 返回幂等取消函数，子层不得直接销毁父层资源。
- `abort(reason)` 按子 Query、stream、timer、watchdog、listener 的确定顺序执行一次；清理异常转为结构化 outcome，不吞掉。

- [x] **Step 1: 为父取消、重复 abort、子清理异常、dispose 后注册写红测**
- [x] **Step 2: 将 Query、stream、watchdog 和 stream idle timer 迁移到 registry**；外部 WebSocket/IM listener 仍由各自适配器持有，需在适配器生命周期重构时接入
- [x] **Step 3: 运行会话、任务完成和 IM 回归测试，确认无悬挂 timer/listener**；当前通过 495 项 Gateway 测试及定向生命周期回归

#### P1.3：完成 Session Coordinator 的策略与所有权

**Files:**
- Modify: `gateway/sessions/session-coordinator.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/sessions/session-coordinator.test.mjs`

- [x] **Step 1: 把 context policy、resume、timeout 与 cancellation 归属收口至 Coordinator**
- [x] **Step 2: 保持 HTTP、WebSocket、IM 仅经 Task Command API，不能绕过 Coordinator**
- [x] **Step 3: 验证 Query rebuild、resume 缺失、timeout、重复回调与 cleanup 顺序**

2026-08-22 状态：Coordinator 已持有 context policy、rebuild token、cancel reason 和 stream timeout query 归属；watchdog timer 注册到 Cleanup Registry，取消/过期 query 不再触发 timeout。`session-coordinator`、`session-runtime`、`session-resume`、`task-auto-continuation`、`cleanup-registry` 定向测试通过；HTTP/WebSocket/IM 入口均通过 `TaskCommandService` 提交或取消。真实同模型重连和受控 Provider idle timeout 脚本均已通过；供应商账单核对仍属于 P0.2 外部验收。

### P2：诊断与工作台可观察性

- [x] 本地诊断事件只记录时长、重试、重建原因、usage source、cleanup outcome 和有界错误码；不上传 telemetry，不保存 prompt、凭据、推理正文或绝对路径。
- [x] 建立 Agent 队列、依赖关系与进度 UI，要求步骤状态可恢复、可取消、最终总结只在最后一个完成气泡出现。
- [x] 把这些信号接入 Host Smoke、类型检查与受控 L3 验收矩阵。

2026-08-22 状态：Runtime Diagnostics 已接入 query cleanup、cancel、context rebuild 和 stream timeout；WorkspaceView 已消费 task activity、queue、agentRuns、步骤进度和恢复快照。Host Smoke、Gateway 全量、Vue 类型检查、Vite 构建和真实普通/补充/停止/重连验收通过；真实 IM 与安装包视觉冷启动仍按外部门禁保留。

### P3：交付链路强化

- [x] CI 区分 Gateway、资源包、Vue 类型/构建、依赖审计、安装包与发布制品；真实 Provider/Desktop/IM 仍为人工受控门禁。
- [x] 验证 Windows 安装、覆盖升级、数据保留和卸载边界；不可逆数据操作的现有备份边界已有记录。
- Windows 代码签名与中断安装原子回滚：范围外发布门禁，不纳入本计划完成度。

2026-08-23 状态：`.github/workflows/build.yml` 已分离 quality/build/release 门禁；本地 Windows NSIS 生产构建成功并完成安装、启动、覆盖升级、数据保留和卸载边界验证。签名需要代码签名证书/发布凭据，中断安装原子回滚需要专用发布演练，均保留为外部发布门禁，不作为当前代码闭环 blocker。

### P4：能力扩展

- [x] 在 P0-P3 的契约与可观测性稳定后，再评估第二 Provider、远程执行与高级 Memory。
- [x] 第二 Provider 必须使用显式 capability profile；跨模型/跨 Provider 仍固定为 `cross_model_unavailable`，只能选择完整历史、有限 handoff 或取消，不能宣称共享推理缓存或免费重连。

2026-08-22 状态：新增 `provider-capability-profile`，为 Codex relay、DeepSeek、OpenCode 和未知 Provider 提供显式能力边界；同模型重连仅报告 `same_partition_possible`，跨模型固定 `cross_model_unavailable`。远程执行和高级 Memory 未作为本轮实现范围扩张。

### 阶段完成判定

- [x] P0 的 Bridge 代码与受控真实 Provider/Desktop 证据已闭合；外部授权、供应商账单、签名和主动 IM 推送只保留为非阻塞门禁，不把 L2 伪装为真实验收。
- [x] 每个阶段结束都更新验收矩阵：证据命令/日志、状态、已知风险、回滚点和下一步。
- [x] 任何 Provider 未返回的 usage 或缓存字段写 `null` 与 `unknown`，不得补零、估算成本或把 `resume` 标为缓存命中。
