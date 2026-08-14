# ADR 0008：Gateway 模块目录与组合根边界

Checklist: 24/24 complete
Incomplete: None

**Status:** Accepted
**Date:** 2026-08-14
**Owner:** Claude Desktop Bridge maintainer

## Context

`gateway/` 根目录同时包含领域源码、平台适配器、Provider 代理、持久化模块和测试，源码文件超过一百个；`index.mjs` 同时承担启动、HTTP/WebSocket 路由、Session 协调、SDK stream 和项目接口接线。继续在根目录增加文件会降低职责可发现性，也使静态 wiring 测试和相对 import 更容易指向错误模块。

本项目是单用户桌面应用，Gateway 与 Electron 同机运行。当前没有独立扩缩容、独立部署或跨服务数据所有权需求，因此目录整理不能演变为微服务拆分。

## Drivers

- 从文件位置即可识别模块职责与主要所有者。
- 保持 `gateway/index.mjs`、HTTP/WebSocket API、配置和持久化契约兼容。
- 让 IM、Workflow、Agent、Session 和 Provider 通过明确边界协作，减少共享状态的隐式修改。
- 迁移必须分阶段可回滚，每阶段可用既有测试证明行为未变。
- Electron 打包继续递归包含 Gateway 子目录，测试文件继续与源码同目录维护。

## Decision

1. Gateway 保持单进程 modular monolith，不拆服务、不增加进程间通信或数据库。
2. `index.mjs` 暂时保留在根目录作为唯一组合根和兼容入口；根目录只保留入口、package/env 文件、运行资产和人工 smoke 脚本。
3. 领域文件归入 `shared`、`security`、`providers`、`sessions`、`projects`、`tasks`、`agents`、`workflows`、`im`、`context` 和 `tools`。测试与被测源码同目录。
4. 依赖从组合根指向领域，再指向 `shared/security`；`shared` 不得反向依赖领域。IM adapter 不直接拥有 Session 状态，Workflow 不解释外部协议。
5. 先做纯路径迁移并修复 import，再单独从 `index.mjs` 提取 coordinator。不得在同一个阶段同时移动全部文件并重写主流程。

## Alternatives

| 方案 | 结论 | 原因 |
|---|---|---|
| 继续平铺根目录 | 拒绝 | 文件发现和边界判断成本持续上升 |
| 只建立一个 `lib/` 或 `utils/` | 拒绝 | 只隐藏数量，不表达业务职责，仍会形成新的杂物目录 |
| 立即拆成多个服务 | 拒绝 | 单机单用户没有独立部署收益，会新增鉴权、通信和故障恢复成本 |
| 按领域目录组织的单进程模块化单体 | 采用 | 与现有部署一致，路径迁移可逆，并为后续瘦身组合根建立边界 |

## Failure And Recovery

- 相对 import 或静态 wiring 路径遗漏：对应阶段测试或 `node --check` 失败，停止进入下一阶段并修复路径。
- Electron 资源遗漏：生产构建检查 `extraResources` 仍使用 `**/*`，保持递归打包。
- 持久化路径意外变化：Session/journal/transcript 测试必须继续断言原数据目录，目录迁移不移动用户数据。
- 运行行为变化：将当前阶段目录移回根目录并恢复 import；不删除或改写 transcript、journal、配置和通知 outbox。

## Consequences

- 正面：根目录只展示组合入口和运行资产，模块职责更容易定位。
- 正面：测试与源码共置，后续提取 coordinator 时可以按领域分批实施。
- 正面：不改变进程、公开接口、配置和持久化格式。
- 负面：迁移期会产生大量纯路径 diff，历史文档中的旧路径仍然存在。
- 负面：`index.mjs` 在后续提取完成前仍是集中接线点，目录分类本身不会降低其行数。

## Validation

- 每个迁移阶段运行该目录定向测试和 Gateway 全量测试。
- 对所有 `gateway/**/*.mjs` 运行 `node --check`。
- 运行 desktop 全量测试、`vue-tsc --noEmit` 和 Vite production build。
- 运行 `git diff --check`，并检查 README、当前架构和有效 wiring 测试不再引用已移动的根路径。
- runtime smoke 继续从 `gateway/index.mjs` 启动，并确认微信、飞书、钉钉初始化及桌面 WebSocket 连接没有路径错误。

## Review Triggers

- Gateway 出现需要独立部署、独立扩缩容或不同故障域的真实需求。
- `index.mjs` 提取 coordinator 后，组合根仍持有多个领域的业务状态。
- 新增第二个 Agent Provider 或新的 IM 平台，现有依赖方向无法容纳。
