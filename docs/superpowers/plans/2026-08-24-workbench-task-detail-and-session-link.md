# Workbench 任务详情与会话关联实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有低耦合 Gateway/PostgreSQL/Workbench 架构上，为每个顶层任务增加可读名称、任务概述、完整事件记录和准确的关联会话跳转。

**Architecture:** 任务元数据由独立 `TaskMetadataService` 生成并进入 `TaskPlan`，Coordinator 继续只负责阶段和状态；Workbench Repository/Task Event Repository 负责 PostgreSQL 投影读写；Session Link Resolver 负责把任务映射到 Gateway/SDK 会话；HTTP 路由只调用 Repository 和 Resolver，Vue 只消费 DTO。`gateway/index.mjs`、`gateway-runtime.mjs` 和 `gateway-runtime-impl.mjs` 不新增业务判断。

**Tech Stack:** Node.js ESM、PostgreSQL/pg、Node test runner、Vue 3、TypeScript、Vite、现有 Workbench Repository 和 Session Event Journal。

## Global Constraints

- 不重新引入 SQLite；所有结构化任务查询和写入继续通过 PostgreSQL Repository/StorageGateway。
- 不改变现有 `taskId = sessionId:turnId` 语义，不把补充指令创建成新的顶层任务。
- Transcript 正文仍由 Session/SDK 事实源拥有，任务投影只保存结构化元数据、状态、事件摘要和报告。
- `gateway/index.mjs` 继续只负责启动；`gateway-runtime.mjs` 继续只暴露启动边界；不得把任务业务逻辑放回组合根。
- HTTP Router 不直接执行 SQL；前端不直接读取数据库或 Session 内部 Map。
- 保留现有 PostgreSQL、Session Event Journal、HTTP、WebSocket、IM 公开契约；新增字段必须向后兼容。
- 每个任务块先写失败测试，再写最小实现；每块完成后运行定向测试、`node --test gateway`、全部源码 `node --check` 和 `git diff --check`。
- 不执行 commit、push、破坏性 Git 操作或启动外部 Provider 作为代码完成条件。

## 目标数据契约

Workbench 任务 DTO 至少包含：

```ts
type WorkbenchTask = {
  taskId: string
  taskKey: string
  title: string
  summary: string
  goal: string
  requestText: string
  source: 'desktop' | 'wechat' | 'feishu' | 'dingtalk' | 'workflow' | 'scheduled'
  projectKey: string
  sessionId: string
  sdkSessionId?: string | null
  historySessionId?: string | null
  turnId?: string | null
  status: string
  phase?: string | null
  createdAt: number
  updatedAt: number
  completedAt?: number | null
}
```

## Task 1: 任务元数据服务

**Files:**
- Create: `gateway/tasks/task-metadata.mjs`
- Create: `gateway/tasks/task-metadata.test.mjs`
- Modify: `gateway/tasks/task-plan.mjs`
- Modify: `gateway/tasks/task-plan.test.mjs`

**Interfaces:**
- Produces `createTaskMetadata({taskText, content, source, taskId})` returning `{title, summary, goal, requestText, source}`.
- `createTaskPlan(input)` copies the metadata fields without generating IDs or reading storage.

- [x] Write tests for title priority: explicit `taskText`, first meaningful line of `content`, Markdown heading, then bounded body fallback.
- [x] Write tests for whitespace/newline normalization, code-block removal, 80-character title limit, empty input fallback, and source preservation.
- [ ] Run `node --test gateway/tasks/task-metadata.test.mjs gateway/tasks/task-plan.test.mjs` and verify the new tests fail before implementation.
- [x] Implement the pure metadata service with no model call, filesystem access, PostgreSQL access, or runtime globals.
- [x] Add `metadata` input to `createTaskPlan()` and expose flattened `title`, `summary`, `goal`, `requestText`, `source` fields in the returned plan.
- [x] Run the same tests and verify all pass.

## Task 2: 根任务与补充指令投影

**Files:**
- Modify: `gateway/gateway-runtime-impl.mjs`
- Modify: `gateway/tasks/task-state.mjs`
- Modify: `gateway/tasks/task-completion.mjs`
- Create: `gateway/tasks/task-event-payload.mjs`
- Create: `gateway/tasks/task-event-payload.test.mjs`

**Interfaces:**
- `buildTaskEventPayload(type, session, extra)` returns a bounded, serializable event payload containing `taskId`, `sessionId`, `turnId`, `source`, `sequence`, `revision`, and `at`.
- Root task creation calls `createTaskMetadata()` once; active-turn input only creates `task/input-appended`.

