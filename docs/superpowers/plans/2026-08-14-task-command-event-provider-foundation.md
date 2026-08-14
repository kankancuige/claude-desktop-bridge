# Task Command, Event Journal And Provider Foundation Implementation Plan

> **For agentic workers:** 按任务顺序实现并在每个阶段运行对应验证；本计划由当前会话直接执行，不自动提交。

**Goal:** 统一桌面与 IM 任务入口，为 Bridge 自有任务事实增加可恢复事件日志，并让 Agent 调用通过可校验、可释放的 Provider 边界。

**Architecture:** `TaskCommandService` 负责接收、观察和取消任务，WebSocket 与 IM 只做协议适配。`SessionEventJournal` 保存不含正文的 Bridge 领域事件并投影任务状态；`ProviderRegistry` 管理 Agent Provider 和能力声明，Claude SDK 是首个实现。

**Tech Stack:** Node.js ESM、Claude Agent SDK、WebSocket、JSONL、Node test runner、Vue 3、TypeScript。

## Global Constraints

- 不新增依赖，不替换 Claude SDK transcript，不复制用户或 assistant 正文。
- 保留当前 dirty worktree，禁止自动 commit、push 或修改全局配置。
- 所有持久化 payload 必须可序列化、脱敏并有大小上限。
- IM 平台 ACK 前仍必须完成 durable inbox claim；任务接受事件持久化失败不得返回 accepted。
- 旧 WebSocket 协议和 `bridge-task-state` 在迁移期保留。

---

### Task 1: Task Command 契约与事件通道

**Files:**
- Create: `gateway/task-command.mjs`
- Create: `gateway/task-command.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Produces: `createTaskCommandService({submit, cancel})`、`normalizeTaskCommand()`、`TaskCommandService.submitTask/observeTask/cancelTask/publish/dispose`。

- [x] 写失败用例：非法 source/content、身份过滤、observer disposer 幂等、服务停止后拒绝提交。
- [x] 实现纯契约和 observer channel，单个 listener 异常不得阻断其他 listener。
- [x] 将现有 WebSocket `user_message` 处理体提取为 `submitTaskCommand()`，WebSocket 只发送结构化结果。
- [x] 将 `stop_generation` 通过 `cancelTask()` 调用现有统一停止逻辑。
- [x] 运行 `node --test gateway/task-command.test.mjs gateway/turn-routing.test.mjs gateway/session-task-queue.test.mjs`。

### Task 2: IM 统一提交与观察

**Files:**
- Create: `gateway/im-task-runner.mjs`
- Create: `gateway/im-task-runner.test.mjs`
- Modify: `gateway/wechat.mjs`
- Modify: `gateway/feishu.mjs`
- Modify: `gateway/dingtalk.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `TaskCommandService.submitTask()`、`observeTask()`。
- Produces: `runImTask(options)`；adapter starter 接收 `{taskCommands}` 依赖。

- [x] 写失败用例：accepted 后按 turnId 过滤、重复/拒绝、权限请求、task terminal、observer 中断和 timeout。
- [x] 实现共享 IM turn runner，统一回复累积、工具进度、确认请求和最终收尾。
- [x] 三个平台删除任务 WebSocket `injectAndWait`，保留各自平台收发、配对、durable inbox 和通知 outbox。
- [x] Adapter stop 取消 observer/timeout，但不重复提交已经 accepted 的任务。
- [x] 运行 `node --test gateway/im-task-runner.test.mjs gateway/im-input.test.mjs gateway/im-turn-finish.test.mjs gateway/im-turn-timeout.test.mjs gateway/im-inbox.test.mjs`。

### Task 3: Session Event Journal

