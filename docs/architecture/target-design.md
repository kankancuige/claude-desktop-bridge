# 目标设计：可恢复会话与统一异常提示

Checklist: 30/30 complete
Incomplete: None

**Verdict:** READY

## 目标边界

- 保持 Electron + Vue + 单 Gateway 的 modular monolith，不引入数据库或新服务。
- transcript 继续由 Claude SDK 持有；桌面端只新增有界的 session draft store。
- API 层统一产生脱敏错误事件，页面继续负责业务语义和可执行重试。
- 会话入口明确区分恢复、分支和空白新建；按需接力只读取 transcript，不新增任务正文数据库。

## 契约

### 会话恢复

- `POST /api/sessions` 未传 `resume`：创建新会话。
- 传 `resume` 且 transcript/映射存在：返回 `resumed: true` 和稳定的 Gateway/SDK ID。
- 传 `resume` 但不存在：返回 `404`、`code: SESSION_RESUME_NOT_FOUND`；禁止静默创建新会话。
- `POST /api/sessions/:id/stop`：幂等停止当前生成，返回 `stopped`、`resumable`、`historySessionId`；不删除 transcript。
- `POST /api/sessions {forkFrom}`：校验源 transcript 后调用 SDK `forkSession`，返回新的 SDK conversation ID；源会话保持不变，fork 不复制 undo/file-history。
- 恢复或 fork 生成的 SDK ID 在 runtime 创建时立即写入 `lastSessionId` 并尝试持久化双向映射；重复 `system/init` 只校正同一身份。

### 跨会话接力

- 空白新会话的普通首问不加载旧会话。
- 空白新会话首条消息为“继续、加上、接着做”等有明确省略关系的短句时，Gateway 从同项目最近的有效主 transcript 派生接力上下文。
- 接力来源排除当前会话、agent/workflow transcript、只有单条引用性短句且无实质结果的断裂会话。
- 注入只保留最近两条实质用户请求和两条 assistant 结果，总长度不超过 6 KB；使用内部边界标记，历史 UI 只显示当前用户原文。
- 找不到可靠来源时不猜测、不注入，由模型正常要求用户补充。

### 草稿

- key 优先使用 SDK conversation ID，尚未获得时使用项目路径和 Gateway ID组成的临时 key。
- value 只含文本、更新时间和 interrupted 标记；文本限制 900 KB，最多 100 项，默认保留 30 天。
- 发送被 Gateway 接受后清除对应草稿；暂停、发送失败、断线或关闭 tab 前立即保存。

### 错误事件

```ts
interface BridgeNotice {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  source: 'http' | 'websocket' | 'storage' | 'session'
  status?: number
  path?: string
  retryable: boolean
  dedupeKey: string
}
```

- 网络不可达、timeout、最终认证失败、429、5xx 由共享 API 层产生全局事件。
- 400/404/409 等业务错误由用户操作调用方解析稳定 `code` 后提示。
- 后台错误按 `dedupeKey` 限频；连接恢复产生一次 recovery 事件并清除持久 banner。
- App 持有跨路由通知区域，Workspace/Settings 可继续显示局部错误和 retry。

## 失败与恢复

| 失败 | 行为 | 用户可见结果 |
|---|---|---|
| Gateway 未启动/重启中 | 请求失败、WS退避；不套用伪默认数据 | 持久连接提示，恢复后自动消失 |
| token 轮换 | 刷新一次 token 后重试 | 重试失败才提示认证异常 |
| resume 目标丢失 | 不创建替代会话 | 提示历史会话不存在，保留项目与草稿 |
| fork 目标丢失/复制失败 | 不创建空白替代会话 | 提示无法从源会话分支，源会话不变 |
| 接力来源不存在或损坏 | 跳过接力，继续发送原消息 | 不阻塞新会话，不伪造历史 |
| transcript 读取失败 | 不显示“空白即成功” | 历史加载失败并提供重试 |
| localStorage 不可写 | 维持内存状态 | 明确提示草稿/工作区不会在重启后恢复 |
| provider/API 失败 | 保留表单和会话 | 显示状态、脱敏错误和可重试说明 |

## 方案比较

| 方案 | 结论 | 原因 |
|---|---|---|
| 保存完整 Vue 消息树 | 不采用 | 重复 transcript、结构易漂移、可能保存敏感运行态 |
| 新增 SQLite 会话库 | 不采用 | 单机规模没有证据支付迁移和双写成本 |
| JSONL 为正文事实源 + 本地有界草稿 | 采用 | 与 Claude SDK 一致、改动可逆、能覆盖中断原文恢复 |
| 每个 fetch 手写 toast | 不采用 | 109 个调用点易漏且提示不一致 |
| 共享传输错误事件 + 业务调用方补充 | 采用 | 可覆盖网络共性，同时避免后台轮询刷屏 |
| 所有新会话默认注入最近 transcript | 不采用 | 容易污染简单问题并增加 token 成本 |
| 显式 fork + 引用短句按需接力 | 采用 | 完整继承和轻量接力边界清楚，且不新增正文事实源 |

## 验收

- 单元测试：workspace shell/draft 兼容、错误分类/脱敏/去重、resume 缺失决策、stop 幂等结果。
- 构建：Gateway tests、`vue-tsc --noEmit`、Vite build、`git diff --check`。
- runtime：新建回合 -> 暂停 -> 退出 -> 重启 -> 历史正文和草稿恢复 -> 继续发送；断开 Gateway 时出现提示，恢复后消失。
- runtime：源会话 -> 显式分支 -> 新 SDK ID 保留源历史；空白新会话发送“加上”时命中最近有效会话，普通独立问题不注入。
