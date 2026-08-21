# Bridge Context Rule Layering And Digital Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Bridge 的跨项目长期规则与仓库专属规则分层，并让数字孪生任务只在明确命中时加载 Bridge 自带的 `digital-twin-cad` Skill。

**Architecture:** `gateway/context/BRIDGE_RULES.md` 保留所有目标项目都适用的规则，新增 `BRIDGE_PROJECT_RULES.md` 保存仅用于开发 Bridge 的约束；`appendBridgeRules` 根据当前 `workDir` 与运行时仓库根目录的包含关系决定是否追加专属层。Skill Router 使用确定性双条件识别数字孪生集成任务，命中后由 Gateway 按需准备仓库内置 Skill，不读取 Codex 或 Claude 的外部全局规则。

**Tech Stack:** Node.js ESM、Claude Agent SDK、Node test runner、Markdown。

## Global Constraints

- 不新增依赖，不修改 SDK、HTTP/WebSocket、Session 持久化和 IM 契约。
- 不硬编码本机仓库绝对路径，运行时从模块位置解析 Bridge 仓库根目录。
- 不覆盖用户已有的同名 `BRIDGE_HOME/skills/digital-twin-cad/SKILL.md`；不会写入 Claude/Codex 外部 Skill 目录。
- 普通 CAD、普通前端和仅 Viewer 预览不得触发数字孪生 Skill。
- 注释和用户可见错误使用 UTF-8 简体中文。

---

### Task 1: 规则分层契约

**Files:**
- Create: `gateway/context/BRIDGE_PROJECT_RULES.md`
- Modify: `gateway/context/BRIDGE_RULES.md`
- Modify: `gateway/context/bridge-rules.mjs`
- Test: `gateway/context/bridge-rules.test.mjs`

**Interfaces:**
- Consumes: `appendBridgeRules(systemPrompt, {workDir})`
- Produces: `isBridgeRepositoryWorkDir(workDir)`、通用规则常驻注入、仓库专属规则条件注入。

- [ ] **Step 1: 写失败测试**

```js
assert.match(appendBridgeRules(undefined, {workDir: BRIDGE_REPOSITORY_ROOT}).systemPrompt.append, /Bridge 仓库专属规则/)
assert.doesNotMatch(appendBridgeRules(undefined, {workDir: sibling}).systemPrompt.append, /Bridge 仓库专属规则/)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test context/bridge-rules.test.mjs`
Expected: FAIL，当前函数没有条件规则层。

- [ ] **Step 3: 实现最小分层**

```js
export function appendBridgeRules(systemPrompt, {workDir = ''} = {}) {
  const prompt = appendRuleBlock(systemPrompt, 'Bridge 自有长期规则', BRIDGE_RULES)
  return isBridgeRepositoryWorkDir(workDir)
    ? appendRuleBlock(prompt, 'Bridge 仓库专属规则', BRIDGE_PROJECT_RULES)
    : prompt
}
```

- [ ] **Step 4: 运行定向测试**

Run: `node --test context/bridge-rules.test.mjs context/context-profile.test.mjs`
Expected: PASS。

### Task 2: 将工作目录传入规则选择

**Files:**
- Modify: `gateway/context/context-profile.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/context/context-profile.test.mjs`

**Interfaces:**
- Consumes: `applyContextProfile(options, profile, model, {workDir})`
- Produces: 完整上下文创建和重建时一致的规则选择结果。

- [ ] **Step 1: 写失败测试**

```js
const full = applyContextProfile({}, 'full', 'model', {workDir: BRIDGE_REPOSITORY_ROOT})
assert.match(full.systemPrompt.append, /Bridge 仓库专属规则/)
```

- [ ] **Step 2: 传递 `workDir`**

```js
opts = applyContextProfile(opts, contextProfile, resolvedModel, {workDir})
```

- [ ] **Step 3: 运行测试**

Run: `node --test context/context-profile.test.mjs`
Expected: PASS。

### Task 3: 数字孪生 Skill 路由与按需准备

**Files:**
- Create: `gateway/agents/builtin-skills/digital-twin-cad/SKILL.md`
- Create: `gateway/agents/builtin-skill-installer.mjs`
- Create: `gateway/agents/builtin-skill-installer.test.mjs`
- Modify: `gateway/agents/skill-router.mjs`
- Modify: `gateway/agents/skill-router.test.mjs`
- Modify: `gateway/index.mjs`

**Interfaces:**
- Consumes: `routeSkills({text, profile, targetFiles})`
- Produces: `ensureBuiltinSkillsAvailable(skillNames, {bridgeHome})`。

- [ ] **Step 1: 写路由正反例**

```js
assert.deepEqual(routeSkills({text: '把 GLB 节点绑定到设备遥测状态', profile: 'full'}), ['digital-twin-cad'])
assert.deepEqual(routeSkills({text: '做一个 GLB Viewer 预览页面', profile: 'full'}), ['vue-frontend'])
```

- [ ] **Step 2: 写安装失败测试**

```js
assert.equal(ensureBuiltinSkillsAvailable(['digital-twin-cad'], {bridgeHome: temp}).installed.length, 1)
assert.equal(ensureBuiltinSkillsAvailable(['digital-twin-cad'], {bridgeHome: temp}).installed.length, 0)
```

- [ ] **Step 3: 实现严格路由和不覆盖安装**

```js
if (skillNames.includes('digital-twin-cad') && !existsSync(target)) {
  mkdirSync(dirname(target), {recursive: true})
  writeFileSync(target, source, {encoding: 'utf8', flag: 'wx'})
}
```

- [ ] **Step 4: 接入 Query 创建**

```js
ensureBuiltinSkillsAvailable(skillRoute, {bridgeHome: BRIDGE_HOME})
```

- [ ] **Step 5: 运行 Agent 定向测试**

Run: `node --test agents/skill-router.test.mjs agents/builtin-skill-installer.test.mjs`
Expected: PASS。

### Task 4: 架构与交付验证

**Files:**
- Create: `docs/architecture/decisions/0009-context-rule-layering-and-builtin-skills.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 前三项实现证据。
- Produces: 可追踪的决策、兼容策略和验收记录。

- [ ] **Step 1: 记录 ADR**

记录规则数据所有权、路径识别、Skill 安装失败、用户同名 Skill 保留、回滚和重新评估条件。

- [ ] **Step 2: 更新 README**

说明 Bridge 的规则分层、外部规则隔离和按需内置 Skill 行为。

- [ ] **Step 3: 运行完整验证**

Run: `node --test`
Expected: Gateway 全部测试通过、无 skipped test。

Run: `node --check index.mjs`
Expected: PASS。

Run: `npm.cmd exec vue-tsc -- --noEmit -p tsconfig.app.json`
Expected: 无新增类型错误；若存在仓库既有错误，记录具体位置。

Run: `npm.cmd exec vite build`
Expected: PASS。

Run: `git diff --check`
Expected: PASS。
