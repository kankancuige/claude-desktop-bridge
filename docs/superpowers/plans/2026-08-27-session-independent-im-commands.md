# Session-independent IM Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已配对 IM 用户在没有活跃桌面 Session 时仍可执行项目查询、会话目录查询、桌面状态和桌面导航命令，同时保留当前 Session 操作的所有权门禁。

**Architecture:** 将“已配对 IM 身份”和“当前 Session 绑定”拆成两个条件。IM adapter 继续在命令识别前完成配对鉴权；Gateway 允许该受信 adapter 身份访问只读目录和桌面控制通道，只有停止、镜像等作用于当前 Session 的命令才解析并校验 Session 绑定。

**Tech Stack:** Node.js ESM、内置 `node:test`、Gateway HTTP routes、微信/飞书/钉钉共用 IM command engine。

## Global Constraints

- 不新增依赖，不改变普通 IM 对话必须解析当前 Session 的行为。
- 保留当前 dirty worktree，修改现有脏文件时只追加本任务所需的窄范围差异。
- 已配对检查仍由微信、飞书和钉钉 adapter 在 `executeCommand` 之前完成。
- `/stop` 和 `/m` 继续要求当前 Session；`/p`、`/ss`、`/i`、`/h`、`/sw`、`/sws`、`/ns` 不以当前 Session 作为前置条件。
- 项目与会话目录只返回既有命令已经展示的摘要，不开放消息正文、文件或任意新路由。

---

### Task 1: 固化命令分类失败用例

**Files:**
- Modify: `gateway/im/im-commands.test.mjs`

**Interfaces:**
- Consumes: `detectCommand(text)`、`executeCommand(cmd, token, identity)`。
- Produces: 无 Session 时 `/p` 和 `/ns` 继续访问目标接口，`/stop` 仍停止于 Session 门禁的回归契约。

- [ ] **Step 1: 写入失败测试**

```js
test('项目查询不依赖活跃 Session', async () => {
    // /api/sessions/resolve 返回 409 时仍应请求 /api/projects 并显示项目。
})

test('新建会话命令不依赖既有 Session', async () => {
    // 无需 resolve，直接向 desktop control channel 发送 new_session nudge。
})

test('停止命令仍要求活跃 Session', async () => {
    // resolve 返回 409 后不得发送 stop nudge。
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test gateway/im/im-commands.test.mjs`

Expected: `/p` 或 `/ns` 因现有统一 `ensureAdapterBinding` 门禁失败；`/stop` 保护测试保持通过。

- [ ] **Step 3: 不修改实现，记录失败输出中的 assertion 和请求序列**

Expected: 失败路径明确为 `executeCommand -> ensureAdapterBinding -> 409`，目标 handler 未执行。

### Task 2: 实现命令级 Session 门禁

**Files:**
- Modify: `gateway/im/im-commands.mjs`
- Modify: `gateway/im/im-commands.test.mjs`

**Interfaces:**
- Consumes: `cmd.key`。
- Produces: `SESSION_REQUIRED_COMMANDS`，仅包含 `stop`、`mirror`。

- [ ] **Step 1: 将统一门禁改为显式命令集合**

```js
const SESSION_REQUIRED_COMMANDS = new Set(['stop', 'mirror'])

if (SESSION_REQUIRED_COMMANDS.has(key)) {
    const binding = await ensureAdapterBinding(token, identity)
    if (!binding.ok) return {replyText: binding.replyText}
}
```

- [ ] **Step 2: 运行 IM command 单元测试**

Run: `node --test gateway/im/im-commands.test.mjs`

Expected: 命令分类测试通过；无未知命令异常；`/h` 保持零 Gateway 请求。

### Task 3: 放开配对用户的目录查询与桌面导航边界

**Files:**
- Modify: `gateway/http/memory-routes.mjs`
- Modify: `gateway/http/adapter-config-routes.mjs`
- Modify: `gateway/http/session-mutation-routes.mjs`
- Test: `gateway/http/memory-routes.test.mjs`
- Create: `gateway/http/im-command-routes.test.mjs`

**Interfaces:**
- Consumes: 已由 `createHttpRequestHandler` 验证的平台 adapter token 与 `x-bridge-source`/`x-bridge-user-id`。
- Produces: `/api/projects` 返回项目摘要；`/api/sessions-by-label` 返回匹配项目的 Session 摘要；非 `stop` 的 `/api/desktop/nudge` 可在无 Session 时投递 control client。

- [ ] **Step 1: 写入 Gateway route 失败测试**

```js
test('配对 adapter 无 Session 时可列出项目和项目会话摘要', async () => {
    // 断言 200，并且不要求 adapter-sessions binding。
})

test('无 Session 时 new_session nudge 可投递但 stop 不可越权', async () => {
    // 断言 new_session delivered=true；stop 返回 403 或未停止。
})
```

