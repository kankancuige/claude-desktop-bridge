# 当前任务状态

## 2026-08-27 确认、等待和提示生命周期全面修复

- 已修复：AskUserQuestion/权限确认的唯一身份、重复结算、重连恢复、IM 并发关联与容量提示、确认后继续执行、Scheduler 无人值守权限、Workflow 快照隔离、Coordinator `waiting_user` 恢复和 AI 活动统计。
- 补充审查修复：DeepSeek/OpenCode 在客户端断开后取消真实上游；DeepSeek SSE 首块实时透传；IM 提交期间 adapter 停止后取消迟到 accepted 的孤儿任务；Workflow/Settings 写失败和模块加载失败显示前端提示；二维码轮询失败停止重复请求并显示过期/错误。
- 追加修复：Workflow 自动触发、手动启动和恢复现在继承会话 `permissionMode`；最终审查 Agent 明确使用只读 `reviewer` 角色，避免完全自动会话被错误判为只读写入冲突。
- Relay 结论：日志中的不同 `requestId` 是不同请求，均为 `attempt: 1`；官方文档支持 429/500/503 的有界重试，但没有找到 Responses 创建请求的幂等保证，因此未猜测性修改 relay 重试协议。
- 验证：`node --test gateway` 829/829；此前 `node --test desktop-ui/src desktop-ui/electron` 174/174；`pnpm exec vue-tsc --noEmit`、`pnpm exec vite build`、相关 `node --check`、`git diff --check` 均通过。Vite 只有既有大 chunk 警告。
- 外部验收缺口：未启动真实 Gateway/Electron/Provider/IM；真实 Provider 重试与计费、三种 IM 投递、Electron 重连 UI、真实确认后 AI 端到端继续执行仍需对应环境证据。
- 约束：未提交、未推送、未安装依赖、未启动或停止外部服务；保留全部既有 dirty worktree 改动。

## 2026-08-26 会话卡住根因与修复

- 根因证据：`WebSynchronous` 对应 Claude CLI 仍在运行；Gateway 日志显示 Codex relay 首次响应前连续 120 秒请求超时并重试，期间 SDK 没有事件，UI 只能显示 stale；权限请求超时还会自动 deny。
- 已修复：Gateway 组合根补齐 `lineDiffStats`/`computeLineDiff` 注入；relay 为请求、每次上游尝试、响应头、重试等待和最终结果增加无凭据阶段日志；SDK 流等待期间每 15 秒广播 `stream_waiting`，UI 显示 Provider/权限/工具等待阶段，且不重置 watchdog。
- 验证：relay/session/UI 定向测试通过；`node --test gateway` 777/777；`node --test desktop-ui/src desktop-ui/electron` 148/148；相关 `node --check` 与 `git diff --check` 通过。
- 未决：当前真实上游 `https://api.claudecode.net.cn` 仍出现请求级超时，需切换可用 Provider 或供应商恢复后再做真实端到端验收；当前 Electron/Gateway 进程未重启，新源码需下次 Gateway 启动加载。

- 更新时间：2026-08-25
- 工作目录：`D:\ckd\Projects\claude-desktop-bridge`
- 用户要求：继续执行到本地使用场景达到理想状态；签名不纳入验收；不得提交或推送。
- 主计划：`docs/superpowers/plans/2026-08-25-quality-closure.md`

## 已完成并已验证

