# UTF-8、文件查看与任务活动状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定仓库文本编码，为文件和 Diff 弹窗增加最大化查看，并让用户看到当前会话正在执行的具体阶段和最近活动。

**Architecture:** 编码层通过仓库级 `.editorconfig` 和字节扫描约束 UTF-8，不对正常文件做二次转码。文件查看沿用现有 Monaco 弹窗，只增加可逆的最大化状态。任务进度由前端纯函数归一化现有 Gateway 事件，并随标签页状态保存，UI 只消费稳定的活动摘要。

**Tech Stack:** Electron、Vue 3 Composition API、TypeScript、Monaco Editor、Node.js test runner、Vite。

## Global Constraints

- 保留当前 dirty worktree，不覆盖无关改动。
- 不新增依赖，不修改 Gateway 对外协议。
- 中文源码和注释统一保存为 UTF-8。
- 不重启服务，不提交，不推送。

---

### Task 1: UTF-8 编码约束

**Files:**
- Create: `.editorconfig`

**Interfaces:**
- Consumes: 当前仓库文本文件。
- Produces: 编辑器统一使用 UTF-8、LF 和最终换行。

- [ ] **Step 1: 扫描真实乱码**

运行 UTF-8 字节扫描，检查 `U+FFFD` 和典型乱码字符串，确认 PowerShell 默认代码页显示不被误判为源码损坏。

- [ ] **Step 2: 添加编码规则**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
```

- [ ] **Step 3: 复扫**

运行相同扫描并执行 `git diff --check`。

### Task 2: 文件与 Diff 最大化查看

**Files:**
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: `modalMode`、Monaco 编辑器和现有文件/Diff API。
- Produces: `modalMaximized` 和最大化/还原按钮。

- [ ] **Step 1: 增加弹窗最大化状态**

打开新文件时默认使用普通大窗，关闭时清理最大化状态。

- [ ] **Step 2: 增加图标按钮和布局类**

按钮只使用最大化/还原图标和 tooltip；最大化时弹窗占满应用可用区域并保持 Monaco 自动布局。

- [ ] **Step 3: 验证两种模式**

分别验证文件编辑和 Diff 对比在普通、最大化状态下可滚动、可保存、可关闭。

### Task 3: 会话任务活动状态

**Files:**
- Create: `desktop-ui/src/task-activity.ts`
- Create: `desktop-ui/src/task-activity.test.mjs`
- Modify: `desktop-ui/src/views/WorkspaceView.vue`

**Interfaces:**
- Consumes: Gateway WebSocket 事件和标签页快照。
- Produces: `TaskActivityState`、`reduceTaskActivity()`、`taskActivityFreshness()`。

- [ ] **Step 1: 编写事件归一化测试**

覆盖任务开始、思考、工具调用、Agent、审查、压缩、文本生成、完成和长时间无事件。

- [ ] **Step 2: 实现纯函数 reducer**

活动状态保存阶段、标题、详情、开始时间和最后更新时间；终态停止运行计时。

- [ ] **Step 3: 接入标签页状态和 WebSocket 事件**

切换标签页时恢复各自活动状态，后台标签页事件只更新对应快照。

- [ ] **Step 4: 增加任务活动栏**

执行中显示当前阶段、动作、总耗时和最近活动；60 秒无事件显示等待提示，180 秒无事件显示需检查连接/API 的提示。

### Task 4: 验证

**Files:**
- Test: `desktop-ui/src/*.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3 的实现。
- Produces: 测试、类型检查、生产构建和编码扫描证据。

- [ ] **Step 1: 运行前端全部测试**
- [ ] **Step 2: 运行 `vue-tsc --noEmit`**
- [ ] **Step 3: 运行 Vite 生产构建**
- [ ] **Step 4: 运行 UTF-8 扫描和 `git diff --check`**
