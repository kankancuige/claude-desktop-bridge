# Claude Desktop Bridge Project Rules

## Architecture And Delivery

- `desktop-ui` 固定使用 Vue 3、TypeScript、Pinia、Vue Router、Vite 和 Electron；`gateway` 固定使用 Node.js ESM。未经授权不替换技术栈、升级 major version 或新增 UI framework。
- `gateway/index.mjs` 保持唯一启动入口，业务模块按 `agents/context/im/projects/providers/security/sessions/shared/tasks/tools/workflows` 职责归属，禁止重新堆回入口文件。
- 桌面端通过 Gateway HTTP/WebSocket 获取业务数据；Electron 特权能力只能通过白名单 IPC 暴露。
- Gateway 逻辑在 `gateway` 目录运行 `node --test`；桌面逻辑在 `desktop-ui` 目录运行 `node --test`、`npm.cmd exec vue-tsc -- --noEmit -p tsconfig.app.json` 和 `npm.cmd exec vite build`。
- 涉及真实微信、飞书、钉钉、Provider、系统通知或自动更新时，单元测试和 build 不能代替带真实配置的 runtime 或端到端验收。

## Low Coupling And Module Boundaries

- `gateway/gateway-runtime-impl.mjs` 和 `gateway/index.mjs` 是组合根与启动边界，只负责选择和接线具体实现，不承载 Memory、任务或 Provider 的业务策略。
- Gateway runtime/use-case 依赖 context、repository、provider 等稳定 port；不得直接 import PostgreSQL client、文件 API、HTTP server 或 Electron 实现来完成业务判断。
- PostgreSQL 是结构化 Memory 的唯一主存储入口：`gateway/storage` 及其 repository 拥有 SQL、schema、事务和连接生命周期；HTTP route、runtime、context 和 UI 不得自行拼接 SQL 或直接访问数据库。
- Memory context（提取、候选、分层和规模策略）保持纯规则或依赖注入的 repository port；不得在规则模块中读写文件、数据库、网络或进程全局。
- HTTP/WebSocket 层只负责协议解析、鉴权、DTO 映射和调用应用 port；Renderer 只调用 Gateway 契约，不能绕过 Gateway 访问 storage。Electron 特权能力继续收敛在 preload 白名单 IPC。
- 新增跨模块能力时先定义拥有者、输入输出、错误/取消边界和替换方式，再在组合根接线；禁止通过深层路径 import、共享可变 singleton 或跨层 event 偷渡依赖。
- 需要兼容旧 API 或旧数据时，将转换限制在独立 compatibility adapter，并覆盖新旧契约测试；不得把兼容判断复制到多个业务模块。
- 核心业务测试使用 fake port 或 contract test；真实 PostgreSQL、Provider、IM 和 Electron runtime 只在集成/端到端门禁中验证。

## Desktop UI

- Bridge 桌面端沿用现有 CSS semantic tokens、主题和组件模式，不擅自引入新的 UI framework。
- Renderer 不执行同步阻塞 IO；异步结果写回前验证当前标签页、Session 和请求身份，并在生命周期结束时释放 timer、listener、WebSocket 和 Monaco 资源。
- Electron 特权能力只通过 `preload.cjs` 白名单 IPC 暴露，保持 `contextIsolation: true` 和 `nodeIntegration: false`；新增 IPC 必须校验来源、参数和返回值。
- 任务 busy、完成、失败、停止、审查、Workflow、Session 身份和 IM 注入状态只以 Gateway 结构化事件或权威快照为准，不从展示文案、三个点动画或单个子流程状态推断。
- 迟到、重复和乱序事件不得覆盖当前权威状态；切换项目、标签页或路由不得清空活动会话、消息气泡、附件状态或 WebSocket 生命周期。
- `WorkspaceView` 的 keep-alive、持久化标签页和恢复流程属于公开交互契约，不能用重新创建组件或强制刷新掩盖状态所有权问题。
- 所有用户可见文案同时维护中英文 i18n；长路径、文件名、模型名和错误信息必须可截断、换行或展开，不能与控件重叠。
- 布局至少验证 Electron 最小窗口 `1200x700` 和默认窗口 `1800x960`，覆盖适用的 loading、empty、error、running、reviewing、completed、stopped 和 disconnected 状态。

## Task Continuity

- 保持会话、项目、IM 注入和完成通知的公开契约稳定；恢复和跨会话接力必须有明确来源，不把普通新问题自动注入旧任务。