- [ ] Add a failing test proving a root request writes `task/created` and `task/accepted` with title/summary/goal/requestText.
- [ ] Add a failing test proving an active-turn supplement keeps the same `taskId` and writes `task/input-appended` instead of `task/created`.
- [ ] Add a failing test proving repeated SDK `result` events do not create duplicate terminal summaries.
- [x] Implement bounded event payload construction and wire metadata into `initializeTaskWorkbenchSession()` and the root task state update.
- [x] Preserve existing `sessionId:turnId` task identity and existing completion gate transitions.
- [x] Persist final reply summary only at terminal transition; do not broadcast it as an intermediate task-completed event.
- [x] Run focused task completion and workflow gate tests.

## Task 3: PostgreSQL 任务投影与事件 Repository

**Files:**
- Create: `gateway/storage/repositories/task-event-repository.mjs`
- Create: `gateway/storage/repositories/task-event-repository.test.mjs`
- Modify: `gateway/storage/repositories/workbench-repository.mjs`
- Modify: `gateway/storage/postgres-state-compat.mjs`
- Modify: `gateway/storage/postgres-state-store.mjs`
- Modify: `gateway/storage/postgres-schema.mjs`
- Modify: corresponding storage tests

**Interfaces:**
- `TaskEventRepository.list({projectKey, taskId, limit, before, after, eventType})` returns events ordered by revision/sequence.
- `WorkbenchRepository.getTaskDetail({projectKey, taskId})` returns task state plus normalized metadata.
- `WorkbenchRepository.listTasks()` returns backward-compatible DTOs with metadata fields.

- [x] Write repository tests for metadata persistence, event ordering, pagination, event-type filtering, duplicate revision idempotency, and project isolation.
- [x] Add metadata to the structured `state_json` projection; do not copy transcript正文 into `task_state`.
- [x] Add task event query support using the existing `task_events` table and parameterized SQL.
- [x] Normalize old rows without metadata: title from plan goal, summary from detail/final reply/report, requestText from plan goal, and empty strings only as final fallback.
- [x] Keep `PostgresStateCompat` as compatibility adapter only; all new callers use Repository ports.
- [x] Run storage-specific tests and verify PostgreSQL failure behavior remains explicit and does not fall back to SQLite.

## Task 4: Session Link Resolver

**Files:**
- Create: `gateway/sessions/session-link-resolver.mjs`
- Create: `gateway/sessions/session-link-resolver.test.mjs`
- Modify: `gateway/sessions/session-map-consistency.mjs` only if a helper is required

**Interfaces:**
- `resolveSessionLink({task, projectKey, lookupGatewaySessionId, lookupSdkSessionId, findTranscript})` returns `{projectKey, encodedDir, sessionId, sdkSessionId, historySessionId, turnId, available}`.

- [x] Write tests for Gateway session ID present, SDK session ID only, mapped session after restart, missing transcript, and cross-project mismatch.
- [x] Implement resolver with explicit precedence: task Gateway session, task history session mapping, SDK session map lookup, then unavailable result.
- [x] Validate project ownership before returning a link.
- [x] Keep resolver independent from HTTP, Vue, WebSocket, and PostgreSQL connection objects.
- [x] Run session-link tests and existing session-map/session-catalog tests.

## Task 5: Workbench HTTP API

**Files:**
- Modify: `gateway/http/workbench-routes.mjs`
- Create or extend: `gateway/http/workbench-routes.test.mjs`
- Modify: `gateway/gateway-runtime-impl.mjs` route context only to inject callbacks

**Interfaces:**
- `GET /api/workbench/tasks` returns metadata fields and supports existing `projectKey`, `activeOnly`, `limit` filters.
- `GET /api/workbench/tasks/:taskId` returns `{task, events, agents, workflows, verification, report, sessionLink}`.
- `GET /api/workbench/tasks/:taskId/events` returns paginated task events.
- `GET /api/workbench/tasks/:taskId/session-link` returns the resolver DTO.

- [x] Write route tests for 200, 404, invalid project/task combinations, pagination, and repository-unavailable responses.
- [x] Add only callback-based repository access; no SQL or Session Map access inside the route module.
- [x] Preserve existing health, project, report, pitfall, and AI-health routes.
- [x] Bound response sizes and strip internal storage fields, credentials, raw prompts, and filesystem paths not required for navigation.
- [x] Run workbench route tests and the complete Gateway suite.

## Task 6: Vue 任务卡片和详情面板

**Files:**
- Modify: `desktop-ui/src/views/workbench-view-model.ts`
- Modify: `desktop-ui/src/views/WorkbenchView.vue`
- Modify: `desktop-ui/src/views/workbench-view-model.test.mjs`

**Interfaces:**
- View model consumes only Workbench DTOs and the new task detail/session-link API.
- `taskDisplayName()` uses `title`, then `summary`, then bounded legacy fallback; it never prefers UUID as the visible title.

