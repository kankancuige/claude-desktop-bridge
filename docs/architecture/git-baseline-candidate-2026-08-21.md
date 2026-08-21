# 2026-08-21 Git 基线候选清单

## 目的与边界

本清单为通用 AI 编程工作台架构改造建立可审查、可回滚的本地 Git 基线。用户已于 2026-08-21 明确授权创建本地提交；该授权不包含推送、删除或覆盖范围外内容。

本次基线的父提交为 `d08792f feat(workbench): establish durable agent workspace architecture`。创建本次提交前，本地 `main` 相对 `origin/main` 已领先两个历史提交；既有提交不在本次范围内重写或修改。

## 只读采集结果

| 项目 | 结果 |
|---|---|
| 候选文件 | 45 |
| Gateway | 24 |
| Desktop | 17 |
| 架构文档 | 4 |
| 生成物或二进制候选 | 0 |
| `git diff --check` | 通过 |
| 行尾提示 | Git 提示现有 LF 文件下次写入时可能变为 CRLF；不是空白错误 |

## 候选范围

| 分类 | 路径范围 | 归属与理由 | 基线处理 |
|---|---|---|---|
| Gateway 核心 | `gateway/tasks/`、`gateway/sessions/`、`gateway/context/`、`gateway/projects/`、`gateway/storage/`、`gateway/index.mjs` | Task Coordinator、输入队列、Stream Adapter、会话协调、上下文策略、usage ledger、持久化和生命周期兼容 | 候选纳入；须通过 Gateway 全量测试 |
| Agent 与 IM | `gateway/agents/`、`gateway/im/`、`gateway/workflows/`、`gateway/validation/` | Agent 分派、资源路由、进度投递、Workflow 和验证契约 | 候选纳入；须通过对应单元测试与资源检查 |
| 内置资源 | `gateway/builtin-resources/`、`gateway/config/builtin-resources.*`、`scripts/check-builtin-resources.mjs` | 内置 Skill、Workflow 和资源打包校验 | 候选纳入，但先执行资源完整性检查 |
| Desktop | `desktop-ui/src/`、`desktop-ui/scripts/prebuild.cjs` | 项目/会话侧边栏、任务气泡、最终总结、模型切换和资源加载重试 | 候选纳入；须通过类型检查和生产构建 |
| 交付链路 | `.github/workflows/build.yml` | 将 Gateway、资源、Desktop 与审计门禁纳入 CI | 候选纳入；须审阅 job 依赖与脚本一致性 |
| 架构文档 | `docs/architecture/`、`docs/superpowers/plans/`、`README.md` | 当前架构、目标设计、ADR、迁移、验收矩阵和实施计划 | 候选纳入；须与实现及测试证据一致 |

## 专项判定

### `gateway/builtin-resources/skills/cad-viewer/scripts/viewer/dist`

该目录已属于父提交，不在本次 45 个候选文件中。本轮不删除、不重建也不重复暂存；`node scripts/check-builtin-resources.mjs` 已确认当前内置资源清单完整。

### 未发现的排除项

本轮按路径和 Git 未跟踪清单未发现 `.env`、凭据、根目录 `node_modules`、桌面端 `dist`、安装包或发布目录条目。此结论只覆盖当前 Git 可见工作区；基线提交前仍必须对候选暂存区执行一次凭据与生成物复查。

## 基线门禁

在请求创建本地基线提交前，必须按当前工作区重新执行并记录结果：

```powershell
node --test <全部 Gateway 非 node_modules 的 *.test.mjs>
node scripts/check-builtin-resources.mjs
Set-Location desktop-ui
pnpm exec vue-tsc --noEmit
pnpm exec vite build
Set-Location ..
git diff --check
```

Workflow DSL 由 `gateway/workflows/workflow-script.test.mjs` 的包装编译路径验证，不能对 `gateway/builtin-resources/workflows` 直接使用 `node --check`。

## 授权与回滚

创建基线前需要用户明确授权“创建仅包含上述候选范围的本地 Git 提交”。授权后仍须先展示拟暂存路径，提交后记录 SHA、工作树剩余条目和回滚命令。回滚仅限代码与资源版本；SQLite、transcript、用户配置和真实 Provider/IM 外部副作用不因 Git revert 自动恢复。

## 当前状态

- P0.1 Step 1 已完成：候选范围和资源例外已记录。
- P0.1 Step 2 已完成（2026-08-21 fresh）：发现 120 个 Gateway 测试文件并通过 489/489 项测试；内置资源检查通过 61 项；Desktop 类型检查与 Vite 生产构建通过；`git diff --check` 通过。
- P0.1 Step 3 已获用户授权：本提交仅包含清单中的 45 个候选文件，不推送；提交 SHA 和提交后工作树状态由 Git 记录及交接结果提供。
- 候选路径与内容已复查：没有生成物、二进制、凭据、私钥或真实用户绝对路径；扫描命中仅为 `task-*` CSS 类名和路径解码示例注释。
- P0.3 的后续本地改动已复验：会话生命周期定向回归 49 项、Electron 边界测试 11 项、Gateway/Electron 语法检查和 Desktop 类型检查均通过；真实桌面补充、停止、重连和崩溃恢复 L3 已通过。

### 非阻塞观察项

Desktop 生产构建报告 `PhaserPet`、`editor.api2` 等 chunk 超过 500 kB，且 `pet-scanner` 占用约半数插件构建时间。这不是本次 P0 基线门禁失败，但应在 P3 的交付链路强化中评估拆包和构建时间预算，不能把告警误写为已优化。