**Files:**
- Create: `gateway/session-event-journal.mjs`
- Create: `gateway/session-event-journal.test.mjs`
- Modify: `gateway/session-runtime.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Produces: `SessionEventJournal.append/read/projectTaskState/close`、`sessionEventStorePath()`。
- Consumes: `normalizeTaskState()`。

- [x] 写失败用例：连续 seq、不可序列化 payload、尾部半行、序列中断、容量压缩、Prompt/secret 字段拒绝。
- [x] 实现每 Session JSONL journal，关键接受事件同步持久化，其余事件按调用顺序写入。
- [x] `task/accepted` 先写成功再返回 accepted；任务状态变化写 `task/state-changed`。
- [x] Workflow、Agent、runtime failure 和 stop 写入对应领域事件，不记录正文与完整工具结果。
- [x] Session 创建时优先从 journal 投影 task state，缺失或损坏时回退 `bridge-task-state`。
- [x] 运行 `node --test gateway/session-event-journal.test.mjs gateway/task-state.test.mjs gateway/session-runtime.test.mjs gateway/task-lifecycle.test.mjs`。

### Task 4: Agent Capability 与 Provider Registry

**Files:**
- Create: `gateway/provider-registry.mjs`
- Create: `gateway/provider-registry.test.mjs`
- Create: `gateway/agent-capabilities.mjs`
- Create: `gateway/agent-capabilities.test.mjs`
- Modify: `gateway/index.mjs`
- Modify: `gateway/workflow-runner.mjs`

**Interfaces:**
- Produces: `createProviderRegistry()`、`normalizeAgentCapabilities()`、`assertAgentCapabilities()`。
- Registers: `agent/claude-sdk`，provider 方法 `start({prompt, options}, requirements)`。

- [x] 写失败用例：重复注册、未知 Provider、缺少能力、幂等 disposer、`disposeAll()` 隔离错误。
- [x] 实现 registry 和 Agent capability 校验，错误码固定为 `AGENT_CAPABILITY_UNSUPPORTED`。
- [x] 注册 Claude SDK Provider；主 Session、scheduled Session 和 Workflow Agent 统一通过 provider `start()`。
- [x] schema、resume、model override 和 write requirement 在调用 SDK 前检查。
- [x] Gateway shutdown 调用 registry `disposeAll()`。
- [x] 运行 `node --test gateway/provider-registry.test.mjs gateway/agent-capabilities.test.mjs gateway/workflow-agent-session.test.mjs gateway/workflow-script.test.mjs`。

### Task 5: Architecture Traceability And Verification

**Files:**
- Modify: `docs/architecture/system-design-baseline.md`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/target-design.md`
- Modify: `docs/architecture/migration-plan.md`

**Interfaces:**
- Records: command/event/provider contracts、兼容窗口、失败恢复和下一阶段触发条件。

- [x] 更新架构文档，使四项需求分别可追踪到契约、代码、测试和验收证据。
- [x] 运行 Gateway 全量 `node --test gateway/*.test.mjs`。
- [x] 在 `desktop-ui` 运行全部 Node 测试、`npx vue-tsc --noEmit` 和 `npx vite build`。
- [x] 运行 Gateway 全部 149 个 MJS 的 `node --check`。
- [x] 运行 `git diff --check`、严格 UTF-8/乱码扫描和敏感信息扫描。
- [ ] 启动开发环境，验证桌面任务提交、停止、重连快照；无真实 IM 凭据时明确记录 IM 端到端 blocker。

2026-08-14 静态验收证据：Gateway 73 个测试文件共 263/263、桌面端 18 个测试文件共 80/80、149 个 Gateway MJS 语法检查、Vue 类型检查和 Vite 生产构建均返回 0。真实桌面交互、强制崩溃恢复及微信/飞书/钉钉端到端仍需在获准启动服务并具备真实凭据后验收。

## Self-Review

- Spec coverage：统一入口、事件日志、能力声明和 Provider 边界分别由 Task 1-4 覆盖，Task 5 统一验收。
- Placeholder scan：计划不包含 TBD、TODO 或省略实现。
- Type consistency：IM、WebSocket 和 Gateway 都消费同一 `TaskCommandService`；Provider requirements 只使用 `AgentCapabilities` 六个字段。
- Commit policy：用户未授权 commit/push，因此所有 commit 步骤均省略。