- [ ] **Step 2: 运行定向 route 测试确认失败**

Run: `node --test gateway/http/memory-routes.test.mjs gateway/http/im-command-routes.test.mjs`

Expected: 现有 binding/ownership 检查返回 403。

- [ ] **Step 3: 最小调整现有 route 授权条件**

```js
// 项目和 Session 目录依赖已认证 adapter 身份，不依赖当前 Session ownership。
// stop 仍调用 adapterOwnsFocusedSession；导航类 nudge 只要求有效 adapter identity。
```

- [ ] **Step 4: 运行定向 route 测试确认通过**

Run: `node --test gateway/http/memory-routes.test.mjs gateway/http/im-command-routes.test.mjs`

Expected: 目录/导航测试通过，stop 越权测试通过。

### Task 4: 记录契约并执行回归验证

**Files:**
- Modify: `docs/architecture/system-design-baseline.md`
- Modify: `docs/architecture/current-state.md`
- Modify: `docs/architecture/target-design.md`
- Create: `docs/architecture/decisions/0016-session-independent-im-command-routing.md`

**Interfaces:**
- Consumes: Tasks 1-3 的命令分类和授权结果。
- Produces: 当前问题、目标边界、风险、失败恢复和重新评估条件的可追踪说明。

- [ ] **Step 1: 更新架构基线、当前态、目标态和 ADR**

```text
配对身份负责进入命令通道；Session binding 只负责当前会话数据和副作用的归属。
```

- [ ] **Step 2: 运行 IM 与 HTTP 定向回归**

Run: `node --test gateway/im/im-commands.test.mjs gateway/http/memory-routes.test.mjs gateway/http/im-command-routes.test.mjs gateway/http/request-handler.test.mjs gateway/runtime/adapter-config-runtime.test.mjs`

Expected: 全部通过，无 skipped test。

- [ ] **Step 3: 运行 Gateway 最小充分测试与静态检查**

Run: `npm test --prefix gateway`

Expected: exit code 0；若环境门禁阻断，记录具体 blocker，不能以定向测试替代全量状态。

- [ ] **Step 4: 检查工作区差异**

Run: `git diff --check`

Expected: 无空白错误；本任务没有覆盖或回滚已有 dirty worktree 内容。

- [ ] **Step 5: 记录运行时边界**

```text
自动测试证明请求路由与权限条件；真实微信投递、桌面 control client 在线状态和重启后行为仍需运行中的 Gateway/微信验收。
```

### Task 5: 恢复唯一配对用户的主动通知并修正状态语义

**Files:**
- Modify: `gateway/im/adapter-bindings.mjs`
- Modify: `gateway/im/adapter-bindings.test.mjs`
- Modify: `gateway/im/wechat.mjs`
- Modify: `gateway/im/feishu.mjs`
- Modify: `gateway/im/dingtalk.mjs`
- Modify: `gateway/http/adapter-config-routes.mjs`
- Modify: `desktop-ui/src/views/SettingsView.vue`

**Interfaces:**
- Consumes: 精确 Session binding、各平台 `pairedUsers` Set。
- Produces: 精确 binding 优先；仅有一个已配对用户时作为安全 fallback；多用户时返回 null。

- [ ] **Step 1: 写入唯一用户 fallback 与多用户拒绝测试**

```js
assert.equal(findLatestAdapterUserForSession({}, 'wechat', 'new-session', ['only-user']), 'only-user')
assert.equal(findLatestAdapterUserForSession({}, 'wechat', 'new-session', ['u1', 'u2']), null)
```

- [ ] **Step 2: 运行测试确认现有实现失败**

Run: `node --test gateway/im/adapter-bindings.test.mjs`

Expected: 唯一用户 fallback 返回 null。

- [ ] **Step 3: 实现精确优先、唯一配对 fallback**

```js
const exact = findExactBinding(...)
if (exact) return exact.userId
return uniquePairedUsers.length === 1 ? uniquePairedUsers[0] : null
```

- [ ] **Step 4: 设置页拆分配对状态与 Session 路由状态**

```text
已配对用户显示平台白名单数量；Session binding 只显示当前/历史路由，不再将历史路由表述为 IM 配对失效。
```

- [ ] **Step 5: 重新运行 Gateway 全量测试和 Desktop 类型/构建门禁**

Run: `node --test gateway`

Run: `npm run typecheck --prefix desktop-ui`

Run: `npm run build --prefix desktop-ui`

Expected: 全部退出码 0；真实微信投递仍需重启当前 Gateway 后由用户执行端到端验收。
