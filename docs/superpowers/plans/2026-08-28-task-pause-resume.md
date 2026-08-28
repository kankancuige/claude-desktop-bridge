# Task Pause And Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面输入框的停止操作改为可恢复暂停：空输入时再次点击继续旧任务，输入新内容发送时直接开始新任务。

**Architecture:** 保留 Gateway 现有 `stop_generation -> stopped/interrupted + resumable` 契约和 SDK transcript 所有权。桌面端新增纯函数状态机，把运行中、可继续终态和普通输入映射为暂停、继续、发送三种主操作；中断草稿继续持久化为恢复依据，但不自动写回可编辑输入框。

**Tech Stack:** Vue 3.5、TypeScript 6、Pinia 3、Node.js test runner、Vite 8、Electron 42。

## Global Constraints

- 不新增依赖，不改变 WebSocket `stop_generation` 或 `user_message` 公开消息格式。
- 暂停取消当前 SDK 生成，不承诺恢复进程栈、未完成工具调用或第三方副作用。
- 新内容发送必须走现有新任务入口；不得恢复旧 Coordinator，也不得自动拼接旧任务原文。
- 中断草稿仍按 SDK Session 隔离并持久化，强退恢复后输入框保持为空且显示继续操作。
- 未经用户明确授权不执行 `git commit`、`git push`、安装依赖或启停外部服务。

---

### Task 1: Composer Pause State Machine

**Files:**
- Create: `desktop-ui/src/task-pause-control.ts`
- Create: `desktop-ui/src/task-pause-control.test.mjs`

**Interfaces:**
- Consumes: `busy`、输入文本/附件数量、Lifecycle `canContinue`、持久化 Task State。
- Produces: `resolveComposerTaskAction(input): 'pause' | 'continue' | 'send' | 'disabled'` 和 `isPausedTaskState(taskState): boolean`。

- [x] **Step 1: Write the failing state-machine test**

```js
assert.equal(resolveComposerTaskAction({busy: true, text: '', attachments: 0}), 'pause')
assert.equal(resolveComposerTaskAction({busy: false, canContinue: true, taskState: {status: 'stopped', resumable: true}, text: '', attachments: 0}), 'continue')
assert.equal(resolveComposerTaskAction({busy: false, canContinue: true, taskState: {status: 'stopped', resumable: true}, text: '新任务', attachments: 0}), 'send')
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test desktop-ui/src/task-pause-control.test.mjs`

Expected: FAIL because `task-pause-control.ts` does not exist.

- [x] **Step 3: Implement the pure state machine**

```ts
export type ComposerTaskAction = 'pause' | 'continue' | 'send' | 'disabled'

export function isPausedTaskState(taskState: unknown): boolean
export function resolveComposerTaskAction(input: ComposerTaskActionInput): ComposerTaskAction
```

The implementation must prefer user-entered text or attachments over the paused continuation state, so a new message always resolves to `send`.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test desktop-ui/src/task-pause-control.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit only after explicit user authorization**

Proposed message: `feat(desktop): add composer pause and resume state machine`

### Task 2: Interrupted Draft Projection

**Files:**
- Modify: `desktop-ui/src/session-drafts.ts`
- Modify: `desktop-ui/src/session-drafts.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: existing `SessionDraft.interrupted` and resumable terminal Task State.
- Produces: `shouldPresentSessionDraftInComposer(draft, taskState): boolean`; interrupted resumable text remains retrievable through `getSessionDraft` but is not copied into `inputText`.

- [x] **Step 1: Add the failing draft-projection test**

```js
assert.equal(shouldPresentSessionDraftInComposer({text: '旧任务', interrupted: true}, {status: 'stopped', resumable: true}), false)
assert.equal(shouldPresentSessionDraftInComposer({text: '未发送草稿', interrupted: false}, null), true)
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test desktop-ui/src/session-drafts.test.mjs`

Expected: FAIL because the projection function is not exported.

- [x] **Step 3: Separate resumability from composer restoration**

Keep `shouldRestoreSessionDraft` as the durability gate. Add the presentation function and update `restoreDraftForTab` so interrupted resumable drafts remain stored but do not populate `inputText` or emit the old “请确认后继续发送” notice.

- [x] **Step 4: Run the draft tests and confirm GREEN**

Run: `node --test desktop-ui/src/session-drafts.test.mjs`

Expected: PASS for unsent draft restoration, interrupted recovery eligibility, and hidden interrupted task text.

- [ ] **Step 5: Commit only after explicit user authorization**

Proposed message: `fix(desktop): keep interrupted task text out of composer`

### Task 3: Input Button Pause And Resume Interaction

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`
- Modify: `desktop-ui/src/i18n.ts`
- Modify: `desktop-ui/src/task-lifecycle.test.mjs`

