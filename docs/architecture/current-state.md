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
| Claude SDK | 将 conversation transcript 写入 `~/.claude/projects/.../*.jsonl` | `system/init.session_id`、项目扫描实现 |
| `bridge-session-map.json` | Gateway UUID 与 SDK conversation ID 双向映射 | `persistSdkSessionId` |

## 当前关键流程

1. 新建会话：前端 `POST /api/sessions`；新会话可延迟到首条任务再建立 `query()`。恢复/分支会话在 runtime 创建时立即持有 SDK ID，`system/init` 再校正并落盘双向映射。
2. 暂停：前端调用统一 stop API，Gateway 取消主 runtime、待确认请求与排队输入并返回停止范围；前端收到成功结果后回填草稿并转为空闲。暂停是取消，不保存工具执行栈。
3. 应用重启：前端恢复 tab shell；Gateway 内存 sessions 已空时，使用 `historySessionId` 再次 `POST /api/sessions {resume}`；Gateway 将 SDK ID传给 `opts.resume`。
4. 关闭 tab：只关闭 WebSocket并移除 tab shell，不调用 DELETE，所以 transcript 仍在侧栏项目扫描中；当前确认文案声称会中断任务，但实现不会确定性停止后台 query。
5. 历史展示：`loadMessages`/`loadHistory`恢复用户和 assistant 文本；UI-only system 消息、实时工具进度、权限弹窗和宠物状态不是 transcript 正文。
6. 新建会话：仍建立全新 SDK conversation；仅当首条消息是引用性短句时，从最近有效主会话注入有界只读接力上下文，普通独立问题不注入。
7. 项目 Memory：设置页可以管理 `~/.claude/projects/<project>/memory/*.md`，但 Gateway 不会自动把上一会话整理为 Memory，也没有按引用性短句读取最近 transcript 的接力链路。
8. 任务提交：desktop WebSocket 将旧消息协议适配为 `TaskCommand`；微信、飞书、钉钉直接调用同一进程内服务，不再创建到 Gateway 的任务注入 WebSocket。
9. 任务接收：`task/accepted` 先同步写入并 `fsync`；写入失败返回 `session_event_persist_failed` 且回滚输入。后续状态、Workflow/Agent、停止和 runtime 失败写入安全事件投影。
10. Agent 启动：主 Session、定时 Session、query 重建和 Workflow Agent 都通过 `agent/claude-sdk` Provider；只有 Provider 注册适配器可以直接调用 SDK `query()`。
11. 重启恢复：优先从连续 journal 投影任务状态；尾部半行自动修复，中间损坏或序号中断会隔离为 `.corrupt-*` 并回退 `bridge-task-state`。

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
- 本地门禁证据为 Gateway 296/296、桌面端 82/82、156 个 Gateway MJS 语法检查、Vue 类型检查和 Vite 生产构建通过；这些改动仍位于 dirty worktree。真实微信/飞书/钉钉凭据端到端与强制崩溃恢复仍需 runtime 验收。

## Gateway 源码布局补充（2026-08-14）

- `gateway/index.mjs` 仍是 OBSERVED 的唯一组合根和启动入口；Electron 继续按该路径启动，独立运行命令仍为 `node gateway/index.mjs`。
- 领域源码和测试已归入 `shared/`、`security/`、`providers/`、`sessions/`、`projects/`、`tasks/`、`agents/`、`workflows/`、`im/`、`context/` 和 `tools/`，测试与源码同目录。
- Gateway 根目录只保留组合入口、package/env 文件、OCR 运行资产、就近说明和人工 smoke 脚本；目录迁移未修改 HTTP/WebSocket API、配置键、transcript、journal、通知 outbox 或其他用户数据路径。
- `index.mjs` 仍接近 10,000 行，目录分类只提高职责可发现性，尚未完成 HTTP router、Session coordinator、SDK stream adapter 和 project repository 的提取。
- 目录迁移后的静态证据为 156 个 MJS 语法检查和 Gateway 296/296 单元测试通过；桌面类型检查、生产构建与真实 IM runtime smoke 在最终门禁阶段补充。
