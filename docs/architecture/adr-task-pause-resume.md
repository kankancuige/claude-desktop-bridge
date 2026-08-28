# ADR：桌面任务暂停、继续与新任务替换

**Status:** Accepted
**Date:** 2026-08-28
**Owner:** Claude Desktop Bridge maintainer

## Context

Gateway 已将 `stop_generation` 收口为 `stopped + resumable`，并在异常退出恢复时将未结束运行投影为 `interrupted + resumable`。桌面端此前却把停止显示为“任务已停止/取消”，并把原任务文本自动回填输入框；继续操作附着在历史消息卡片上，无法形成类似 Codex 桌面端的暂停按钮状态。

## Decision

1. 暂停仍通过既有 `stop_generation` 取消当前 Query、Workflow、挂起确认和已接受的待处理输入；不新增冻结进程或恢复未完成工具调用的承诺。
2. 原任务文本继续以 Session-scoped interrupted draft 保存，作为续跑提示的恢复依据，但不自动显示为待发送输入。
3. 输入框主按钮使用四态纯状态机：运行且空输入为 `pause`；可恢复终态且空输入为 `continue`；存在文字或附件为 `send`；其余为 `disabled`。
4. 点击 `continue` 时复用同一 SDK transcript，并发送受控续跑提示，要求先核对已有修改和副作用再完成剩余工作。
5. 暂停后直接输入新内容时，输入优先级高于 `continue`。Gateway 按既有终态后新输入路径生成新的 `task/created`，不恢复旧 Coordinator；旧 transcript 和已经发生的外部副作用不会被删除或回滚。
6. 正常退出由 Gateway shutdown 收口为 stopped；强制终止无法执行关闭逻辑时，重启恢复层投影为 interrupted。两者在桌面端均使用同一继续入口。
7. 任何已接收但未成功完成的任务终态（`failed`、`incomplete`、`stopped`、`interrupted`、`review_paused`）都必须持久化已有任务投影并保留 `resumable=true`；该契约不依赖 SDK history ID，SDK 尚未初始化时也必须显示继续入口。
8. Provider 返回 `max_turns` 时不再由 Gateway 自动重建 Query；保留运行预算与累计轮数，将任务投影为 `incomplete + max_turns + resumable`，并统一等待用户点击输入框播放图标。
9. Session WebSocket 的 `error` 与 `close` 必须走同一中断投影；未确认输入只保存为中断草稿并从重发集合移除，连接恢复只能恢复传输通道，不能自动重发或启动任务。
10. 暂停后输入框文字、附件和旧任务队列均清空，确保主按钮稳定显示播放图标；恢复依据来自 Session transcript、持久化任务状态和中断草稿，不把旧输入伪装成待发送内容。
11. 方案确认的 `confirmation_response=confirmed` 只表示 Gateway 已结算 `canUseTool` 请求并释放确认 Promise，不表示 Provider 已经产生后续事件。桌面端在观察到新的 SDK/Provider 事件前显示“确认已提交，等待 AI 返回进度”。
12. 默认执行路径显式使用当前 Agent SDK 包内同版本的 native Claude Code binary；只有 `CLAUDE_EXE`、系统设置或请求体显式指定时才允许覆盖，避免扫描到用户目录中的旧版 CLI。
13. Stream watchdog 分开计算确认等待、工具无进度、Provider 无事件和任务绝对时限；确认结算会收口 `AskUserQuestion` 的活动工具记录，工具活动不会仅因仍存在于 Map 中而无限续期。

## Alternatives

- 冻结并恢复 SDK 进程栈：第三方 Query、工具调用和外部副作用没有可验证的可序列化恢复契约，不采用。
- 暂停后自动发送“继续执行”：用户无法决定改做新任务，也可能重复未确认的副作用，不采用。
- 达到 `max_turns` 后自动续跑：本质上同样绕过用户的继续/新任务选择，且会在旧 pump 收尾时隐式创建新 Query，不采用。
- 保持原文自动回填：输入框看起来像未发送草稿，无法区分继续旧任务和提交新任务，不采用。
- 新增 Gateway `resume_task` 命令：当前 transcript resume 和终态后新 task 已满足语义，新增公开协议只会扩大兼容面，不采用。

## Consequences

- 正面：暂停、继续和发送新任务的操作位置统一；强退后不再自动把旧任务塞进输入框；新任务优先级明确。
- 负面：继续是基于 transcript 和工作区状态重新发起执行，不能恢复暂停瞬间的调用栈；已发生的外部副作用需要模型在续跑前核对。
- 边界：方案确认后若 Provider 没有继续输出，界面会保持等待提示，直到 Provider 事件、确认自身超时或 watchdog 明确进入失败/可继续状态；确认回执本身不作为执行成功证据。
- 兼容：WebSocket 消息格式、Task State 持久化格式、SDK conversation ID 和旧历史会话保持不变。

## Validation And Review Triggers

- 单元测试覆盖按钮状态优先级、中断草稿展示边界、用户暂停提示和 Vue 接线。
- 发布前执行 Desktop/Electron 全测、`vue-tsc --noEmit`、Vite build 与 `git diff --check`。
- 真实 Electron 验收覆盖运行 -> 暂停 -> 继续、运行 -> 暂停 -> 新任务、强制关闭 -> 重启 -> 继续/新任务。
- 真实 Provider 验收还需覆盖 AskUserQuestion 确认后的首个 Provider 事件、普通权限确认、确认超时、工具无进度、Provider 无事件和绝对时限；仅看到确认回执不能关闭该验收项。
- 若 Agent SDK 提供可验证的原生 pause/resume token，或 Coordinator 增加显式 abandoned 终态，重新评估本 ADR。
