# 2026-08-21 Git 基线候选清单

## 目的与边界

本清单为通用 AI 编程工作台架构改造建立可审查的本地 Git 基线候选。它不是提交记录，也不授权暂存、提交、推送、删除或覆盖任何现有工作区内容。

审查基准为 `main` 的 `4441ab5 feat(core): release 1.5.0 with durable session recovery`。当前本地分支相对 `origin/main` 已领先一个历史提交；该历史提交不在本次候选范围内重写或修改。

## 只读采集结果

| 项目 | 结果 |
|---|---|
| 工作区条目 | 118 |
| Gateway | 89 |
| Desktop | 16 |
| 架构文档 | 10 |
| 交付工具 | 2 |
| README | 1 |
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

该目录中有未跟踪的浏览器构建产物。它位于内置资源发布包中，而非普通 `node_modules` 或仓库外的临时输出；因此当前结论是“保留并等待 `node scripts/check-builtin-resources.mjs` 确认”，不是“自动删除”或“自动提交”。若资源检查不把该产物视为发布内容，必须先由用户确认处理方式。

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
- P0.1 Step 2 已完成（2026-08-21）：`node --test` 发现并通过 476 项 Gateway 测试；`node scripts/check-builtin-resources.mjs` 通过 61 项；`pnpm exec vue-tsc --noEmit` 与 `pnpm exec vite build` 通过；`git diff --check` 通过。
- P0.1 Step 3 未开始：没有创建本地 Git 提交的用户授权。
- P0.3 的后续本地改动已复验：会话生命周期定向回归 49 项、Electron 边界测试 11 项、Gateway/Electron 语法检查和 Desktop 类型检查均通过；基线提交前仍需重新执行完整 P0.1 门禁。

### 非阻塞观察项

Desktop 生产构建报告 `PhaserPet`、`editor.api2` 等 chunk 超过 500 kB，且 `pet-scanner` 占用约半数插件构建时间。这不是本次 P0 基线门禁失败，但应在 P3 的交付链路强化中评估拆包和构建时间预算，不能把告警误写为已优化。
