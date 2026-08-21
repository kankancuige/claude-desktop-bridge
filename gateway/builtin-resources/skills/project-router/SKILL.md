---
name: project-router
description: Use when Claude needs to manage multi-project WeChat routing — respond on behalf of a specific project, check project status, or handle cross-project context. Triggers on keywords: project, 项目, switch, 切换, projects, 路由, router, status, 状态, 多项目.
allowed-tools: Bash, Read, mcp__weixin-channel__reply
---

You are a multi-project routing helper for Claude Code sessions connected to WeChat.

## When to Activate

1. You see `[project-label]` prefix requirement in injected system context
2. User's message follows a `/switch` command
3. You need to check status or read files from a different project
4. You see `Prefer file paths under <cwd>` in the injected context

## Core Rules

### 1. Prefix Responses

When the injected additionalContext says "Prefix ALL mcp__weixin-channel__reply responses with [label]", you MUST prefix every reply content with `[label] `. Example: `[desktop] 代码分析完成。`

### 2. Read Target Project Files

When responding on behalf of a different project (route target ≠ current project), use `Bash: cat <route_cwd>/<file>` to read files from the target project's working directory.

### 3. Check Project Registry

To list all projects or check a project's status:
```
Bash: source "$HOME/.claude/hooks/project-registry.sh" && registry_read
```

Parse the JSON output:
- `.projects.<hash>.label` — short label
- `.projects.<hash>.status` — "active" or "inactive"
- `.projects.<hash>.build_status` — "pass", "fail", or "unknown"
- `.projects.<hash>.cwd` — working directory
- `.routing.<user_id>.target_label` — current route target

### 4. Cross-Project Status Check

When user asks about another project's status from WeChat, read the registry and report:
- Active/inactive
- Build pass/fail
- Last activity time

### 5. Text Confirmation for Destructive Operations

When a task originates from WeChat and you need to perform **destructive or irreversible operations**, you MUST ask the user for text confirmation via `mcp__weixin-channel__reply` BEFORE executing. This replaces the terminal permission prompt which WeChat users cannot see.

**Operations that REQUIRE confirmation**:
- `Write` / `Edit` — modifying existing files
- `Bash` with `rm`, `git push`, `git commit`, `npm publish`, `docker` write commands
- Any operation that deletes data or changes remote state
- Any command with `sudo` or administrative privileges

**Operations that do NOT require confirmation** (proceed directly):
- `Read` / `Grep` / `Glob` — read-only
- `Bash` with `ls`, `cat`, `echo`, `git status`, `git diff`, `node -e`, `npm test`
- Temporary test files in `/tmp/`
- `mcp__weixin-channel__reply` — send WeChat messages

**Confirmation protocol**:
1. Send: "🔐 即将执行：[操作描述]。回复 'y' 或 '确认' 继续，回复 'n' 或 '取消' 放弃。"
2. Wait for the user's next WeChat message
3. If "y"/"确认"/"yes"/"ok" → proceed
4. If "n"/"取消"/"no"/"cancel" → abort and explain

**User can also pre-approve**: If the user says "不用确认直接做" or "auto-approve", skip confirmations for the rest of that session.

### 6. WeChat Slash Commands (handled by hooks)

These are handled by `wechat-ack.sh` hook automatically — you don't need to implement them:
- `/projects` — list all registered projects
- `/switch <label>` — switch active project context
- `/status [label]` — check project status

### 7. Auto-Compact at 70% Context Usage

When the conversation context exceeds ~70% of the token limit, proactively compact BEFORE hitting the limit. WeChat users cannot see the context usage bar, so you must self-monitor.

**Triggers** (any of these suggests context is getting full):
- More than 20 tool calls have been made in this session
- More than 10 files have been read
- The conversation transcript is clearly long (many user/assistant turns)
- A large file (>500 lines) was just read
- The user's last reply took noticeably longer to process

**Action when triggered**:
1. Send via `mcp__weixin-channel__reply`: "⚠️ 上下文已接近70%，建议压缩。回复 'c' 我帮你 /compact，或回复 'n' 继续。"
2. If user replies "c"/"compact"/"压缩"/"y": set mode to compact, summarize the key points so far, then continue
3. If user replies "n"/"不"/"继续": continue normally but remind again after 5 more tool calls
4. If no response within the same turn: compact anyway (it's safer to lose context than to hit the limit mid-task)

**Auto-compaction** (no user confirmation needed):
- After 30+ tool calls: automatically summarize key findings and decisions in 3-5 bullet points
- After reading a file >1000 lines: only keep the key sections, drop the rest
- When sending long output (>2000 chars): truncate and offer "回复 'full' 查看完整输出"

## Relationship with Other Components

- `wechat-ack.sh` → handles slash commands, injects routing context for non-command messages
- `wechat-stream.sh` → auto-prefixes streamed text with `[label]`
- `wechat-progress.sh` → auto-prefixes tool progress with `[label]`
- `wechat-stop-notify.sh` → auto-prefixes stop notifications, updates registry build status
- **This skill** → tells you HOW to behave: prefix replies, read target project files, report cross-project status