- Session State Port 已加入：`gateway/runtime/session-state-port.mjs`；定向 Session State/Session Runtime 测试通过。
- IM Runtime 已去除 `bridgeStateDb` 直接依赖，改为 `getNotificationRepository` 和领域 `im` Repository。
- 新增 `gateway/storage/repositories/notification-repository.mjs` 及测试；StorageGateway 在状态加载后组装通知 Repository。
- 新增 `gateway/runtime/scheduled-task-store.mjs` 及测试；Scheduler 通过 Store 读取/恢复任务，HTTP CRUD 通过 Store 持久化并具备写失败回滚。
- Workflow Runner 已增加 `AsyncLocalStorage` 依赖上下文和 `createWorkflowRuntime()`；Gateway 的 Workflow/自动触发/HTTP 相关调用已接入运行端口，生产运行时不再使用 `setDeps`。
- Session 状态存储和 Task 状态存储优先使用 Session/Workbench Repository，缺失时保留兼容降级路径。
- Pitfall Service、Memory、IM Inbox/Outbox 均已改为领域 Repository-only；兼容适配器只位于 `storage/` 和测试 fixture。
- Host Smoke 已改为使用当前 PostgreSQL Pitfall Repository 接口，避免旧 `stateStore` 参数导致 CI 失败。
- Memory 设置页已将 `postgres` 识别为正常索引状态，旧 `sqlite`、缺失和未知模式显示为降级。
- 相关定向测试、语法检查和 `git diff --check` 已通过。
- Session/Task/Coordinator/Workflow 运行时已切换到领域 Repository/实例端口；新增 `runtime-context` 与组合根静态门禁。
- `node --test gateway` 最新结果：`762/762` 通过。
- `node --test desktop-ui/src desktop-ui/electron` 最新结果：`141/141` 通过。
- `node scripts/check-builtin-resources.mjs` 最新结果：`64` 项通过。
- `pnpm exec vue-tsc --noEmit` 通过。
- `pnpm exec vite build` 通过。
- `node gateway/smoke/general-workbench-smoke.mjs` 最新结果：L2 Smoke 通过；外部 Provider、Desktop、IM、代表性项目仍按脚本明确为 `not_verified`。
- `pnpm build` 已生成当前版本 `Claude Desktop Bridge Setup 1.6.1.exe`；本地未签名包符合本地使用范围。
- 1.6.1 隔离安装/冷启动烟测通过：临时安装包启动后短窗口观察到 3456、8787、8788、8789 监听，Gateway 日志确认 PostgreSQL 初始化、Gateway 启动和 WebSocket 连接。
- 修复真实启动回归：Workflow 运行端口提前声明，Final Review/Auto Trigger 使用正确的 `runWfScript` 契约；Startup Runtime 优先使用组合根 Coordinator/Pitfall Service。
- 真实源码 Gateway 启动验收通过：`/api/health` 200，`stateStoreMode=postgres`、`stateStoreDegraded=false`、PostgreSQL 17.11；`/api/projects` 200。
- Memory 已预留 `schemaVersion`、`memoryType`、`parentKey`、L0/L1 摘要和正文 hash；摘要回填支持批次、keyset checkpoint、dry-run、取消和失败续跑。
- Memory 规模策略已提供 flat/summary/hierarchical 诊断接口，默认仍保持关键词召回，不强制 embedding 或层级召回。
- 成功任务收口已接入自动 Memory candidate：只解析用户原始请求中的明确长期约定，按项目+内容稳定去重；失败/暂停不沉淀，candidate 仍需显式审批。
- 自动沉淀已通过 `captureAutomaticMemory` 运行端口注入，完成运行时不直接依赖 Memory 解析器、项目编码或 PostgreSQL Repository。
- 全局低耦合规则已加入 `gateway/context/BRIDGE_RULES.md`：要求稳定 port、依赖注入、组合根接线、adapter 边界、无循环/反向依赖以及 fake/contract test。
- Bridge 专属低耦合规则已加入 `gateway/context/BRIDGE_PROJECT_RULES.md`：明确 Gateway 组合根、PostgreSQL Memory 唯一主存储入口、Memory 纯规则边界、HTTP/Renderer 分层和 compatibility adapter；`gateway/builtin-resources/rules` 发布副本已同步。
- 设置页 Memory 摘要已改为读取 PostgreSQL 主存储；没有本地 `memory/*.md` 兼容副本的数据库记录也会展示，旧文件路径提示已改为兼容副本说明。

## 2026-08-25 本轮全量回归证据

