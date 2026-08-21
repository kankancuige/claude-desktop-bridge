# Bridge 内置资源固化与开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Bridge 自己维护的 MCP、Skill、Rule、Agent、Hook、Command 和 Workflow 作为随安装提供的内置资源，并支持逐项持久化启用/关闭，同时保护用户自定义资源和敏感配置。

**Architecture:** 在 `gateway/builtin-resources` 建立版本化 manifest 和资源目录，`builtin-resources.mjs` 负责清单读取、安装、checksum/自定义检测及开关状态。Bridge 私有目录仍是运行时工作副本；首次启动只补齐缺失资源，升级仅替换未被用户修改的旧内置副本。所有加载入口通过资源状态过滤，MCP 的密钥和本地命令只保留在用户 `settings.json`，不进入安装包。前端设置页通过统一 API 展示和切换资源。

**Tech Stack:** Node.js ESM、Electron Builder `extraResources`、Vue 3/TypeScript、现有 JSON 配置和 Node `crypto/fs`。

## Global Constraints

- 保留现有用户资源、未提交改动和自定义文件；不覆盖已修改文件。
- 所有文件使用 UTF-8，代码注释使用简体中文并解释 WHY。
- 不把 API Key、token、密码、绝对用户路径或可执行用户命令写入内置资源。
- 内置资源开关只改变运行时加载，不删除资源；`required` 生命周期 Hook 默认不可关闭。
- 不新增第三方依赖，不改变 SDK、HTTP API 和现有 MCP 配置契约。
- 修改后执行定向测试、Gateway 全量测试/语法检查、前端类型检查和 `git diff --check`。

---

### Task 1: 资源清单与安装管理器

**Files:**
- Create: `gateway/config/builtin-resources.mjs`
- Create: `gateway/config/builtin-resources.test.mjs`
- Create: `gateway/builtin-resources/manifest.json`
- Create: `gateway/builtin-resources/rules/*.md`
- Create: `gateway/builtin-resources/agents/*.md`
- Create: `gateway/builtin-resources/workflows/*.mjs`
- Create: `gateway/builtin-resources/skills/*/SKILL.md`
- Modify: `gateway/config/bridge-home.mjs`

**Interfaces:**
- `loadBuiltinResourceManifest()` returns `{schemaVersion, resources}`.
- `ensureBuiltinResources({bridgeHome})` returns `{installed, updated, customized, skipped}` and never overwrites customized files.
- `getBuiltinResourceState({bridgeHome})` returns normalized entries with `enabled`, `required`, `installed`, `customized`, `version`.
- `setBuiltinResourceEnabled({bridgeHome, type, id, enabled})` persists only the disabled-resource state.

- [ ] **Step 1: Write failing tests** for manifest validation, missing-file installation, unchanged-file upgrade, customized-file preservation, required resource behavior, and atomic settings persistence.
- [ ] **Step 2: Run `node --test gateway/config/builtin-resources.test.mjs` and confirm the new manager is absent/failing.**
- [ ] **Step 3: Implement manifest/resource manager** using SHA-256, atomic JSON writes, path traversal validation, and a `builtin-resource-state.json` metadata file storing installed checksum/version.
- [ ] **Step 4: Copy only repository-maintained resources** into `gateway/builtin-resources`; classify `.claude/workflows` and Bridge context rules explicitly, exclude `my-workflow.mjs`, test files, caches, node_modules and user home content.
- [ ] **Step 5: Call `ensureBuiltinResources()` during Bridge home preparation** after migration and before runtime loading, preserving the existing migration marker semantics.
- [ ] **Step 6: Run the manager tests and UTF-8/secret scan.**

