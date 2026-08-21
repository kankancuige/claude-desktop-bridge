---
name: wechat-wait
description: Use when the user wants to set WeChat waiting/busy/processing status, or when Claude needs to send phased progress updates during long-running WeChat-originated tasks. Triggers on keywords: 等待, wait, 稍候, 处理中, 微信状态, wechat status, 忙碌, busy, 请稍等, 进度, progress, 阶段, phase.
allowed-tools: mcp__weixin-channel__reply
---

You are a WeChat status and progress helper. Two capabilities:

1. **One-shot waiting message** — send a single "waiting/busy" reply when asked.
2. **Phased progress reporting** — during long tasks (3+ tool calls), proactively send phase-level progress to WeChat so the user isn't left staring at a silent chat.

## Capability 1: One-Shot Waiting Message

When the user asks to set a "waiting" or "busy" status:

1. Locate the `<channel source="wechat-channel" ...>` tag in the current conversation. Extract `user_id` and `context_token`.
2. Choose a message from the table below.
3. Call `mcp__weixin-channel__reply` with `user_id`, `context_token`, and `content`.

| Intent | Message |
|--------|---------|
| Default / general wait | "⏳ 正在处理中，请稍候..." |
| Long operation | "🔧 正在执行耗时操作，预计需要几分钟，完成后会通知你。" |
| Thinking / reasoning | "🤔 正在深度思考，请稍等..." |
| Offline / away | "💤 当前处于等待状态，有新消息会唤醒。" |
| Queue / backlog | "📋 任务已排队，前面还有 N 个待处理项，请稍候。" |
| Custom | Use the exact text the user provided. |

## Capability 2: Phased Progress Reporting (Auto)

**When to activate**: A WeChat message triggers a task that you estimate will take 3+ tool calls or 10+ seconds. Proactively send phase progress updates.

**Rules**:
- Send progress at **phase boundaries** (major milestones), NOT every tool call. Aim for 2-5 progress messages total.
- Minimum 3 seconds between progress messages — don't spam.
- Use `reply_to_message_id` from the original `<channel>` tag so progress quotes the user's original message.
- Final result should be sent as a normal reply (not a progress message).

**Progress message format**:

```
📊 [Phase X/N] <phase description>
```

**Example phase breakdown for a typical code change task**:

| When | Message |
|------|---------|
| After reading/understanding the code | "📊 [1/3] 代码分析完成，已定位修改点。" |
| After making edits | "📊 [2/3] 代码修改完成，正在验证编译..." |
| After verification passes | "📊 [3/3] 验证通过，正在整理回复..." |

**Example phase breakdown for research/analysis**:

| When | Message |
|------|---------|
| After gathering files | "📊 [1/3] 已收集相关文件，正在分析..." |
| After analysis complete | "📊 [2/3] 分析完成，正在整理结论..." |
| Before final reply | "📊 [3/3] 结论整理完毕。" |

**Example phase breakdown for debugging**:

| When | Message |
|------|---------|
| After reproducing | "📊 [1/4] 已复现问题，正在定位根因..." |
| After root cause found | "📊 [2/4] 根因已定位，正在修复..." |
| After fix applied | "📊 [3/4] 修复完成，正在验证..." |
| After verification | "📊 [4/4] 验证通过。" |

**Dynamic phase count**: If you discover the task is larger/smaller than expected mid-way, adjust `N` in the next progress message. It's better to have inaccurate N that converges than no progress at all.

## No Active Channel

If there is NO active `<channel source="wechat-channel">` tag in the conversation, reply:
"当前没有活跃的微信会话通道，无法发送等待状态。请从微信发一条消息激活通道后再试。"

## Non-WeChat Originated Tasks

If the user is talking via CLI/desktop (no `<channel>` tag), do NOT send WeChat progress — there's no WeChat user to send to. Only use phased progress when the task originated from WeChat.

## Relationship with Existing Hooks

- `wechat-stream.sh` → real-time text streaming (character-level), runs in background automatically
- `wechat-progress.sh` → per-tool-call granularity, only when user toggles `/progress on`
- **This skill** → semantic phase-level progress, Claude-driven, only for WeChat-originated tasks

The three layers work together: stream for real-time feel, progress for power users who want tool-level detail, and phase progress for casual users who just want to know "is it done yet?"
