# Session Resume Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restarting the desktop must restore the same Claude SDK conversation on the first click, with UI history and model context kept consistent.

**Architecture:** The frontend separates selected-tab identity from verified Gateway runtime state. The Gateway treats the requested `resume` value as the authoritative SDK conversation ID after validating its transcript; persisted mappings may select a reusable Gateway runtime but may not substitute another SDK conversation.

**Tech Stack:** Vue 3, TypeScript, Node.js ESM, Claude Agent SDK, Node test runner.

## Global Constraints

- Preserve the dirty worktree, existing transcripts, and public `POST /api/sessions` request contract.
- Add no dependencies and do not commit, push, or restart external services.
- Cover first-click restore, stale Gateway UUID, stale mapping, and legacy encoded-directory fallback.

---

### Task 1: Frontend restore decision

**Files:** `desktop-ui/src/session-selection.ts`, `desktop-ui/src/session-selection.test.mjs`

- [x] Prove that matching local IDs still require runtime validation after restart.
- [x] Implement and run the focused test.

### Task 2: Gateway resume identity

**Files:** `gateway/session-resume.mjs`, `gateway/index.mjs`, `gateway/session-resume.test.mjs`

- [x] Prove a stale mapping cannot replace an explicitly requested SDK transcript.
- [x] Use verified transcript identity for SDK resume; mapping only selects a Gateway runtime.

### Task 3: Integration and verification

**Files:** `desktop-ui/src/views/WorkspaceView.vue`

- [x] Resume a missing runtime by `historySessionId` while retaining bubbles and drafts.
- [x] Run focused tests, full Gateway tests, TypeScript/Vite build, syntax checks, and `git diff --check`.
- [x] Report real desktop restart smoke-test evidence separately.