### Task 2: 统一资源状态 API

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/index.test.mjs` or add `gateway/config/builtin-resource-api.test.mjs`

**Interfaces:**
- `GET /api/config/builtin-resources` returns `{resources:[{id,type,source,enabled,required,installed,customized,version}]}`.
- `PUT /api/config/builtin-resources/:type/:id` accepts `{enabled:boolean}` and returns the updated entry.

- [ ] **Step 1: Add endpoint tests** for all resource types, invalid IDs, required resources, and persistence across a fresh module/config load.
- [ ] **Step 2: Implement endpoint validation** with existing path-security helpers and JSON response/error conventions.
- [ ] **Step 3: Reuse the manager state in existing `/api/config/disabled-skills` and `/api/config/disabled-mcp-plugins` handlers** while retaining backward-compatible response shapes.
- [ ] **Step 4: Run Gateway API tests and verify secrets are redacted.**

### Task 3: 接入运行时加载链

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/agents/skill-router.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/context/bridge-rules.mjs`
- Add focused tests beside each module.

- [ ] **Step 1: Add tests** proving disabled Skill/Rule/Agent/Command/Workflow/MCP resources are absent from SDK options or lists, while custom resources remain available.
- [ ] **Step 2: Filter `loadAgentDefinitions()`, skill routing, rules injection, command list and workflow listing** through the manager; keep user-created files visible and independently editable.
- [ ] **Step 3: Apply MCP enabled state before `sanitizeMcpServers()`** and preserve per-server `enabled:false` behavior.
- [ ] **Step 4: Mark lifecycle hooks `required` and expose optional user hooks through the resource state without disabling Gateway safety hooks by accident.
- [ ] **Step 5: Replace workflow bootstrap duplication with the manifest installer**, keeping existing workflow journal/resume behavior.
- [ ] **Step 6: Run Gateway full tests and syntax checks.**

### Task 4: 前端统一开关面板

**Files:**
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `desktop-ui/src/api.ts` only if the existing API wrapper needs a safe method.
- Add: `desktop-ui/src/builtin-resources.test.mjs` or update existing view test utilities.

- [ ] **Step 1: Add a resource inventory state and load it from `/api/config/builtin-resources`.**
- [ ] **Step 2: Add grouped tabs/filters for Skill、Rule、Agent、Hook、Command、Workflow、MCP and show source, version, installed/customized state.**
- [ ] **Step 3: Add one toggle per resource; disable the toggle for `required` resources and show the reason.**
- [ ] **Step 4: Keep existing CRUD and legacy Skill/MCP toggles synchronized with the unified state.**
- [ ] **Step 5: Verify loading, error, optimistic rollback and refresh behavior in the Vue build.**

### Task 5: 安装包与迁移兼容

**Files:**
- Modify: `desktop-ui/package.json`
- Modify: `desktop-ui/scripts/prebuild.cjs`
- Create: `scripts/check-builtin-resources.mjs`
- Modify: `README.md`, `docs/architecture/current-state.md`, `docs/architecture/target-design.md`

- [ ] **Step 1: Add a prebuild check** that verifies manifest sources exist, no secret patterns/absolute user paths are present, and no test/cache artifacts enter the resource pack.
- [ ] **Step 2: Ensure Electron Builder includes `gateway/builtin-resources` and excludes tests/logs/node_modules only.**
- [ ] **Step 3: Add a packaged-resource smoke check** against the built extraResources directory without launching an external provider.
- [ ] **Step 4: Document installation, custom-resource preservation, enable/disable semantics, rollback and backup behavior.**
- [ ] **Step 5: Run `pnpm build` or the repository’s minimal frontend build gate and report any environment blocker separately.**

### Task 6: 完整回归与交付门禁

**Files:**
- Modify only tests/docs needed by failures.

- [ ] **Step 1: Run Gateway targeted tests, then the full Gateway test command used by the repository.**
- [ ] **Step 2: Run MJS syntax checks, UTF-8 check, secret scan and `git diff --check`.**
- [ ] **Step 3: Run frontend type/build checks and inspect the generated resource pack.**
- [ ] **Step 4: Exercise a temporary Bridge home: first install, restart, disable/enable, customize a file, upgrade checksum, and confirm user content remains intact.**
- [ ] **Step 5: Record remaining runtime/IM/provider limitations as residual risk; do not claim hardware or external MCP validation without evidence.**
