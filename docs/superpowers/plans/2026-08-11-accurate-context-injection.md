# Accurate Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each turn receive only the tools, project rules, and Skills required by its current intent, while preventing stale local bridge inbox instructions from being treated as desktop user authorization.

**Architecture:** Classify every incoming turn into `light`, `focused`, or `full` using explicit authorization and task signals. Route Skills separately from the context profile using target paths and technical-stack signals. Rebuild a session only when the selected profile or routed Skills change; preserve `full` only for an explicitly continued code task, not for unrelated short questions.

**Tech Stack:** Node.js ESM, `@anthropic-ai/claude-agent-sdk` query options, `node:test`, existing gateway session lifecycle.

## Global Constraints

- Do not modify `D:\hcd\扳手\协航\WindowsFormsApp1` source code in this change.
- Preserve unrelated dirty worktree changes; do not commit, push, install dependencies, or upgrade frameworks.
- Explicit no-write wording has priority over paths, Skills, or inferred task type.
- No credentials, tokens, or external message bodies may be written to logs.

---

### Task 1: Replace sticky two-level classification with intent-aware profiles

**Files:**
- Modify: `gateway/context-profile.mjs`
- Modify: `gateway/context-profile.test.mjs`

**Interfaces:**
- `classifyContextProfile(text, options?)` returns `light`, `focused`, or `full`.
- `nextContextProfile(current, text, options?)` may downgrade `full` for an independent light question and keeps `full` for explicit continuation signals.
- `applyContextProfile(options, profile, model)` keeps light isolation and adds focused read-only tool settings.

- [x] Add tests for explicit no-write (`只分析`, `不要修改`) selecting `focused`, simple model/definition questions selecting `light`, explicit implementation selecting `full`, and independent light questions downgrading an existing `full` session.
- [x] Add tests proving a short `继续` message keeps the current `full` task, while `继续解释这个词` is `light`.
- [x] Implement deterministic precedence: no-write > explicit write > live/external information > file/code evidence > light question > focused default.
- [x] Implement `applyContextProfile` so `light` has no tools/Skills/settings/MCP and `focused` permits only bounded read tools, has no write tools, no agents, and no MCP by default.

### Task 2: Add scoped Skill routing

**Files:**
- Create: `gateway/skill-router.mjs`
- Create: `gateway/skill-router.test.mjs`
- Modify: `gateway/index.mjs:makeQueryOptions`

**Interfaces:**
- `routeSkills({text, workDir, profile, targetFiles})` returns a stable, deduplicated Skill name array.
- `applySkillRoute(options, route)` sets `options.skills` without changing unrelated SDK options.

- [x] Test that protocol/frame/CRC requests route `protocol-parser`, device connection/reconnect requests route `device-driver`, and WinForms UI requests route `ui-winforms` only when UI work is requested.
- [x] Test that a Skill explanation routes no Skills and that light profile always routes an empty list.
- [x] Test that arbitrary paths do not cause all Skills to load.
- [x] Implement route matching from explicit task signals, file extensions, and `workDir` stack evidence; never infer a write authorization from a path alone.
- [x] Pass only the routed Skill names to SDK options; leave `settingSources` empty for light/focused unless the request explicitly requires project rules.

### Task 3: Make session rebuild aware of profile and Skill changes

**Files:**
- Modify: `gateway/index.mjs` session creation and message routing
- Modify: `gateway/context-profile.test.mjs` if integration helpers are extracted

**Interfaces:**
- Session state stores `contextProfile` and `skillRoute`.
- A rebuild is triggered when either changes, while a same-profile turn stays on the existing query.

- [x] Store the initial profile and Skill route in the session instead of forcing resume/new-session defaults to `full`/`light` without intent evaluation.
- [x] Compute the next profile and route before `beginTurn` side effects are committed.
- [x] Rebuild on route/profile changes with the existing resume and pending-message safeguards.
- [x] Log only profile, Skill names, and session prefix; never prompt text or credentials.

### Task 4: Remove the stale Markdown Inbox protocol

**Files:**
- Delete the legacy `D:\hcd\扳手\协航\WindowsFormsApp1\.claude\CLAUDE.md` and `BRIDGE_INBOX.md` protocol files.
- Keep the existing platform JSON Inbox/Outbox adapters as the only message durability path.
- Do not delete platform JSON state or modify WinForms source code.

- [x] Remove the stale Markdown bridge entrypoint so local Claude sessions cannot consume it.
- [x] Keep platform adapter message IDs, durable Inbox state, and retry recovery unchanged.
- [x] Confirm no Gateway code references the deleted Markdown protocol.

### Task 5: Verify the injection contract

**Files:**
- Test: `gateway/context-profile.test.mjs`
- Test: `gateway/skill-router.test.mjs`
- Test: existing gateway unit test suite

- [x] Run focused context and router tests.
- [x] Run all 81 Gateway `node --test *.test.mjs` tests.
- [x] Run `git diff --check` and inspect the final diff for unrelated files.
- [x] Report runtime and external-provider verification gaps separately from passing host tests.
