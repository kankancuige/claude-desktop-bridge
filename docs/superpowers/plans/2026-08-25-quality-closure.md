 # 当前版本质量闭环 Implementation Plan

 > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

 **Goal:** 修复当前 1.6.1 的自动化门禁与 Memory 用户可见契约，并刷新验收证据，使本地使用场景达到可证实的理想状态；签名发布不纳入目标。

 **Architecture:** 保持 PostgreSQL Repository-only 运行时边界。Host Smoke 使用与生产接口一致的 Pitfall Repository fixture；Memory UI 以后端返回的 `postgres` 模式为唯一正常状态，状态文案集中在现有 i18n。文档只记录本轮新鲜命令和明确外部 blocker。

 **Tech Stack:** Node.js 20、Node test runner、Vue 3/TypeScript、Vite、Electron Builder、PostgreSQL fixture。

 ## Global Constraints

 - 不升级依赖、不改变公开 API、不提交或推送。
 - 保留未相关用户改动；当前工作树应保持干净（忽略构建产物）。
 - 签名、供应商账单和无入站 IM 主动推送不作为本轮完成条件。
 - 完成声明必须有当前命令输出支撑；真实 Provider/IM 受环境限制时标为未验证。

 ---

 ### Task 1: 修复 Host Smoke Repository 接线

 **Files:**
 - Modify: `gateway/smoke/general-workbench-smoke.mjs`
 - Test: `node gateway/smoke/general-workbench-smoke.mjs`

 **Interfaces:**
 - Consumes: `createPostgresStateFixture().store` and `createPitfallRepository({stateStore})`.
 - Produces: Smoke 继续通过 `createPitfallService({repository, cooldownMs})` 验证重复 Pitfall 晋级。

 - [ ] **Step 1: 写最小失败复现**
   Run `node gateway/smoke/general-workbench-smoke.mjs`; expected `PITFALL_STORAGE_REQUIRED`.

 - [ ] **Step 2: 修改 Smoke 使用 Pitfall Repository**
   在 Smoke 中导入 `createPitfallRepository`，将现有 `createPitfallService({stateStore, cooldownMs: 0})` 改为使用 `repository: createPitfallRepository({stateStore})`，保持同一 fixture 生命周期。

 - [ ] **Step 3: 运行 Smoke**
   Run `node gateway/smoke/general-workbench-smoke.mjs`; expected exit 0 and all assertions pass.

 ---

 ### Task 2: 修复 Memory PostgreSQL 状态展示

 **Files:**
 - Create: `desktop-ui/src/memory-mode.ts`
 - Create: `desktop-ui/src/memory-mode.test.mjs`
 - Modify: `desktop-ui/src/views/SettingsView.vue`
 - Modify: `desktop-ui/src/i18n.ts`

 **Interfaces:**
 - Produces `isMemoryIndexReady(mode: unknown): boolean` and `memoryModeLabelKey(mode: unknown): string`.
 - `postgres` is ready; `sqlite`, missing and unknown modes are degraded/legacy states.

 - [ ] **Step 1: 写失败测试**
   覆盖 `postgres` 为 ready，`sqlite`/null 为 degraded，未知值使用降级文案。

 - [ ] **Step 2: 运行定向测试确认失败**
   Run `node --test desktop-ui/src/memory-mode.test.mjs`; expected module-not-found before implementation。

 - [ ] **Step 3: 实现模式映射并接入 SettingsView**
   使用 `postgres` 正常文案；保留旧 sqlite 兼容识别但不显示为当前正常存储。

 - [ ] **Step 4: 更新中英文文案**
   将正常状态改为 PostgreSQL 索引正常，将降级状态改为文件副本/索引不可用语义。

 - [ ] **Step 5: 运行测试、类型检查和构建**
   Run `node --test desktop-ui/src/memory-mode.test.mjs`, `pnpm exec vue-tsc --noEmit`, `pnpm exec vite build`。

 ---

 ### Task 3: 刷新验收与版本证据

 **Files:**
 - Modify: `TASK_STATE.md`
 - Modify: `docs/architecture/runtime-acceptance-matrix.md`
 - Modify: `docs/architecture/current-state.md`

 **Interfaces:**
 - 记录 Gateway `742/742)、Desktop/Electron `139/139)、内置资源 `64)、当前 1.6.1 构建产物。
 - 将 Host Smoke 从旧的 passed 改为本轮修复后的 fresh passed；保留签名排除说明和真实外部 blocker。

 - [ ] **Step 1: 用当前命令刷新所有门禁证据**
 - [ ] **Step 2: 删除或改写旧测试数量与过期 Smoke 结论**
 - [ ] **Step 3: 明确 1.6.1 本地打包已通过，但安装/升级和真实 Provider/IM 仍需环境验证**
 - [ ] **Step 4: 运行 `git diff --check` 和全量回归**

 ---

 ### Task 4: 最终质量门禁

 **Files:** 无新增源码文件。

 - [ ] **Step 1:** `node --test gateway`
 - [ ] **Step 2:** `node --test desktop-ui/src desktop-ui/electron`
 - [ ] **Step 3:** `node scripts/check-builtin-resources.mjs`
 - [ ] **Step 4:** Gateway 源码 `node --check`
 - [ ] **Step 5:** `pnpm exec vue-tsc --noEmit` 与 `pnpm exec vite build`
 - [ ] **Step 6:** `pnpm build` 生成 1.6.1 未签名本地安装包
 - [ ] **Step 7:** `git diff --check`、`git status --short`，确认无源码外泄改动
