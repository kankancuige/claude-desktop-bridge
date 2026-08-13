# Task State Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use verification-before-completion before reporting this lifecycle as complete.

**Goal:** Persist the outcome of each main-session task so a Gateway restart cannot turn unfinished work into an apparently completed or blank conversation.

**Architecture:** Claude SDK JSONL remains the conversation source of truth. Gateway stores only a bounded, credential-redacted task status record under `bridge-task-state`; the desktop receives a projection without SDK identity and restores a deliberate continuation action.

**Tech Stack:** Node.js 20 ESM, Claude Agent SDK 0.3.x, Vue 3, TypeScript, Node test runner.

## Global Constraints

- Do not persist prompts, API keys, provider configuration, attachments, or transcript bodies in task-state files.
- Only a persisted `running` state may become `interrupted` after restart; an ordinary historical resume remains idle.
- Deleting a session must remove its task-state records together with snapshots and checkpoints.
- Do not restart the currently running Gateway/Electron without explicit authorization.

## Lifecycle Contract

| Trigger | Stored status | Resumable |
|---|---|---|
| Gateway accepts user input | `running` | after SDK identity is known |
| SDK returns `success` | `succeeded` | no |
| SDK reaches `error_max_turns` | `incomplete` | yes |
| SDK returns execution error | `failed` | when conversation identity exists |
| User stops generation | `stopped` | when conversation identity exists |
| Gateway restarts with stored `running` | `interrupted` | yes |

## Verification

- [x] Task-state normalization, restart recovery, projection and redaction tests.
- [x] Gateway result, stream-error, stop, session-create, `/exists`, and WebSocket snapshot integration.
- [x] Desktop tab snapshot, restart notice, and `Continue` action integration.
- [x] Gateway full tests, desktop full tests, syntax/type checks, production Vite build, and `git diff --check`.
- [ ] Runtime: start a task, terminate Gateway mid-turn, restart, open the same conversation, click `Continue`, and verify the same SDK conversation proceeds.
- [ ] Runtime: repeat from WeChat, Feishu, and DingTalk and verify incomplete/completed notifications match the final SDK outcome.
