# 会话恢复与异常提示迁移计划

Checklist: 30/30 complete
Incomplete: None

**Verdict:** READY

## 状态迁移

- 当前：workspace shell v1，只存 tab/session 描述；resume 缺失时可能静默新建；错误提示分散。
- 目标：保留 v1 读取兼容，新增独立 draft v1；resume 失败显式返回；共享传输错误事件和全局通知区域。
- source of truth 始终是 Claude SDK transcript，不迁移或重写现有 JSONL。
- 新增 fork 与按需接力均为 additive；现有 `resume` 请求和旧桌面端继续兼容。

## 阶段

| 阶段 | Entry gate | Change | Success evidence | Abort condition | Rollback/roll-forward |
|---|---|---|---|---|---|
| 1 兼容模块 | 现有测试通过 | 新增纯函数 draft/error/resume 模块 | 新失败用例先红后绿 | 旧 shell 无法解析 | 删除未接线模块即可回滚 |
| 2 Gateway 合约 | resume 决策测试通过 | 缺失 resume 返回 404；新增 stop API | 合约测试、Gateway tests | 现有历史恢复回归 | 保留旧 POST 形状；前端兼容无 `code` 错误 |
| 3 前端共性错误 | 全局事件无敏感内容 | fetch/WS/storage 产生限频 notice | 分类和去重测试、UI build | 后台请求刷屏 | feature-local listener 可移除，不影响 API |
| 4 草稿接线 | draft 存储边界通过 | 暂停/失败/关闭前保存，accepted 后清除 | 组件测试和 runtime smoke | 错误清除草稿或跨会话串台 | draft 为附加数据，停读即可回滚 |
| 5 稳定观察 | build/test 全绿 | 真实 Gateway/API 故障和重启 smoke | 日志+UI截图/步骤记录 | 会话重复、丢历史、密钥泄露 | 禁止清理旧 transcript；按阶段回滚代码 |
| 6 身份即时固化 | resume 缺失测试通过 | runtime 创建即绑定并持久化 SDK ID | 重启前后映射一致性测试 | 同一 SDK ID 产生两个 runtime | 停用即时写入，保留 `system/init` 校正路径 |
| 7 分支与按需接力 | SDK 支持 `forkSession`；上下文提取红测存在 | 新增 fork API/侧栏入口；引用短句按需读取最近 transcript | fork ID 不同且历史连续；普通首问零注入 | 源 transcript 被改写或错误会话被注入 | 移除新入口和接力调用；不删除已生成 fork transcript |

## 兼容、数据与删除

- 不修改现有 JSONL、session-map、snapshot、checkpoint 格式。
- 旧 workspace shell 继续解析；draft store 是 additive，损坏时隔离为空并提示。
- stop API 是新增端点；旧 WebSocket `stop_generation` 继续支持。
- 本次没有不可逆数据迁移。稳定期内不删除旧分支或兼容逻辑。
- 已存在的断裂 transcript 不自动合并或删除；后续只能显式归档，避免错误改写 SDK UUID 链。
- 只有确认所有用户操作调用方使用稳定错误码后，才考虑收敛散落字符串；该清理不属于本次必需步骤。