**Interfaces:**
- Consumes: Task 1 action state, existing `requestStopSession`, `buildContinuationPrompt`, `doSend`, and Task 2 persisted interrupted draft.
- Produces: one input-area primary button that pauses while running, resumes when paused and empty, and sends a new task when text/attachments exist.

- [x] **Step 1: Add failing source-level interaction assertions**

Assert that the input action renders from `composerTaskAction`, that `continuePausedTask()` obtains the original task from the current interrupted draft, and that historical message cards no longer expose stale per-message continue buttons.

- [x] **Step 2: Run the desktop tests and confirm RED**

Run: `node --test desktop-ui/src`

Expected: the new interaction assertions fail before the Vue integration exists.

- [x] **Step 3: Implement stop projection without refill**

After a successful primary stop, persist the original and cancelled queued input as an interrupted recovery draft, clear the visible composer, retain the current task identity, and show `任务已暂停` instead of `任务已停止`.

- [x] **Step 4: Implement continue and new-task precedence**

`continuePausedTask()` sends the existing bounded continuation prompt through `doSend`. `sendMessage()` with any new text or attachment remains unchanged and therefore creates a new Gateway task; its optimistic transition clears stale continuation actions and overwrites the interrupted draft with the new accepted task text.

- [x] **Step 5: Render the input control with stable icon states**

Use the existing square stop icon for `pause`, a play icon for `continue`, and the existing send icon for `send`. Add Chinese and English tooltip strings; retain the current opaque button styling and stable dimensions.

- [x] **Step 6: Run focused desktop tests and confirm GREEN**

Run: `node --test desktop-ui/src`

Expected: all desktop source tests pass.

- [ ] **Step 7: Commit only after explicit user authorization**

Proposed message: `feat(desktop): make task stop a resumable composer pause`

### Task 4: Architecture Contract And Verification

**Files:**
- Modify: `docs/architecture/system-design-baseline.md`
- Modify: `docs/architecture/target-design.md`
- Modify: `docs/architecture/adr-context-and-agent-lifecycle.md`
- Modify: `docs/architecture/runtime-acceptance-matrix.md`

**Interfaces:**
- Consumes: verified Gateway behavior that stopped/interrupted tasks are resumable and ordinary text after a terminal task creates a fresh `task/created` event.
- Produces: explicit acceptance contract for pause, restart recovery, resume button, and new-task replacement.

- [x] **Step 1: Record the decision and failure semantics**

Document that pause cancels active runtime work, preserves transcript and interrupted task text, and exposes a resume affordance. Record that sending new content abandons the old paused intent without deleting transcript or rolling back prior side effects.

- [x] **Step 2: Add acceptance rows**

Cover: running -> pause -> resume; running -> pause -> new text; running -> forced process close -> restart -> resume; and forced close -> restart -> new text.

- [x] **Step 3: Run static and build gates**

Run:

```powershell
node --test desktop-ui/src desktop-ui/electron
pnpm exec vue-tsc --noEmit
pnpm exec vite build
git diff --check
```

Expected: tests, type check, and Vite build pass; `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Run representative UI acceptance**

Start the existing Vite development server only with explicit authorization. Verify desktop and narrow/zoomed views for pause, continue, send precedence, tooltip, focus-visible state, and no control overlap. If an external runtime is not authorized, record this as an unverified runtime gate rather than claiming end-to-end completion.

- [ ] **Step 5: Commit only after explicit user authorization**

Proposed message: `docs(lifecycle): define resumable task pause behavior`
