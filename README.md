# Claude Desktop Bridge

自建 Claude Code 桌面客户端，支持 **Windows / macOS / Linux** 三平台。Vue 3 Electron 桌面壳 + Node.js Gateway + 多 IM 平台适配器。

**核心亮点**：微信 / 飞书 / 钉钉消息**直接注入当前活跃 session**，桌面端实时同步显示 Claude 回复。

---

## 目录

- [架构概览](#架构概览)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
  - [1. 配置 Gateway](#1-配置-gateway)
  - [2. 启动开发环境](#2-启动开发环境)
  - [3. 构建生产包](#3-构建生产包)
  - [4. GitHub Actions 自动构建](#4-github-actions-自动构建)
- [功能详解](#功能详解)
  - [AI 供应商管理](#ai-供应商管理)
  - [工作区（会话管理）](#工作区会话管理)
  - [文件面板与 Diff](#文件面板与-diff)
  - [记录点（Checkpoints）](#记录点checkpoints)
  - [桌面宠物](#桌面宠物)
  - [项目结构缓存](#项目结构缓存)
  - [IM 集成（微信 / 飞书 / 钉钉）](#im-集成微信--飞书--钉钉)
  - [Workflow 多 Agent 编排](#workflow-多-agent-编排)
  - [配置管理（Settings）](#配置管理settings)
  - [压缩模式（Caveman / RTK）](#压缩模式caveman--rtk)
  - [DeepSeek 兼容代理](#deepseek-兼容代理)
  - [定时任务（Scheduler）](#定时任务scheduler)
  - [自动更新](#自动更新)
- [配置参考](#配置参考)
  - [Gateway 环境变量](#gateway-环境变量)
  - [settings.json](#settingsjson)
  - [adapters.json](#adaptersjson)
- [日志系统](#日志系统)
- [Claude Code CLI 路径检测](#claude-code-cli-路径检测)
- [安全注意事项](#安全注意事项)
- [License](#license)
- [请我喝杯奶茶](#请我喝杯奶茶)
- [常见问题](#常见问题)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop UI (Electron)                      │
│              Vue 3 + Pinia + TypeScript + Vite                │
│    ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│    │ WorkspaceView │  │ SettingsView │  │   PhaserPet    │   │
│    │ (项目/会话/聊天) │  │ (12 Tab 配置) │  │ (桌面精灵宠物)   │   │
│    └──────────────┘  └──────────────┘  └────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (ws://127.0.0.1:3456)
┌──────────────────────▼──────────────────────────────────────┐
│                    Gateway (Node.js)                          │
│         @anthropic-ai/claude-agent-sdk + REST API             │
│    ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐     │
│    │ Session Pool│ │ Workflow 引擎 │ │  DeepSeek Proxy  │     │
│    │ PushStream  │ │ (VM 沙箱)     │ │  (兼容代理 :8787) │     │
│    │ Checkpoints │ │              │ │                  │     │
│    └─────────────┘ └──────────────┘ └─────────────────┘     │
│    ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐     │
│    │ Project     │ │  Caveman/RTK  │ │  Tesseract OCR   │     │
│    │ Cache (AST) │ │  压缩模式      │ │  (图片理解fallback)│     │
│    └─────────────┘ └──────────────┘ └─────────────────┘     │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │ iLink Bot API    │ 飞书 SDK         │ dingtalk-stream
       │ (HTTP 长轮询)    │ (WS 长连接)       │ (Stream 模式)
┌──────▼──────┐  ┌────────▼──────┐  ┌────────▼──────┐
│  WeChat 适配器│  │  Feishu 适配器 │  │ DingTalk 适配器│
│  (wechat.mjs)│  │  (feishu.mjs) │  │(dingtalk.mjs) │
└──────┬──────┘  └───────┬──────┘  └───────┬──────┘
       │                 │                 │
┌──────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│    微信      │  │    飞书      │  │    钉钉      │
└─────────────┘  └──────────────┘  └──────────────┘
```

### 数据流

```
用户消息（桌面/微信/飞书/钉钉）
  → Gateway WebSocket 注入
  → PushStream → SDK query()
  → Claude Code CLI (或 DeepSeek/OpenAI 等兼容 API)
  → SDK 流式响应 → stream_event → broadcast (WebSocket)
  → 桌面端实时渲染 + IM 平台 mirror 同步
```

### 确认/权限流程

```
SDK 触发工具调用 → canUseTool 回调 → 广播确认请求
  → 所有已连接通道（桌面 + mirror 已开启的 IM）
  → 任一通道响应 → settlePending → SDK 继续执行
  → 其他通道收到 confirmation_resolved 自动关闭
```

---

## 功能特性

| 模块 | 功能 |
|------|------|
| **多供应商 AI** | DeepSeek / Anthropic / OpenAI / 智谱 / Kimi / Gemini / Codex / Qwen / OpenRouter / Ollama / 火山引擎 + 自定义，支持动态模型列表 |
| **多平台桌面端** | Windows / macOS / Linux，Electron 原生窗口 + 自定义标题栏 + 系统托盘 |
| **IM 集成** | 微信 (iLink Bot)、飞书 (企业自建应用)、钉钉 (内部应用 Stream 模式)，支持配对授权 |
| **实时对话** | WebSocket 流式推送，text_delta 逐字渲染，tool_use_start 工具进度实时可见，thinking 折叠展开 |
| **确认/授权** | 工具调用需要用户确认，支持桌面端弹窗 + IM 回复双通道，5 分钟超时自动拒绝 |
| **Mirror 同步** | 桌面端 Claude 回复可自动推送到已绑定 IM 用户（开启后 IM 侧无需手动输入） |
| **文件面板** | 工作目录文件树 + 快照基线对比（全部/仅改动），Monaco Editor 行级 Diff + 直接编辑保存 |
| **记录点** | 每轮 AI 操作自动生成 Checkpoint，支持回退文件到任意轮次之前，跨重启持久化 |
| **桌面宠物** | Phaser 4 引擎驱动的 Shimeji 桌面精灵，50+ 角色可选，响应 AI 状态（思考/工具调用/错误） |
| **项目结构缓存** | 13 语言 AST 解析（tree-sitter），自动构建依赖图 + 影响面分析，注入 Claude 上下文避免重复探索 |
| **Workflow 编排** | 内置 7 种实战 Workflow 模板，VM 沙箱执行，支持暂停/恢复/Journal 缓存 |
| **配置管理** | Skills / Agents / Hooks / Rules / Memory / MCP 完整 CRUD + 可视化编辑 |
| **压缩模式** | Caveman（Token 压缩 ~75%）+ RTK（Bash 输出压缩），支持 GitHub 自动更新 |
| **DeepSeek 代理** | 内置兼容代理修复 `thinking` 与 `reasoning_content` 兼容性 Bug，自动路由 |
| **OCR 图片理解** | Tesseract.js 对非多模态模型自动 OCR 识别图片文字，作为 Claude 上下文注入 |
| **定时任务** | Cron 定时任务 CRUD，支持一次性/周期性调度，持久化到磁盘 |
| **自动更新** | electron-updater 自动检查/下载/安装更新，GitHub Release 分发 |
| **主题与语言** | Dark / Light / 跟随系统 + 中文 / English |
| **日志系统** | 结构化日志（pino），按天+按大小分包，自动过期清理，完整堆栈保留 |
| **GitHub Actions** | push 自动三平台构建，产物可直接下载 |

---

## 技术栈

### 前端 (Desktop UI)

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | ^3.5 | Composition API 响应式 UI |
| TypeScript | ~6.0 | 类型安全 |
| Vite | ^8.0 | 构建工具 + HMR 热更新 |
| Pinia | ^3.0 | 响应式状态管理 |
| Vue Router | ^4.6 | Hash 模式路由 |
| Electron | ^42.4 | 桌面端原生窗口 |
| electron-builder | ^26.15 | 三平台打包 |
| electron-updater | ^6.8 | 自动更新 |
| Monaco Editor | ^0.55 | 代码编辑器 + Diff 视图 |
| Phaser | ^4.2 | 桌面宠物游戏引擎 |

### 后端 (Gateway)

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 20+ | 运行时 |
| @anthropic-ai/claude-agent-sdk | ^0.1.77 | Claude Code SDK 集成 |
| ws | ^8.18 | WebSocket 服务端 |
| dotenv | ^16.4 | 环境变量加载 |
| pino | ^10.3 | 结构化日志 |
| pino-pretty | ^13.1 | 日志控制台美化 |
| pino-roll | ^4.0 | 日志按天/大小分包 |
| tree-sitter | ^0.22 | 多语言 AST 解析（13 语言） |
| tesseract.js | ^7.0 | OCR 图片文字识别 |
| node-cron | ^4.5 | Cron 定时任务调度 |

### IM 适配器

| 适配器 | SDK | 通信方式 |
|--------|-----|---------|
| 微信 | iLink Bot API（HTTP 长轮询） | 配对码 + context_token |
| 飞书 | @larksuiteoapi/node-sdk ^1.67 | WebSocket 长连接 (EventDispatcher) |
| 钉钉 | dingtalk-stream ^2.1 | Stream 模式 (DWClient + TOPIC_ROBOT) |

---

## 项目结构

```
claude-desktop-bridge/
├── .github/workflows/build.yml    # GitHub Actions 三平台自动构建
├── gateway/                        # Node.js Gateway 后端
│   ├── index.mjs                   # 主入口: HTTP + WebSocket + session 管理
│   ├── logger.mjs                  # 统一日志模块 (pino + pino-roll)
│   ├── wechat.mjs                  # 微信适配器 (iLink Bot 长轮询)
│   ├── feishu.mjs                  # 飞书适配器 (WS 长连接)
│   ├── dingtalk.mjs                # 钉钉适配器 (Stream 模式)
│   ├── workflow-runner.mjs         # Workflow 多 Agent 编排引擎 (VM 沙箱)
│   ├── deepseek-proxy.mjs          # DeepSeek 兼容代理 (thinking/reasoning_content)
│   ├── project-cache.mjs           # 项目结构缓存 (tree-sitter AST + 依赖图)
│   ├── test.mjs                    # 手动集成测试脚本
│   ├── builtin-skills/caveman/     # 内置 Caveman 压缩技能
│   ├── package.json                # npm 依赖
│   ├── .env                        # 环境变量（不提交 Git）
│   └── .env.example                # 环境变量模板
├── desktop-ui/                     # Vue 3 Electron 桌面 UI
│   ├── electron/                   # Electron 主进程
│   │   ├── main.cjs                # 窗口管理 + gateway 子进程生命周期 + 托盘
│   │   ├── preload.cjs             # IPC 安全桥接 (contextBridge)
│   │   └── updater.cjs             # electron-updater 自动更新
│   ├── scripts/
│   │   ├── after-pack.cjs          # electron-builder 打包后处理
│   │   └── prebuild.cjs            # 构建前清理 Electron 进程
│   ├── src/
│   │   ├── App.vue                 # 根组件（主题/自定义标题栏/Claude检测/更新提示）
│   │   ├── main.ts                 # Vue 应用入口 (Pinia + Router + Monaco Workers)
│   │   ├── i18n.ts                 # 轻量国际化（中文/English，零依赖）
│   │   ├── style.css               # 设计系统 (CSS 变量 + Glassmorphism)
│   │   ├── router/index.ts         # Hash 模式路由
│   │   ├── composables/
│   │   │   └── useWorkflow.ts      # Workflow DAG 状态管理
│   │   ├── components/
│   │   │   ├── SidebarLeft.vue     # 左侧项目/会话列表
│   │   │   ├── RightPanels.vue     # 右侧文件面板 + Agent/Workflow 面板
│   │   │   ├── FileModal.vue       # 文件预览/Diff/Markdown 弹窗 (Monaco Editor)
│   │   │   ├── GlobalToast.vue     # 全局 Toast 通知
│   │   │   └── types.ts            # 共享 TypeScript 类型定义
│   │   ├── views/
│   │   │   ├── WorkspaceView.vue   # 工作区（项目/会话/聊天主界面）
│   │   │   ├── SettingsView.vue    # 设置页（12 Tab 配置容器）
│   │   │   ├── WorkflowTab.vue     # Workflow DAG 设计器 + 脚本编辑器
│   │   │   ├── PhaserPet.vue       # Phaser 4 桌面宠物 (Shimeji 精灵)
│   │   │   └── PetView.vue         # 旧版 SVG 像素宠物 (legacy)
│   │   └── data/
│   │       └── petRects.ts         # 像素宠物 SVG 坐标数据
│   ├── public/media/               # 宠物精灵 PNG (50+ 种)
│   ├── package.json                # pnpm 依赖 + electron-builder 配置
│   ├── vite.config.ts              # Vite 构建配置 (含 petScanner 插件)
│   └── tsconfig*.json              # TypeScript 配置
├── rtk-bin/                        # RTK Bash 压缩二进制 (打包用)
│   ├── rtk-x86_64-pc-windows-msvc.exe
│   └── version.txt
├── scripts/                        # 辅助脚本
│   ├── classify-pet-rects.mjs      # 宠物精灵矩形分类工具
│   └── gen-pets.mjs                # 宠物精灵生成工具
└── README.md                       # 本文档
```

---

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 20+ | 推荐 20 LTS |
| pnpm | 最新 | Desktop UI 包管理器（也可用 npm） |
| Git | 2.x | 版本管理 + CI（可选） |

### 可选依赖

| 依赖 | 说明 |
|------|------|
| Claude Code CLI | 本地安装的 `claude` 可执行文件。也可以通过配置 `.env` 中的 `CLAUDE_EXE` 指向自定义路径。用于 SDK query 后台进程。不装可用但功能受限。 |
| API Key | DeepSeek / Anthropic / OpenAI 等供应商的 API Key，至少需要一个 |

---

## 快速开始

### 1. 配置 Gateway

```bash
cd gateway
npm install

# 复制环境变量模板并编辑
# Windows (Git Bash / WSL):
cp .env.example .env
# 编辑 .env 填入你的 API Key
```

`.env` 核心配置：

```ini
PORT=3456
ANTHROPIC_API_KEY=sk-your-deepseek-or-anthropic-key
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-pro
LOG_LEVEL=info
```

### 2. 启动开发环境

```bash
# 终端 1: 启动 Gateway（也可让 Electron 自动启动）
cd gateway
node index.mjs

# 终端 2: 启动 Desktop UI（开发模式，含 HMR）
cd desktop-ui
pnpm install
pnpm dev:electron
```

`pnpm dev:electron` 会同时启动：
- **Vite 开发服务器**（`localhost:5173`，HMR 热更新）
- **Electron 窗口**（等待 Vite 就绪后自动连接）
- **Gateway 子进程**（Electron 主进程内部管理，崩溃自动重启最多 5 次）

仅在浏览器中调试（不用 Electron 原生窗口）：

```bash
pnpm dev:web
# 浏览器打开 http://localhost:5173
```

### 3. 构建生产包

```bash
# Windows（portable .exe）
cd desktop-ui
pnpm build

# macOS（需在 macOS 上运行，输出 .dmg）
pnpm build:mac

# Linux（输出 .AppImage）
pnpm build:linux
```

构建产物在 `desktop-ui/dist-electron/` 目录下。

### 4. GitHub Actions 自动构建

push 到 `main` 分支自动触发三平台构建，产物在 Actions 页面 → Artifacts 区域下载：

```
Code → Actions → 最新一次 Workflow run → Artifacts
├── Claude-Desktop-Bridge-Windows/
├── Claude-Desktop-Bridge-macOS/
└── Claude-Desktop-Bridge-Linux/
```

也可手动触发：Actions → 三平台构建 → Run workflow。

---

## 功能详解

### AI 供应商管理

设置页 → **常规** Tab：

- **供应商选择器**：预设 DeepSeek / Anthropic / OpenAI / 智谱 / Kimi / Gemini / Codex / Qwen / OpenRouter / Ollama / 火山引擎 + 自定义
- **API Key**：输入对应的 API Key
- **默认模型**：从供应商的模型列表中动态拉取（支持 OpenAI 兼容 `/v1/models` 端点实时获取），也支持手动输入
- **测试连接**：一键验证 API Key 和网络连通性
- **余额查询**：对于 DeepSeek 等支持余额接口的供应商，显示账户余额和累计费用
- **最大上下文 / 单次最大轮数 / 文件注入上限 / 费用告警阈值**：高级参数配置

### 工作区（会话管理）

主界面左侧栏：

- **项目列表**：自动扫描 `~/.claude/projects/` 下所有会话项目
- **新增项目**：点击 → 选择本地文件夹（调用系统原生目录选择器），或手动输入绝对路径
- **会话管理**：每个项目可创建 / 恢复 / 删除会话，分页加载
- **实时对话**：Enter 发送，Shift+Enter 换行
- **消息队列**：AI 思考中发送的消息自动排队，逐条注入
- **输入辅助**：`/` 触发命令补全、`#` 触发文件补全、`@` 触发 Agent 补全
- **流式渲染**：Claude 思考内容折叠显示，工具调用实时进度（含耗时），Subagent 生命周期展示
- **权限确认**：弹窗包含工具名和参数摘要，支持允许/拒绝/选择（AskUserQuestion）
- **上下文环**：圆形可视化显示已用 token 比例 + 累计费用，点击执行 `/compact`
- **消息操作**：复制 / 重新填入输入框 / 导出（Markdown / JSON / JSONL）
- **Gateway 状态**：左下角显示连接状态 + 版本号

### 文件面板与 Diff

右侧面板 → **项目文件**：

- **文件树**：展示当前工作目录文件结构，文件夹展开/折叠
- **改动检测**：会话开始自动拍快照基线（SHA256），切换"仅改动"查看本轮修改
- **文件状态标记**：A (Added) / M (Modified) / D (Deleted)，显示 `+x/-y` 行数
- **Monaco Editor**：点击文件以 Monaco 打开，支持语法高亮、直接编辑保存（Ctrl+S）
- **行级 Diff**：点击改动文件展示完整 `+/-` 差异对比（Monaco Diff Editor）
- **Markdown 预览**：`.md` 文件自动渲染 HTML 预览
- **二进制文件**：显示"无法预览"提示
- **基线重置**：手动将当前文件状态设为新基线（改动归零）

### 记录点（Checkpoints）

每个 AI 操作轮次自动创建记录点：

- **文件列表**：该轮修改的所有文件及 `+x/-y` 行数
- **回退**：一键将工作目录恢复到指定记录点之前的状态（写磁盘）
- **提交**：确认本轮修改，选择性提交文件，清空记录点，重新建立基线
- 数据持久化到 `~/.claude/projects/<name>/bridge-checkpoints/`，重启不丢失

### 桌面宠物

主界面右下角常驻 Phaser 4 引擎驱动的 Shimeji 桌面精灵：

- **50+ 角色**：从 `public/media/` 扫描 PNG 精灵表，右键菜单切换
- **状态响应**：连接成功（打招呼）、工具调用（欢呼）、构建中（攀爬）、成功（跳跃）、错误（跳跃+坐下）、断开（坐下）、思考中（随机走动）
- **智能行为**：55% 概率走动、25% 打招呼、17% 坐下，物理引擎模拟
- **拖拽**：可拖动宠物到窗口任意位置
- **上下文告警**：上下文超过 80% 时提示，点击执行 `/compact`
- **气泡提示**：显示模型名、状态、上下文占比、费用信息
- **性能**：FPS 限制 20 帧，页面不可见时暂停渲染

### 项目结构缓存

Gateway 内置项目结构分析引擎（`project-cache.mjs`）：

- **13 语言 AST 解析**：JS/TS/Vue/Python/Java/Go/C#/Rust/C/C++/Ruby/PHP/Kotlin/Swift，基于 tree-sitter + 正则回退
- **依赖图构建**：提取 import/export，计算文件间依赖边 + 置信度
- **枢纽节点识别**：按被依赖数排序，标记高影响面文件
- **影响面分析**：每个文件的 `riskOnChange` 级别 + 受影响文件数
- **技术栈检测**：自动识别框架（Vue/React/Angular/Svelte）、构建工具（Vite/Webpack/Maven/Gradle/Cargo）、包管理器、Electron 等
- **增量更新**：首次全量扫描（SHA256），后续仅更新变更文件
- **自动注入**：Claude 首次探索项目时，自动注入 ~8000 字符的结构摘要，避免重复文件扫描
- 缓存文件：`~/.claude/projects/<name>/bridge-structure-cache.json`

### IM 集成（微信 / 飞书 / 钉钉）

#### 激活流程（两阶段）

**阶段 1 — 平台绑定（需在设置页完成）**：

| 平台 | 绑定方式 | 说明 |
|------|---------|------|
| 微信 | 扫码绑定 | 设置页 → IM 连接 → 微信 → "扫码绑定" → 生成二维码 → 用微信扫描 → 将 Bot 关联到 Gateway |
| 飞书 | 填写凭据 | 设置页 → IM 连接 → 飞书 → 填入 App ID + App Secret → 保存 |
| 钉钉 | 填写凭据 | 设置页 → IM 连接 → 钉钉 → 填入 Client ID + App Secret → 保存 |

平台绑定完成后，对应平台状态显示为"已连接"。

**阶段 2 — 用户激活（在 IM 客户端完成）**：

Gateway 每次启动时为每个已连接的平台生成一个 6 位**授权码**，可从终端日志中看到：

```
[微信] 配对码: 123456 (发给bot即可配对)
[飞书] 配对码: 789012
[钉钉] 配对码: 345678
```

激活步骤：

```
1. 用户（或任何需要接入的人）在微信/飞书/钉钉中给 Bot 发送任意消息
2. Bot 自动回复一条包含授权码的提示："请先发送配对码进行授权。你的配对码是: XXXXXX"
3. 用户将授权码发给 Bot
4. Bot 回复"配对成功" → 激活完成，此后可正常对话
```

> **授权码仅需一次**：每个用户配对后即写入 `~/.claude/bridge-paired*.json` 持久化，此后永久有效。Gateway 重启后授权码会变，但**已配对用户完全不受影响**，无需重复操作。只有在设置页**解除绑定后重新绑定**时才需要再次使用新授权码。

设置页 → **IM 连接** Tab：

- **微信**（iLink Bot）：
  - 扫码绑定 QR 二维码
  - 配对码 + 白名单机制
  - Mirror 同步：桌面端回复自动推送到已绑定用户
  - 长文本自动按 UTF-8 字节分段（3500 字节/段），带 `[n/N]` 页码标记

- **飞书**（企业自建应用）：
  - 需要 App ID + App Secret
  - 飞书开放平台创建应用 → 添加机器人能力 → 启用长连接
  - SDK 自动处理鉴权/心跳/重连

- **钉钉**（内部应用）：
  - 需要 Client ID (AppKey) + App Secret
  - Stream 模式 → 自动处理鉴权和消息推送
  - access_token 自动管理和刷新（100 分钟缓存）

**IM 使用流程**：

```
1. 桌面端打开工作区（必须有活跃 session）
2. IM 用户发送消息 → Gateway resolve session → 注入到同一 session
3. Claude 回复 → 桌面端实时显示 + IM 用户收到回复
4. 权限确认 → 可跨通道（桌面弹窗 or IM 回复）完成
```

### Workflow 多 Agent 编排

设置页 → **Workflow** Tab，支持 DAG 可视化设计 + 脚本编辑双模式：

**内置 7 种生产级模板**：

| 模板 | 适用场景 |
|------|---------|
| `code-review` | PR review / 安全审计，多维度并行审查 + 对抗性验证，自动检测项目语言 |
| `bug-hunter` | 发版前排查 / 重构后验证，4 角度猎手搜索 + 证伪者逐条反驳 |
| `judge-panel` | 架构选型 / 方案对比，多方案独立生成 + 并行评分 + 融合 |
| `deep-research` | 代码库调研 / 技术选型研究，多角度检索 + 交叉核实 |
| `generate-critic-fix` | 复杂功能实现 / 算法优化，生成→批评→修复迭代循环 |
| `audit-sweep` | 项目审计 / 技术债梳理，多模块并行扫描 + 深度挖掘 + 完整性检查 |
| `default` | 通用多阶段编排：Plan → Execute → Review → Synthesize |

**DAG 设计器**：

- SVG 画布，节点拖拽，端口连线（Explore / Plan / General / Review / Guide / Claude）
- 并行组（多选 + 编组），阶段分隔条
- 自动布局（拓扑排序分层），属性面板编辑
- DAG → JavaScript 代码导出

**Workflow DSL**：完整的 JavaScript DSL（agent / parallel / pipeline / phase / log / budget / args），VM 沙箱隔离执行。支持 Journal 内容哈希缓存（Resume 断点续跑），Schema 验证 + 重试，Git Worktree 隔离环境，预算硬限制。

### 配置管理（Settings）

| Tab | 功能 |
|------|------|
| **常规** | AI 供应商 / API Key / 模型 / 主题 / 语言 / 高级参数（最大上下文、最大轮数、文件注入上限、费用告警） |
| **Skills** | AI 技能模块的 CRUD，skills.sh 多源市场搜索/安装，内置/自定义筛选，启用/禁用 |
| **Agents** | 自定义子代理（.md frontmatter），Type / Language / Tools / Model，删除自动 .bak 备份 |
| **命令** | 斜杠命令列表（只读），支持搜索，标注实时/缓存来源 |
| **Hooks** | 事件钩子脚本（.sh/.js），按触发时机分组（PostToolUse / Stop / PreToolUse 等） |
| **Rules** | 编码规则（.md），按语言分组，paths 属性按文件扩展名匹配 |
| **Memory** | 跨项目记忆文件概览，展开/折叠，创建/删除/刷新，.md 后缀自动追加 |
| **MCP** | MCP 协议服务器，内置插件列表 + 已安装列表 + 自定义服务器 CRUD（stdio/sse/http 传输） |
| **IM 连接** | 微信扫码绑定 / 飞书凭据 / 钉钉凭据，绑定/解绑/状态查看 |
| **Workflow** | DAG 设计器 + 脚本编辑器 + 全局开关，支持执行/暂停/恢复/状态监控 |
| **定时任务** | Cron 定时任务 CRUD，可视化频率选择（每天/工作日/每周/每月/自定义），手动触发 |
| **开源** | Caveman 压缩配置 / RTK 压缩配置 / 桌面宠物选择 |

### 压缩模式（Caveman / RTK）

**Caveman**（Token 压缩 ~75%）：
- 类洞穴人语法的超压缩通信模式，保持完整技术精度
- 支持强度等级：lite / full / ultra / wenyan-lite / wenyan-full / wenyan-ultra
- 自动注入激活短语到会话上下文
- GitHub Release 自动检查更新，一键下载升级

**RTK**（Bash 输出压缩）：
- 对 Claude Code 的 Bash 命令输出进行无损压缩
- 减少 token 消耗，加速长输出场景
- 跨平台二进制（rtk-bin/），随应用打包分发

### DeepSeek 兼容代理

本地 HTTP 代理（`127.0.0.1:8787`），自动修复 Claude Code ↔ DeepSeek API 的两个兼容性 Bug：

- **Bug A**：`thinking:disabled` 与 `reasoning_effort` 互斥 → 代理自动剥离 `thinking` 字段
- **Bug B**：DeepSeek 返回的 `reasoning_content` 在后续 tool_use 消息中丢失 → 代理缓存并自动注入 `thinking` 块
- 仅当 `ANTHROPIC_BASE_URL` 包含 "deepseek" 时激活
- 支持 `/health`、`/v1/models` 端点

### 定时任务（Scheduler）

设置页 → **定时任务** Tab：

- **Cron 定时任务** CRUD，支持一次性（fireAt）和周期性（cronExpression）调度
- **可视化频率选择器**：每天 / 工作日 / 每周 / 每月 / 自定义 Cron 表达式
- **手动触发**：立即执行一次任务
- **启用/禁用**：暂停/恢复自动调度
- **完成通知**：任务执行完毕后通知当前会话
- 任务持久化到 `~/.claude/scheduled-tasks/`，重启自动恢复

### 自动更新

生产环境自动检查 GitHub Release 更新：

- **electron-updater**：启动 5 秒后自动检查新版本
- **下载进度**：桌面端右下角显示下载进度条
- **安装**：下载完成后提示用户，点击立即重启安装
- **降级**：允许降级到旧版本
- 仅在打包后的生产环境激活（开发模式跳过）

---

## 配置参考

### Gateway 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | Gateway HTTP + WebSocket 端口 |
| `CLAUDE_EXE` | 空（自动检测） | Claude Code 可执行文件路径，未设置时自动多级回退查找 |
| `ANTHROPIC_API_KEY` | 空 | API Key |
| `ANTHROPIC_BASE_URL` | 空 | API 基础 URL（支持 Anthropic 兼容端点） |
| `ANTHROPIC_MODEL` | `deepseek-v4-pro` | 默认模型 |
| `LOG_LEVEL` | `info` | 日志级别: trace / debug / info / warn / error / fatal |
| `LOG_MAX_SIZE` | `10m` | 单日志文件最大体积 (k/m/g) |
| `LOG_RETAIN_DAYS` | `30` | 日志文件保留天数 |
| `LOG_PRETTY` | 空 | 设为 `1` 强制 pino-pretty 美化输出 |
| `LOG_DIR` | `gateway/bridge-logs/` | 自定义日志目录（相对于 Gateway 工作目录） |

### settings.json

路径：`~/.claude/settings.json`

```json
{
  "theme": "dark",
  "language": "chinese",
  "model": "deepseek-v4-pro",
  "claudeExe": "/opt/homebrew/bin/claude",
  "maxTurns": 40,
  "maxContextTokens": 200000,
  "costAlertPercent": 80,
  "fileInjectLimitKB": 200,
  "permissionMode": "default",
  "thinkingLevel": "auto",
  "mcpServers": {},
  "hooks": {},
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx"
  }
}
```

### adapters.json

路径：`~/.claude/adapters.json`

```json
{
  "wechat": {
    "botToken": "your-wechat-bot-token",
    "baseUrl": "https://ilinkai.weixin.qq.com"
  },
  "feishu": {
    "appId": "cli_xxxx",
    "appSecret": "your-secret"
  },
  "dingtalk": {
    "appKey": "dingxxxxxxxx",
    "appSecret": "your-secret"
  }
}
```

---

## 日志系统

### 日志输出

Gateway 日志同时写入两路：

| 目标 | 级别 | 格式 | 分包 |
|------|------|------|------|
| **控制台** | 按 `LOG_LEVEL` | pino-pretty 美化（TTY） / JSON（非TTY） | - |
| **全量文件** | debug+ | 结构化 JSON | 按天 + 按 `LOG_MAX_SIZE` 大小 |
| **错误文件** | error+ | 结构化 JSON | 按天 + 按 `LOG_MAX_SIZE` 大小 |

### 日志文件位置

```
gateway/bridge-logs/
├── all.2026-06-26.1.log      # 全量（debug 及以上）
├── all.2026-06-26.2.log      # 超 10MB 自动切出
├── error.2026-06-26.1.log    # 仅 error 及 fatal
...
```

超过 `LOG_RETAIN_DAYS` 的旧文件自动删除。

### 日志格式

每条日志均为结构化 JSON：

```json
{
  "level": "error",
  "time": 1782474302117,
  "module": "gateway",
  "sessionId": "abc12345",
  "err": {
    "type": "Error",
    "message": "connection reset",
    "stack": "Error: connection reset\n    at ..."
  },
  "msg": "pump 异常"
}
```

### Electron 主进程日志

Electron 主进程在 `userData` 目录生成 `gateway.log`，记录 Gateway 子进程的 stdout/stderr 和重启事件。

---

## Claude Code CLI 路径检测

### 自动检测（按优先级）

Gateway 启动时会按以下顺序自动查找 Claude Code 可执行文件：

1. **显式指定**：`.env` 中的 `CLAUDE_EXE` 或 `settings.json` 中的 `claudeExe`
2. **Windows**：`%LOCALAPPDATA%\Claude-3p\claude-code\{version}\claude.exe`
3. **macOS**：
   - `~/Library/Application Support/Claude-3p/claude-code/{version}/claude`
   - `/opt/homebrew/bin/claude`（Homebrew Apple Silicon）
   - `/usr/local/bin/claude`（Homebrew Intel）
4. **Linux**：`~/.local/share/Claude-3p/claude-code/{version}/claude`
5. **PATH 搜索**：`where claude` (Windows) / `which claude` (Mac/Linux)
6. **npm 全局**：`npm root -g` → `@anthropic-ai/claude-code/`
7. **nvm**：各 Node.js 版本的全局模块目录

### 手动指定

如果自动检测不到（弹窗提示"未找到 Claude Code"），可在弹窗中：

1. 输入 Claude Code 可执行文件的**完整路径**
2. 点击"检测此路径"验证
3. 验证通过后点击"保存并继续"
4. 路径写入 `~/.claude/settings.json` → `claudeExe` 字段

---

## 安全注意事项

- **凭据管理**：`.env` 和 `adapters.json` 包含敏感信息（API Key / Bot Token），已加入 `.gitignore`，**切勿提交到 Git**
- **Electron 安全**：`contextIsolation: true`，`nodeIntegration: false`，外部链接通过 `shell:openExternal` IPC 在系统浏览器打开
- **输入校验**：IM 消息和 API 参数均在 Gateway 入口层校验，防止注入
- **IM 配对**：微信/飞书/钉钉均需要配对码才能绑定，未配对用户消息自动拒绝
- **确认机制**：工具调用需用户确认，5 分钟超时自动拒绝，防止无人值守时误操作
- **日志安全**：日志不打印 API Key、Bot Token 等凭据；完整堆栈仅在错误日志中保留
- **文件回退**：记录点回退直接写磁盘，高危操作有二次确认弹窗

---

## License

MIT License. See [LICENSE](LICENSE) for full text.

---

## 常见问题

### Gateway 无法启动

```bash
# 1. 检查端口是否被占用
netstat -ano | findstr 3456     # Windows
lsof -i :3456                    # Mac/Linux

# 2. 检查 Node.js 版本
node -v  # 需要 >= 20

# 3. 查看日志
cat gateway/bridge-logs/error.$(date +%Y-%m-%d).*.log
```

### Claude Code 无法检测

1. 确保已通过 `npm install -g @anthropic-ai/claude-code` 或官方安装包安装 Claude Code CLI
2. 在命令行执行 `claude` 确认 CLI 可用
3. 若仍检测不到，在弹窗中手动输入路径

### 微信 Bot 无响应

1. 检查 `~/.claude/adapters.json` 中 wechat.botToken 是否存在
2. 检查 `~/.claude/bridge-paired.json` 中是否包含该用户的 `from_user_id`
3. 查看终端日志确认授权码是否已生成，未配对时 Bot 会回复"请先发送配对码"
4. 查看 Gateway 日志 `gateway/bridge-logs/` 搜索 `[wechat]` 或 `poll`

### IM 配对失败 / 找不到授权码

授权码在 Gateway 每次启动时重新生成，流程分两步：先在设置页绑定平台，再在 IM 客户端里激活用户。常见问题：

1. **Bot 没有回复** → 检查平台绑定是否成功（设置页 IM 连接页状态应为"已连接"）
2. **配对码不对** → 把 Bot 提示消息里的那串数字原样发回去即可
3. **终端没显示配对码** → 重启程序，Gateway 启动后前几行日志中搜索 `配对码`
4. **已配对用户重启后无需操作** → 配对信息持久化到 `~/.claude/bridge-paired*.json`，重启不受影响。只有平台解绑后重新绑定才需要新授权码

### 桌面端连接 Gateway 失败

1. 确保 Gateway 已启动（观察终端 `[Gateway] ws://127.0.0.1:3456`）
2. 如在 Electron 内运行，检查 `gateway.log`（`userData` 目录下）
3. 手动重启 Gateway：设置页 → 点按不会……目前需重启 Electron 应用

### Mac 用户打开 DMG 提示"无法验证开发者"

这是未签名的正常行为：右键点击 App → 打开 → 确认一次即可。需要正式签名需配置 Apple Developer Program（见 [GitHub Actions](#4-github-actions-自动构建) 签名部分）。

### 日志占用磁盘过大

已自动按 `LOG_MAX_SIZE`（默认 10MB）和 `LOG_RETAIN_DAYS`（默认 30 天）管理。调整 `.env` 中的这两个值即可，极端场景可设 `LOG_LEVEL=warn` 只记录警告及以上。

---

## 请我喝杯奶茶

如果这个项目帮到了你，可以请我喝杯奶茶 : )

<div align="center">
  <img src="./微信.jpg" width="260" alt="微信收款码" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./支付宝.jpg" width="260" alt="支付宝收款码" />
</div>