- [x] Add view-model tests for title fallback, summary rendering data, old-task normalization, and session-link DTO handling.
- [x] Update task card to show title, summary, status, project, phase, Agent count, and update time.
- [x] Update detail drawer with sections: overview, original request, supplements, Agent/Workflow, timeline, verification, final result, and linked session.
- [x] Add a clear “打开对应会话” action using `encodedDir`, `sessionId`, `taskId`, and `turnId`.
- [x] Add loading, 404, unavailable-session, and stale-task states.
- [x] Replace visible “SQLite projection” and “SQLite 降级” text with PostgreSQL task projection/degraded wording.
- [x] Preserve current tabs, filters, mobile layout, and local read-only behavior.
- [x] Run `pnpm exec vue-tsc --noEmit` and the production Vite build.

## Task 7: Session 页面精确定位任务回合

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: relevant session store/router modules
- Add focused frontend tests for route query handling

- [x] Accept optional `taskId` and `turnId` route query parameters.
- [x] After session loading, locate the matching task boundary/event without changing transcript正文.
- [x] If the turn is unavailable, open the session normally and display a non-blocking “任务回合不可定位” state.
- [ ] Verify clicking two tasks from the same session opens the same session but selects distinct task context.

## Task 8: 旧任务元数据回填

**Files:**
- Create: `gateway/smoke/backfill-workbench-task-metadata.mjs`
- Create: `gateway/smoke/backfill-workbench-task-metadata.test.mjs`
- Modify: docs describing PostgreSQL migration operations

- [x] Implement `--dry-run` output with candidate count, missing fields, and projected titles.
- [x] Implement idempotent backfill through Repository methods only.
- [x] Never alter Transcript正文, delete tasks, or overwrite a non-empty user-customized title.
- [x] Add bounded retry and failure report per task.
- [x] Run dry-run against a fixture before any real database execution.

## Task 9: End-to-end verification and architecture gates

**Files:**
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`
- Modify this plan checklist as tasks close

- [x] Run focused Node tests for metadata, events, repository, session links, and routes.
- [x] Run `node --test gateway` and record pass/fail counts; skipped tests are not passes.
- [x] Run Gateway source syntax checks (DSL workflow files use the dedicated async compile test).
- [x] Run `git diff --check`.
- [x] Run desktop `vue-tsc` and Vite production build.
- [ ] Start the real Gateway and verify `/api/health`, `/api/workbench/tasks`, task detail, task events, session-link, `/api/projects`, and WebSocket handshake.
- [ ] Manually verify: one root request creates one task; supplement keeps the same task; a later independent request creates a second task; both tasks open the correct session context.
- [ ] Verify Gateway restart preserves task title, summary, status, final result, events, and session link.
- [ ] Record real Provider/IM/security-key blockers separately from code status.
- [x] Confirm `index.mjs` and `gateway-runtime.mjs` remain composition boundaries and no new SQL/UI business logic was added there.

## Closure Criteria

- [x] Every visible task has a readable title and summary.
- [x] UUIDs are technical metadata only, not task names.
- [x] Supplement messages remain in the original top-level task.
- [x] Agent, Workflow, verification, report, and final summary belong to the correct task.
- [x] Task detail shows an ordered event history.
- [x] Task detail opens the exact associated session and task turn when available.
- [x] Multiple tasks in one session remain distinguishable.
- [x] PostgreSQL remains the only structured persistence entry point.
- [x] Gateway composition-root boundaries remain intact.
- [ ] Unit, integration, frontend, restart, reconnect, and real desktop acceptance evidence is recorded.

## Implementation Notes (2026-08-24)

- 任务详情已增加 `questions` 投影：根 `task/created` 和每个 `task/input-appended` 都是独立问题项，保留 `taskId`、`sessionId`、`turnId`、摘要、时间和 `sessionLink`。
- 该模型参考 `dashi-taskboard` 的 `Task.conversationRefs`：任务概述与问题记录分离，问题项通过稳定会话/线程绑定打开对应上下文；本项目继续使用 PostgreSQL 和 `sessionId:turnId` 语义，不引入 SQLite。
- Workbench HTTP 层现在统一输出有界公开 DTO：列表、详情、事件和关联对象均限制数量/深度/文本长度，并过滤凭据、原始 prompt 与工作路径等内部字段。
- 执行报告现在关联任务标题/概述；Workbench 详情和设置页展示报告状态、阶段角色、测试、变更文件、验证证据和风险正文，任务/报告 UID 仅作为辅助数据。
- 仍未勾选的验收项是外部运行时证据：真实 Gateway/PostgreSQL/HTTP/WebSocket、手工多任务流程、重启恢复和真实 Provider/IM blocker 记录。这些不能由静态测试或构建替代。
