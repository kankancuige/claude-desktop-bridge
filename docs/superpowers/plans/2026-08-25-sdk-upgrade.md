# Claude Agent SDK Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the task checkpoints below.

**Goal:** Upgrade the Gateway's Claude Agent SDK from `0.3.206` to the current verified `0.3.243` release without changing the public Bridge protocol.

**Architecture:** Keep the existing provider adapter and Session lifecycle ports unchanged. Update only the Gateway dependency declaration and lockfile, then verify the SDK's Query lifecycle, Gateway tests, frontend build, and controlled runtime smoke paths.

**Tech Stack:** Node.js ESM, npm lockfile v3, `@anthropic-ai/claude-agent-sdk`, `node:test`, Vue 3/Vite.

## Global Constraints

- Do not change public HTTP/WebSocket contracts or add dependencies.
- Preserve all existing dirty and untracked user changes.
- Do not commit, push, or start unrelated external services.
- Pin the verified SDK release to `0.3.243` for reproducible deployment.
- Treat SDK package and bundled Claude Code binary behavior as runtime-sensitive and verify process cleanup.

---

### Task 1: Update Gateway SDK Dependency

**Files:**
- Modify: `gateway/package.json`
- Modify: `gateway/package-lock.json`

- [x] Update only `@anthropic-ai/claude-agent-sdk` to exact version `0.3.243` and refresh its lockfile entries.
- [x] Confirm the installed package reports SDK `0.3.243` and Claude Code `2.1.243`.

### Task 2: Run Static and Host Verification

**Files:**
- No source changes expected.

- [x] Run `npm ci`/dependency consistency verification in `gateway` only if needed by the lockfile.
- [x] Run `node --test gateway` and inspect failures rather than treating skipped tests as passes.
- [x] Run `node --check` on changed Gateway runtime modules and `git diff --check`.
- [x] Run `pnpm exec vue-tsc --noEmit` and `pnpm exec vite build` in `desktop-ui`.

### Task 3: Verify Runtime Lifecycle Compatibility

**Files:**
- No source changes expected unless a concrete SDK compatibility regression is reproduced.

- [x] Verify SDK `0.3.243` types expose `close`, `interrupt`, `stopTask`, and `backgroundTasks`; runtime Session cleanup tests exercise `close` and `AbortController`.
- [ ] Run the controlled Gateway stop/timeout smoke tests and confirm the Session reaches inactive state; requires an explicitly authorized running Gateway and Provider configuration.
- [ ] Confirm no native Claude/Agent child process remains after controlled stop and Gateway shutdown; requires the same controlled runtime environment.
- [x] Report Provider credential, billing, IM, packaging, signing, and hardware evidence as outside this local verification scope.
