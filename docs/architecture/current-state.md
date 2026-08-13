# 当前架构：会话持久化与错误传播

Checklist: 26/26 complete
Incomplete: None

**Verdict:** DOCUMENTED
**Snapshot:** `main` @ `7f568d4e93b839839acd1841c49e4657c07bf541`，dirty worktree，2026-08-12

## 组件与数据所有权

| 组件 | 当前职责 | 证据 |
|---|---|---|
| `WorkspaceView.vue` | 多 tab 运行态、历史加载、会话创建/恢复、WebSocket、局部 toast | `handleNewSession`、`connectWS`、`loadHistory` |
| `workspace-persistence.ts` | 将项目、tab、Gateway ID、SDK ID 写入 `localStorage` | `WorkspaceShell` v1 |
| `gateway/index.mjs` | 创建/恢复 SDK query，维护进程内 sessions，提供项目和 transcript API | `POST /api/sessions`、`startStreamPump` |
| Claude SDK | 将 conversation transcript 写入 `~/.claude/projects/.../*.jsonl` | `system/init.session_id`、项目扫描实现 |
| `bridge-session-map.json` | Gateway UUID 与 SDK conversation ID 双向映射 | `persistSdkSessionId` |

## 当前关键流程

1. 新建会话：前端 `POST /api/sessions`，Gateway 建立 `query()`；收到 SDK `system/init` 后落盘 ID 映射并通知前端保存 `historySessionId`。
2. 暂停：前端发送 `stop_generation` 后立即把 UI 标记为空闲；Gateway 异步关闭 query 并广播 `generation_stopped`。暂停是取消，不保存工具执行栈。
3. 应用重启：前端恢复 tab shell；Gateway 内存 sessions 已空时，使用 `historySessionId` 再次 `POST /api/sessions {resume}`；Gateway 将 SDK ID传给 `opts.resume`。
4. 关闭 tab：只关闭 WebSocket并移除 tab shell，不调用 DELETE，所以 transcript 仍在侧栏项目扫描中；当前确认文案声称会中断任务，但实现不会确定性停止后台 query。
5. 历史展示：`loadMessages`/`loadHistory`恢复用户和 assistant 文本；UI-only system 消息、实时工具进度、权限弹窗和宠物状态不是 transcript 正文。
6. 新建会话：当前只建立全新 SDK conversation；项目结构缓存仅在探索工具触发后注入，不包含上一会话任务状态。
7. 项目 Memory：设置页可以管理 `~/.claude/projects/<project>/memory/*.md`，但 Gateway 不会自动把上一会话整理为 Memory，也没有按引用性短句读取最近 transcript 的接力链路。

## 已观察到的失败行为

- 工作区 shell 不保存暂停后回填的 `inputText/lastUserMessage`，关闭应用或 tab 后草稿丢失。
- resume 映射和 transcript 都找不到时，Gateway 静默创建新会话，但响应仍可能标记 `resumed: true`。
- `loadHistory` 不检查非 2xx；部分加载/持久化异常只写 console。
- 设置页首次读取失败会装入默认值，后续不自动重新读取。
- 全局 fetch 负责 token 和 timeout，但没有统一的可见错误事件；约百个调用点各自处理，存在静默和提示不一致。
- WebSocket 会重连，但断开、退避和达到上限主要只写 console。
- 恢复 runtime 时 `resumeSid` 已传给 SDK，但 `sessions.set()` 未立即写入 `lastSessionId`；映射持久化依赖后续 `system/init`，空闲恢复窗口内身份不完整。
- 新会话无法区分“全新问题”和“继续上一任务”；像“加上”这样的短句进入新 transcript 后没有足够上下文。

## 运行与证据限制

- 本文依据本地源码、现有测试和 2026-08-11 Gateway 日志；未执行强制杀进程、真实 provider 故障或 IM 端到端恢复。
- 现有 dirty worktree 中包含用户和前序工作，本文不把未提交内容视为已发布版本。
