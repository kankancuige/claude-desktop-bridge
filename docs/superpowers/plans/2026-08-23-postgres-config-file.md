# PostgreSQL Configuration File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Bridge 的 PostgreSQL 结构化主库连接配置从必需环境变量迁移到 `BRIDGE_HOME/storage-config.json`，同时保留环境变量作为显式覆盖。

**Architecture:** `storage-config-file.mjs` 负责定位、读取和解析 Bridge 私有配置文件；`postgres-config.mjs` 继续负责 PostgreSQL URL、host、schema 和 timeout 的统一校验。Gateway 启动先准备 `BRIDGE_HOME`，再读取配置文件并传入现有 `StorageGateway`，不把密码写入仓库或日志。

**Tech Stack:** Node.js ESM、现有 `pg` StorageGateway、Node `fs/path`、`node:test`。

## Global Constraints

- 连接参数只能来自配置文件或环境变量，源码不得硬编码密码、token 或数据库地址。
- Bridge 正常运行必须使用 PostgreSQL；配置缺失、损坏或不合法时明确失败，不回退 SQLite。
- 环境变量仅作为显式覆盖，覆盖值仍必须经过同一套校验。
- 不修改或删除用户已有 dirty worktree 内容，不执行 commit/push。

### Task 1: 配置文件读取与校验

**Files:**
- Create: `gateway/storage/storage-config-file.mjs`
- Modify: `gateway/storage/postgres-config.mjs`
- Test: `gateway/storage/postgres-config.test.mjs`

**Interfaces:**
- `readStorageConfigFile({bridgeHome, env, required}) -> {config, path, source}`
- `readPostgresStorageConfig(env) -> normalized postgres config`

- [x] **Step 1:** 为文件读取、缺失、损坏和环境覆盖写测试。
- [x] **Step 2:** 实现 JSON 解析、结构校验和环境变量覆盖，并委托 `readPostgresStorageConfig` 做最终校验。
- [x] **Step 3:** 运行配置定向测试。

### Task 2: Gateway 接线与示例文档

**Files:**
- Modify: `gateway/index.mjs`
- Modify: `gateway/.env.example`
- Modify: `docs/architecture/migration-plan.md`
- Modify: `docs/architecture/decisions/0013-optional-postgres-pgvector-memory.md`

- [x] **Step 1:** 启动时从 `BRIDGE_HOME/storage-config.json` 读取配置，使用文件中的 Memory 维度。
- [x] **Step 2:** 更新示例与架构文档，明确私有路径、格式、覆盖顺序和安全边界。
- [x] **Step 3:** 创建本机私有配置文件并确认不被 Git 跟踪。

### Task 3: 全量验证

**Files:**
- No additional source files.

- [x] **Step 1:** 运行配置测试、Gateway 全量测试、语法检查和 `git diff --check`。
- [x] **Step 2:** 清除 PostgreSQL 相关环境变量后冷启动 Gateway，检查 `/api/health` 为 PostgreSQL 且未降级。