- `node --test gateway`：`762/762` 通过，包含 Runtime Context、Composition Root、Repository wiring、Memory 自动沉淀/分层/回填/规模策略、自动捕获端口和启动接线门禁。
- 本轮修复后 `node --test gateway`：`763/763` 通过，新增 PostgreSQL-only Memory 设置页读取和摘要接线门禁。
- `node --test gateway/context/bridge-rules.test.mjs`：`3/3` 通过，覆盖低耦合通用规则、Bridge 专属模块边界和仓库/外部项目注入隔离。
- 四份规则文件源码/内置副本哈希一致；`git diff --check` 无 whitespace error（仅既有 LF/CRLF 提示）。
- `node --test desktop-ui/src desktop-ui/electron`：`141/141` 通过，包含新增 Memory PostgreSQL 状态回归。
- `node gateway/smoke/general-workbench-smoke.mjs`：退出码 0，输出 `ok=true`、`task.status=succeeded`、`evidence.level=L2`。
- 新增组合根启动接线门禁，覆盖 Workflow `runWfScript` 和 Startup Coordinator 优先级。
- `pnpm exec vue-tsc --noEmit`：通过。
- `pnpm exec vite build`：通过。
- `node scripts/check-builtin-resources.mjs`：64 项通过。
- Gateway 493 个排除依赖与内置 Workflow DSL 的源码文件 `node --check`：全部通过；内置 DSL 由专用 async 编译测试覆盖。
- `node gateway/smoke/general-workbench-smoke.mjs`：`ok=true`、任务 `succeeded`、证据级别 `L2`；自动 Memory candidate 写入失败不会改变任务成功终态。

## 尚未完成或需要外部环境

- 本轮未启动真实 Gateway/Electron、Provider 或 IM；真实运行时断线恢复、SDK resume、Provider 账单和 IM 主动推送仍需对应环境证据。
- 有界任务计划的 Mailbox 已接入 `state_entries` 与 Workflow Dispatcher；Memory candidate 已接入运行时工厂，审批前保持 `candidate` 状态。
- Electron 安装包签名明确不纳入本地使用验收；1.6.1 覆盖升级、卸载和异常回滚尚未在本轮重新执行。
- 1.6.1 安装/冷启动/静默卸载已完成隔离烟测；覆盖升级和异常回滚仍未在本轮执行。
- 1.5.0→1.6.1 临时覆盖安装探针确认同一目录中的 Gateway 版本为 `1.6.1`，应用文件存在且测试结束无 Bridge 端口残留；中断安装原子回滚未验证。
- 不执行 `git commit` 或 `git push`，除非用户后续明确授权。

## 恢复命令

```powershell
cd D:\ckd\Projects\claude-desktop-bridge
node --test gateway/context/memory-wiring.test.mjs gateway/providers/provider-wiring.test.mjs
node --test gateway
node --check gateway/gateway-runtime-impl.mjs
git diff --check
```

恢复时先读取本文件和主计划，再执行真实 Gateway/Provider/IM/PostgreSQL 验收；不要 reset、checkout 或清理 dirty worktree。

## 组合根最终收敛（2026-08-24）

- 新增 `gateway/runtime/session-upload-runtime.mjs`：集中拥有 Session ID、上传目录安全定位、目录有效性和 TTL/删除清理端口；原组合根不再实现这些辅助函数。
- 新增 `gateway/runtime/push-stream.mjs`：集中拥有 SDK 输入 async iterable 队列，覆盖 FIFO、等待唤醒和关闭语义；组合根不再实现 `PushStream`。
- SDK Stream Runtime 改为直接依赖 `sdkStreamAdapter.toClientEvent`，删除组合根 `convertSdkToWs` 包装；适配器测试覆盖文本、思考、工具、结果、错误和未知事件。
- 新增组合根静态门禁，禁止 pathname 业务分支、直接数据库执行、SDK async iterator、直接 Session Map 状态变更和旧转换器实现。
- `node --test gateway`：`684/684` 通过。
- 变更 Runtime 全部 `node --check` 通过；`git diff --check` 通过（仅保留既有 CRLF 警告，无 whitespace error）。
- `desktop-ui`：`pnpm exec vue-tsc --noEmit` 通过；`pnpm exec vite build` 通过。
- 真实源码 Gateway 探针通过：`/api/health=200`、`stateStoreMode=postgres`、`stateStoreDegraded=false`、PostgreSQL `17.11`；`/api/projects=200`；临时 Session WebSocket 握手成功并已删除临时 Session。
- `gateway-runtime-impl.mjs` 当前约 `1552` 行，剩余是组合根允许的依赖工厂、生命周期、稳定 wrapper 和 route context assembly，不再把“行数少”作为完成标准。
- 外部 Provider 真实账单/缓存读计费、IM 凭据、签名安装升级和供应商故障验收仍未由本地代码门禁替代；本轮不提交、不推送。
