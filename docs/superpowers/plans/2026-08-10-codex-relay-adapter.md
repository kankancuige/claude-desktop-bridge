# Codex Relay Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有 Claude Code SDK 通过本地 Anthropic 兼容代理使用 AICodeMirror 的 Codex Responses API，同时保持 Session、Agent、权限确认和微信/飞书/钉钉链路不变。

**Architecture:** Gateway 启动只监听 `127.0.0.1` 的 Codex Relay Proxy，Claude Code SDK 继续发送 Anthropic `/v1/messages`；代理将请求转换为 OpenAI Responses `/responses`，再把 JSON/SSE 响应转换回 Anthropic Message/SSE。供应商密钥只存在于 Gateway 内存和加密设置中，不写入日志。

**Tech Stack:** Node.js ESM、Claude Agent SDK、Node HTTP、Fetch、SSE、现有 Gateway Provider URL 安全模块。

## Global Constraints

- 不新增依赖，不改变微信、飞书、钉钉与 Session 的公开契约。
- 上游仅允许通过 `validateProviderUrl`/`resolveProviderUrl` 校验后的 HTTPS URL。
- 请求、响应、首字节和空闲阶段必须有 timeout/cancellation；限制请求和响应大小。
- 主模型与 Claude Code 内部 Opus/Sonnet/Haiku 别名必须统一映射到选定 Codex 模型。
- API Key、Authorization、Cookie 和响应中的敏感字段不得记录。

## Architecture Baseline

- 当前 `makeQueryOptions` 只向 Claude SDK 注入 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_AUTH_TOKEN`。
- `opencode-proxy.mjs` 能转换 Anthropic Messages 与 OpenAI Chat Completions，但 AICodeMirror Codex 使用 Responses wire API。
- AICodeMirror Codex Base URL 为 `https://api.claudecode.net.cn/api/codex/backend-api/codex`，Codex 客户端在其下请求 `/responses`。

## Target Design And Risks

- 新模块拥有协议转换、代理生命周期和上游请求；`index.mjs` 只负责选择并注入代理 URL。
- 数据所有权：Gateway 持有 Key；代理持有单请求 AbortController；Claude SDK 持有工具执行和权限状态。
- 主要风险：Responses 工具调用字段差异、SSE 事件顺序、重复工具回调、上游不支持模型、流中断。
- 失败恢复：代理启动或上游校验失败时拒绝创建 Query；请求中断时关闭上游读取；切换供应商时重建 Query。
- 回滚：删除 Codex Relay provider 分支即可回到现有 Anthropic/OpenCode 路径，不涉及持久化迁移。

---

### Task 1: Responses 协议转换核心

**Files:**
- Create: `gateway/codex-relay-protocol.mjs`
- Create: `gateway/codex-relay-protocol.test.mjs`

**Interfaces:**
- Produces: `toResponsesRequest(body, model)`、`fromResponsesJson(data, model)`、`createResponsesSseTranslator(model)`。

- [x] 写失败测试，覆盖 system/user、图片、tool_use/tool_result、工具定义、文本响应、function_call 与 SSE 完成事件。
- [x] 运行定向协议测试并确认实现覆盖边界。
- [x] 实现 Anthropic Messages 到 Responses `instructions/input/tools` 的转换，以及 Responses 到 Anthropic JSON/SSE 的转换。
- [x] 重跑定向测试，所有 assertion 通过且无 skipped test。

### Task 2: 安全本地代理与生命周期

**Files:**
- Create: `gateway/codex-relay-proxy.mjs`
- Create: `gateway/codex-relay-proxy.test.mjs`
- Modify: `gateway/provider-url-security.mjs`

**Interfaces:**
- Consumes: Task 1 的转换函数与 `resolveProviderUrl`。
- Produces: `startCodexRelayProxy(config)`、`getCodexRelayProxyUrl()`、`getCodexRelayProxyToken()`、`isCodexRelayProxyConfiguredFor(config)`、`stopCodexRelayProxy()`。

- [x] 写本地模拟上游测试，验证非流式/流式 `/v1/messages`、双本地认证头、模型覆盖和凭据不外泄；代理实现包含超时、过大 body 和目标切换边界。
- [x] 实现仅绑定 `127.0.0.1` 的代理、大小限制、AbortSignal、上游 URL 固定、随机本地令牌与脱敏日志。
- [x] 重跑代理测试并确认通过。

### Task 3: Gateway 供应商选择与模型映射

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/package.json`

**Interfaces:**
- Consumes: `startCodexRelayProxy` 与 `getCodexRelayProxyUrl`。
- Produces: `codex-relay` provider 预设和 Claude SDK runtime env。

- [x] 增加 Codex Relay URL 识别函数及预设。
- [x] 在 `makeQueryOptions` 中启动代理，并将 `ANTHROPIC_BASE_URL` 指向本地代理。
- [x] 将 `ANTHROPIC_DEFAULT_OPUS_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL` 与 `ANTHROPIC_SMALL_FAST_MODEL` 全部设置为选中的 Codex 模型。
- [x] 连接测试对 Codex Relay 请求 `/responses` 探测，不默认拼接 `/models`。

### Task 4: 桌面设置和验收

**Files:**
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `README.md`

**Interfaces:**
- Consumes: Gateway `codex-relay` provider 与现有 settings env。

- [x] 增加 AICodeMirror Codex Relay 供应商卡片和 Codex 模型输入，不在前端持久化明文日志。
- [x] 运行 Gateway 全量测试、Electron 测试、Vue 类型检查和 Windows NSIS `pnpm build`。
- [x] 运行 `git diff --check`。
- [ ] 使用真实 Key 做文本、工具调用、停止和 Session 完成通知验收；没有 Key 时明确标记为外部 blocker，不以 build 代替端到端证据。

## ADR

选择“本地 Anthropic-to-Responses 代理”而不是替换 Claude Agent SDK。理由是现有 Claude Code 工具执行、权限确认、Agent 生命周期和 IM 回传全部依赖 SDK 事件；在模型供应商边界转换协议能保持这些契约。代价是必须维护 Responses SSE 与工具调用映射；当 Claude SDK 或 Responses 协议事件发生 breaking change、或中转站提供官方 Anthropic 兼容端点时重新评估。
