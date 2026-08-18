# Bridge Private Configuration Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Bridge 的 Rule、Skill、MCP、Agent、Hook、Workflow、IM、会话和 SDK transcript 迁入独立私有目录，不再读写 Claude/Codex 配置。

**Architecture:** 新增唯一的 Bridge Home 模块解析 `BRIDGE_HOME` 和默认 `~/.claude-desktop-bridge`，提供非破坏、幂等的一次性迁移。Gateway、Electron 和各子模块统一消费该路径；Claude Agent SDK 通过 Runtime wrapper 和 Query env 使用同一 `CLAUDE_CONFIG_DIR`。

**Tech Stack:** Node.js 20 ESM/CJS、Electron、Vue 3、Claude Agent SDK、Markdown/JSON/JSONL 文件存储。

## Global Constraints

- 不新增依赖或 SQLite，不删除、移动或覆盖 `~/.claude`、`~/.codex` 中的用户数据。
- `BRIDGE_HOME` 必须是绝对路径；默认值为 `~/.claude-desktop-bridge`。
- 供应商密钥不得从 Claude `settings.json` 回迁；继续由 `bridge-provider.json` 管理。
- 完整上下文只消费 Bridge 私有 user settings；focused/light 不加载 MCP、Agent、Hook 或外部规则。
- 未经用户明确授权不执行 commit、push、服务重启或旧目录清理。

---

### Task 1: Bridge Home 与幂等迁移

**Files:**
- Create: `gateway/config/bridge-home.mjs`
- Test: `gateway/config/bridge-home.test.mjs`

**Interfaces:**
- Produces: `BRIDGE_HOME`、`resolveBridgeHome()`、`prepareBridgeHome()`、`bridgePath()`。

- [ ] 写失败测试：默认路径、绝对覆盖、相对路径拒绝、目标不覆盖、重复迁移和失败项重试。
- [ ] 实现允许清单迁移和原子 `.bridge-migration-v1.json` 清单。
- [ ] 运行 `node --test config/bridge-home.test.mjs`。

### Task 2: SDK Runtime 隔离

**Files:**
- Create: `gateway/providers/claude-agent-sdk-runtime.mjs`
- Modify: `gateway/index.mjs`
- Modify: `gateway/context/context-profile.mjs`
- Test: `gateway/context/context-profile.test.mjs`

**Interfaces:**
- Consumes: `BRIDGE_HOME`。
- Produces: `query`、`deleteSession`、`forkSession` wrapper；Query `env.CLAUDE_CONFIG_DIR`。

- [ ] 用动态 import 保证 SDK 首次求值前设置 `process.env.CLAUDE_CONFIG_DIR`。
- [ ] 完整上下文设置 `settingSources: ['user']`，focused/light 保持空数组。
- [ ] 测试 Query 配置不会回退 Claude/Codex 路径。

### Task 3: Gateway、Workflow、Project 与 IM 路径迁移

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/workflows/workflow-runner.mjs`
- Modify: `gateway/projects/project-cache.mjs`
- Modify: `gateway/im/wechat.mjs`
- Modify: `gateway/im/feishu.mjs`
- Modify: `gateway/im/dingtalk.mjs`
- Modify: `gateway/context/user-preferences.mjs`
- Modify: `gateway/agents/builtin-skill-installer.mjs`

**Interfaces:**
- Consumes: `BRIDGE_HOME` 或显式 `bridgeHome` 参数。
- Produces: 所有持久化和扫描只位于 Bridge 私有目录。

- [ ] 将每个模块的本地根目录替换为统一 import，保留参数化测试能力。
- [ ] 更新变量名、错误信息和注释，禁止残留误导性的 `CLAUDE_HOME`。
- [ ] 运行模块定向测试。

### Task 4: Electron 与设置页路径契约

**Files:**
- Modify: `desktop-ui/electron/main.cjs`
- Modify: `desktop-ui/src/i18n.ts`
- Modify: `desktop-ui/src/views/SettingsView.vue`
- Modify: `README.md`

**Interfaces:**
- Consumes: `BRIDGE_HOME` 环境变量或相同默认路径算法。
- Produces: token、安全密钥和用户可见路径全部指向 Bridge 私有目录。

- [ ] Electron 主进程集中解析 Bridge Home，读取新 token/密钥且不回退旧目录。
- [ ] 更新中英文设置文案和 README 数据目录说明。
- [ ] 运行桌面端单元测试和构建。

### Task 5: Rules/Hooks 闭环与发布门禁

**Files:**
- Modify: `gateway/context/context-profile.mjs`
- Modify: `gateway/index.mjs`
- Test: `gateway/context/context-profile.test.mjs`
- Test: `gateway/config/bridge-home.test.mjs`

**Interfaces:**
- Consumes: Bridge 私有 `settings.json`、`rules/`、`hooks/`。
- Produces: 完整 Query 的 SDK user setting source。

- [ ] 验证 full/focused/light 三种 profile 的 setting source、MCP、Agent 和 Skill 边界。
- [ ] 静态扫描产品代码，确认不存在旧 Claude/Codex 配置路径读取。
- [ ] 运行 Gateway 全量测试、桌面测试、所有 MJS 语法检查、Vue 类型检查、Vite build 和 `git diff --check`。
