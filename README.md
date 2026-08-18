
# Claude Desktop Bridge

自建 Claude Code 桌面客户端，支持 **Windows / macOS / Linux** 三平台。Vue 3 Electron 桌面壳 + Node.js Gateway + 多 IM 平台适配器。

**核心亮点**：微信 / 飞书 / 钉钉消息**直接注入当前活跃 session**，桌面端实时同步显示 Claude 回复。

喜欢这个项目可以点个star哦~

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
│    │ PushStream  │ │ (子进程隔离)  │ │  (兼容代理 :8787) │     │
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
│(im/wechat.mjs)│  │(im/feishu.mjs)│  │(im/dingtalk.mjs)│
└──────┬──────┘  └───────┬──────┘  └───────┬──────┘
       │                 │                 │
┌──────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│    微信      │  │    飞书      │  │    钉钉      │
└─────────────┘  └──────────────┘  └──────────────┘
```

### 数据流

```
用户消息（桌面 WebSocket / 微信 / 飞书 / 钉钉）
  → 协议适配器 → TaskCommandService（校验、去重、排队、路由）
  → Session PushStream → SDK query()
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
| **自动模型路由** | 统一任务决策按 Light / Balanced / Power 选择模型；固定模式尊重用户选择，高风险缺少 Power 时明确阻断 |
| **多平台桌面端** | Windows / macOS / Linux，Electron 原生窗口 + 自定义标题栏 + 系统托盘 |
| **IM 集成** | 微信 (iLink Bot)、飞书 (企业自建应用)、钉钉 (内部应用 Stream 模式)，支持配对授权、IM 自定义命令远程控制桌面端 |
| **IM 命令引擎** | 9 条跨平台命令（/p /ss /sw /sws /ns /m /stop /i /h），支持微信/飞书/钉钉远程切换项目/会话/镜像开关，送达状态实时反馈 |
| **项目隐藏** | 长期不用的项目可隐藏到折叠区，减少侧栏视觉噪音，持久化到 localStorage |
| **实时对话** | WebSocket 流式推送，text_delta 逐字渲染，tool_use_start 工具进度实时可见，thinking 折叠展开 |
| **确认/授权** | 工具调用需要用户确认，支持桌面端弹窗 + IM 回复双通道，5 分钟超时自动拒绝 |
| **Mirror 同步** | 桌面端 Claude 回复可自动推送到已绑定 IM 用户（开启后 IM 侧无需手动输入） |
| **文件面板** | 工作目录文件树 + 快照基线对比（全部/仅改动），Monaco Editor 行级 Diff + 直接编辑保存 |
| **记录点** | 每轮 AI 操作自动生成 Checkpoint，支持回退文件到任意轮次之前，跨重启持久化 |
| **桌面宠物** | Phaser 4 引擎驱动的 Shimeji 桌面精灵，50+ 角色可选，响应 AI 状态（思考/工具调用/错误） |
| **项目结构缓存** | 13 语言 AST 解析（tree-sitter），自动构建依赖图 + 影响面分析，注入 Claude 上下文避免重复探索 |
| **Workflow 编排** | 内置 7 种实战 Workflow 模板，独立子进程 + 受限 VM context 执行，支持暂停/恢复/Journal 缓存 |
| **配置管理** | Skills / Agents / Hooks / Rules / Memory / MCP 完整 CRUD + 可视化编辑 |
| **压缩模式** | Caveman（Token 压缩 ~75%）+ RTK（Bash 输出压缩），支持 GitHub 自动更新 |
| **DeepSeek 代理** | 内置兼容代理修复 `thinking` 与 `reasoning_content` 兼容性 Bug，自动路由 |
| **OCR 图片理解** | Tesseract.js 对非多模态模型自动 OCR 识别图片文字，作为 Claude 上下文注入 |
| **定时任务** | Cron 定时任务 CRUD，支持一次性/周期性调度，持久化到磁盘 |
| **更新策略** | 仅代码签名且标记为可信的正式构建启用 electron-updater；未签名构建只提供官方 Release 手动更新入口 |
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
│   ├── index.mjs                   # 唯一组合根: 配置、HTTP/WS、启动和 shutdown
│   ├── shared/                     # 日志、内部客户端、文本等基础能力
│   ├── security/                   # 路径、URL、WebSocket 与敏感数据边界
│   ├── providers/                  # Provider registry、协议转换和上游代理
│   ├── sessions/                   # Session runtime、身份、历史、journal 和停止
│   ├── projects/                   # 项目缓存、transcript 定位和跨会话接力
│   ├── tasks/                      # TaskCommand、决策、状态、生命周期和完成门禁
│   ├── agents/                     # Agent 能力、元数据、工具生命周期和 Skill 路由
│   ├── workflows/                  # Workflow 编排、子进程与最终审查
│   ├── im/                         # 微信/飞书/钉钉、IM 命令、进度和通知
│   ├── context/                    # Bridge 规则、上下文档位、压缩和用户偏好
│   ├── tools/                      # 附件、上传和 RTK 支持
│   ├── smoke/                      # 不随应用打包的人工运行验证脚本
│   │   └── manual-gateway-smoke.mjs
│   ├── builtin-skills/caveman/     # 内置 Caveman 压缩技能
│   ├── README.md                   # Gateway 模块职责与依赖方向
│   ├── package.json                # npm 依赖
│   ├── .env                        # 环境变量（不提交 Git）
│   └── .env.example                # 环境变量模板
├── desktop-ui/                     # Vue 3 Electron 桌面 UI
│   ├── electron/                   # Electron 主进程
│   │   ├── main.cjs                # 窗口管理 + gateway 子进程生命周期 + 托盘
│   │   ├── preload.cjs             # IPC 安全桥接 (contextBridge)
│   │   └── updater.cjs             # electron-updater 自动更新
│   ├── scripts/
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

桌面端模型控制栏默认使用“自动”模式。请先在“设置 → 自动任务模型”分别配置 Light、Balanced、Power：Light 用于简单问答和结构探索，Balanced 用于普通实现和审查，Power 用于架构、高风险任务和最终审查。三个档位可以临时指向同一模型，但不会产生实际能力或成本切换。选择“固定”后，当前会话始终使用手工指定模型。

Codex Relay 只能配置 Codex 兼容模型（如 `gpt-*`、`o*`、`codex*`）。不兼容配置会在消息接受前明确报错，不会静默替换成其他模型。自动模式只在回合边界切换模型；执行中的补充消息继承当前模型，避免中断工具调用。

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

- **项目列表**：自动扫描 `~/.claude-desktop-bridge/projects/` 下所有会话项目
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
- 数据持久化到 `~/.claude-desktop-bridge/projects/<name>/bridge-checkpoints/`，重启不丢失

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

Gateway 内置项目结构分析引擎（`gateway/projects/project-cache.mjs`）：

- **13 语言 AST 解析**：JS/TS/Vue/Python/Java/Go/C#/Rust/C/C++/Ruby/PHP/Kotlin/Swift，基于 tree-sitter + 正则回退
- **依赖图构建**：提取 import/export，计算文件间依赖边 + 置信度
- **枢纽节点识别**：按被依赖数排序，标记高影响面文件
- **影响面分析**：每个文件的 `riskOnChange` 级别 + 受影响文件数
- **技术栈检测**：自动识别框架（Vue/React/Angular/Svelte）、构建工具（Vite/Webpack/Maven/Gradle/Cargo）、包管理器、Electron 等
- **增量更新**：首次全量扫描（SHA256），后续仅更新变更文件
- **自动注入**：Claude 首次探索项目时，自动注入 ~8000 字符的结构摘要，避免重复文件扫描
- 缓存文件：`~/.claude-desktop-bridge/projects/<name>/bridge-structure-cache.json`

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

Gateway 每次启动时为每个已连接的平台生成一个 6 位**配对码**。配对码只在桌面端 **设置 → IM 连接 → 当前配对码** 中显示，不写入日志，也不会由 Bot 主动发送给未配对用户。

激活步骤：

```
1. 管理员在桌面端设置页查看目标平台的当前配对码
2. 将配对码通过可信渠道提供给需要接入的用户
3. 用户在微信/飞书/钉钉中将配对码发给 Bot
4. Bot 回复"配对成功" → 激活完成，此后可正常对话
```

> **配对码仅需一次**：每个用户配对后即写入 `~/.claude-desktop-bridge/bridge-paired*.json` 持久化。Gateway 重启后配对码会变，但已配对用户无需重复操作。平台解绑会停止对应连接，并清除该平台凭据、账号缓存、配对白名单、Session 绑定、待处理消息和通知 outbox；重新绑定后需要使用新配对码。

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

同一平台、同一 Session 的 IM 消息按 FIFO 串行执行，默认最多保留 8 条（包含当前执行中的 1 条）；不同平台和不同用户依靠 `turnId + platform + userId` 隔离回合，可同时排队而不会串回复。
收到 `/stop` 时，当前执行会停止，尚未开始的排队消息会被取消并回传提示，避免停止后旧消息继续执行。
```

**IM 自定义命令**（`im-commands.mjs` 引擎，支持微信/飞书/钉钉）：

| 命令 | 别名 | 功能 |
|------|------|------|
| `/p` | `/项目` `/projects` | 列出所有已注册项目及会话数 |
| `/ss <项目>` | `/会话` `/sessions` | 列出指定项目下所有 Session |
| `/sw <项目>` | `/切换` `/switch` | 切换项目，自动恢复最新会话 |
| `/sws <编号>` | `/切换会话` | 切换当前项目下指定 Session |
| `/ns [项目]` | `/新会话` | 在指定/当前项目下新建 Session |
| `/m [平台] [on/off]` | `/镜像` `/mirror` | 查看/设置 IM 平台镜像同步开关 |
| `/stop` | `/停止` | 停止当前桌面端 Agent 任务 |
| `/i` | `/信息` `/info` | 查看当前项目/Session/桌面在线状态 |
| `/h` | `/帮助` `/help` | 列出所有可用命令 |

命令与桌面端实时联动，送达失败会明确反馈"桌面端离线"提示。

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

**Workflow DSL**：完整的 JavaScript DSL（agent / parallel / pipeline / staged / phase / log / budget / args），在独立子进程的受限 VM context 中执行。脚本不能直接访问 `process`、`require`、`Buffer`、动态 `import`、字符串代码生成或 WebAssembly；agent 入参与结果通过 JSON 边界复制。支持 Journal 内容哈希缓存（Resume 断点续跑）、Schema 验证 + 重试、Git Worktree 隔离环境和预算硬限制。

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
| **IM 连接** | 微信扫码绑定 / 飞书凭据 / 钉钉凭据，连接状态、配对码、用户与 Session 绑定、通知队列管理、平台解绑 |
| **Workflow** | DAG 设计器 + 脚本编辑器 + 全局开关，支持执行/暂停/恢复/状态监控 |
| **定时任务** | Cron 定时任务 CRUD，可视化频率选择（每天/工作日/每周/每月/自定义），手动触发 |
| **开源** | Caveman 压缩配置 / RTK 压缩配置 / 桌面宠物选择 |

Bridge 只使用仓库内的 `gateway/context/BRIDGE_RULES.md` 作为跨项目长期规则来源，不读取或合并用户机器上的
Claude/Codex 全局规则。操作 Bridge 仓库根目录或其子目录时，Gateway 额外注入
`gateway/context/BRIDGE_PROJECT_RULES.md` 中的 Electron、Gateway 和会话生命周期约束；外部项目不会收到这些
仓库专属内容。完整执行会话只启用 `CLAUDE_CONFIG_DIR` 指向的 Bridge 私有 `user` settings，
不读取用户机器上的 Claude/Codex 配置，也不加载目标项目目录的 `CLAUDE.md` 或 `AGENTS.md`；轻量和只读会话继续关闭所有 setting sources。
供应商、API Key、MCP、Skills 与 Agents 由 Gateway 从 Bridge 私有目录按需读取并显式传入；
简单问答不加载这些扩展，执行型任务才升级为完整上下文。明确的数字孪生集成任务会按需准备并加载 Bridge
内置的 `digital-twin-cad` Skill；普通 CAD、普通前端和仅 Viewer 预览不触发该 Skill，已有同名用户 Skill
不会被覆盖。

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
- 在线更新只接受 Release 元数据中格式为 `sha256:<64位十六进制>` 的 digest；缺失或校验不一致会拒绝安装

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
- 任务持久化到 `~/.claude-desktop-bridge/bridge-scheduled-tasks.json`，重启自动恢复

### IM 通知可靠投递

- 会话完成、错误和权限确认结果会按当前回合记录的 `platform + userId + turnId` 返回原平台、原用户
- 同一平台允许多个用户绑定到当前 Session；parallel agent 同时产生的多个确认请求按用户 FIFO 保存，网络提交失败时可继续重试
- 平台事件在 ACK 前同步写入加密 inbox；落盘失败时不确认事件，由微信游标或飞书/钉钉 SDK 重推
- 直接发送失败时写入加密 notification outbox，每 30 秒扫描一次，并按 5 秒起步、最长 15 分钟的指数退避重试
- inbox/outbox 按平台拆分为 `bridge-im-inbox.<platform>.json` 和 `bridge-notification-outbox.<platform>.json`；首次启动会从旧共享文件迁移本平台记录
- 单条通知最多尝试 8 次，超过上限转为“永久失败”，避免无限占用队列
- inbox/outbox 达容量上限时拒绝新记录并显式报错，不会静默淘汰仍在处理的消息或待发送通知
- 设置页 **IM 连接** 可查看各平台待发送、重试中和永久失败数量，并可“立即重试”或“清除永久失败”
- 平台解绑会清空该平台尚未发送的通知；这是不可恢复操作，设置页会二次确认

### 自动更新

代码签名且 `bridgeUpdateTrust.signed=true` 的正式构建可自动检查 GitHub Release 更新：

- **electron-updater**：启动 5 秒后自动检查新版本
- **下载进度**：桌面端右下角显示下载进度条
- **安装**：下载完成后提示用户，点击立即重启安装
- **降级保护**：默认拒绝安装低于当前版本的发布包
- 开发模式和未签名构建均禁用应用内下载，设置页只提供“打开官方 Release”

> SHA-512 只校验下载完整性，不能证明发布者身份。发布前必须配置 Windows/macOS 代码签名，并用签名安装包完成真实升级验收。源码不提供绕过未签名更新限制的生产开关。

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
| `BRIDGE_ALLOW_LOCAL_PROVIDER` | `0` | 允许探测任意本机/私网 Provider；仅开发环境开启。内置 Ollama `localhost:11434/v1` 已单独白名单 |
| `BRIDGE_ALLOW_TOKEN_ENDPOINT` | `0` | 开放 `/api/bridge-token` 给浏览器开发模式；生产环境保持关闭 |
| `BRIDGE_SECURE_PAYLOAD_KEY` | 空 | 独立启动 Gateway 时使用的 32 字节主密钥，支持 64 位 hex 或 base64；读取已有加密配置时必须与创建它的密钥一致 |
| `BRIDGE_SCHEDULED_MAX_CONCURRENT` | `2` | 定时任务全局并发上限，范围 1-8 |
| `BRIDGE_SCHEDULED_MAX_DURATION_MS` | `1800000` | 单个定时任务最长运行时间，最少 60 秒 |
| `BRIDGE_OCR_MAX_CONCURRENT` | `1` | OCR 并发上限，范围 1-4 |
| `BRIDGE_UPLOAD_TTL_MS` | `86400000` | 临时上传文件保留时间，范围 5 分钟-30 天；过期文件自动清理 |
| `BRIDGE_HOME` | `~/.claude-desktop-bridge` | Bridge 私有配置、会话和 IM 数据根目录；必须是绝对路径 |
| `LOG_LEVEL` | `info` | 日志级别: trace / debug / info / warn / error / fatal |
| `LOG_MAX_SIZE` | `10m` | 单日志文件最大体积 (k/m/g) |
| `LOG_RETAIN_DAYS` | `30` | 日志文件保留天数 |
| `LOG_PRETTY` | 空 | 设为 `1` 强制 pino-pretty 美化输出 |
| `LOG_DIR` | `gateway/bridge-logs/` | 自定义日志目录（相对于 Gateway 工作目录） |

### settings.json

路径：`~/.claude-desktop-bridge/settings.json`

```json
{
  "theme": "dark",
  "language": "chinese",
  "claudeExe": "/opt/homebrew/bin/claude",
  "maxTurns": 40,
  "maxContextTokens": 200000,
  "costAlertPercent": 80,
  "fileInjectLimitKB": 200,
  "permissionMode": "default",
  "thinkingLevel": "auto",
  "mcpServers": {},
  "hooks": {}
}
```

供应商地址、模型和 API Key 独立保存在同目录的 `bridge-provider.json`，不与 Claude Code、Codex 或 CCSwitch 配置合并。

### adapters.json

路径：`~/.claude-desktop-bridge/adapters.json`

该文件由设置页维护，当前格式是 AES-256-GCM 加密 envelope，不应手工填写平台凭据：

```json
{
  "version": 2,
  "encrypted": true,
  "payload": "base64url-encoded-aes-256-gcm-payload"
}
```

Electron 启动时优先使用系统 `safeStorage` 保护主密钥，并通过 IPC 注入 Gateway。若操作系统安全存储不可用，则退回权限受限的 `~/.claude-desktop-bridge/bridge-store-key`。独立运行 `node gateway/index.mjs` 时，如需读取 Electron 已创建的加密数据，必须显式提供同一 `BRIDGE_SECURE_PAYLOAD_KEY`；缺少密钥会安全失败，不会创建新密钥覆盖旧数据。旧版明文配置会在密钥可用时自动迁移。

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
4. 路径写入 `~/.claude-desktop-bridge/settings.json` → `claudeExe` 字段

---

## 安全注意事项

- **凭据管理**：`.env`、加密后的 `adapters.json`、`bridge-store-key*` 和 inbox/outbox 都属于敏感数据，已加入 `.gitignore`，**切勿提交到 Git**
- **本地加密边界**：AES-256-GCM 防止配置文件被直接读取或篡改，但不能防御已控制当前用户进程或系统账户的攻击者
- **Electron 安全**：`contextIsolation: true`，`nodeIntegration: false`，外部链接通过 `shell:openExternal` IPC 在系统浏览器打开
- **输入校验**：IM 消息和 API 参数均在 Gateway 入口层校验，防止注入
- **IM 配对**：微信/飞书/钉钉均需要配对码才能绑定，未配对用户消息自动拒绝
- **确认机制**：工具调用需用户确认，5 分钟超时自动拒绝，防止无人值守时误操作
- **日志安全**：日志不打印 API Key、Bot Token 等凭据；完整堆栈仅在错误日志中保留
- **文件回退**：记录点回退直接写磁盘，高危操作有二次确认弹窗
- **Workflow 边界**：Workflow 只允许在不继承 Provider 凭据的独立子进程中运行，并使用受限 VM context 禁止常见逃逸入口。它面向可信本地脚本，不是容器或 OS 级不可信代码沙箱；不要运行来源不明的 Workflow

---

## AICodeMirror Codex Relay

The settings page includes an `AICodeMirror Codex` provider for the Codex endpoint:

```text
https://api.claudecode.net.cn/api/codex/backend-api/codex
```

This endpoint is not an Anthropic Messages endpoint. Gateway starts a local adapter, keeps the relay key in the Gateway process, converts Claude Code `/v1/messages` requests to Codex `/responses`, and converts JSON/SSE responses back to Anthropic format. Claude Code sub-processes receive only the local `PROXY_MANAGED` token.

Configuration:

1. Open Settings -> General -> AICodeMirror Codex.
2. Enter the AICodeMirror API key in API Key.
3. Select a supported Codex model, such as `gpt-5.6-sol`.
4. Click Test Connection, save settings, and restart the desktop app so Gateway reloads the provider.

The adapter maps Claude/agent model aliases to the selected Codex model and preserves the existing tool permission, Session, and IM mirror flows. A real API key and network access are required for end-to-end validation.

### 按需上下文

新建且未恢复历史的 Session 默认使用轻量上下文：不加载 Skills、Agents、MCP、项目设置或 Claude Code 工具，适用于问候、模型身份和短概念解释。出现代码块、文件/Agent 引用、修改、调试、审查、执行或实时信息等信号时，Gateway 会在消息入队前把 Session 单向升级为完整 Claude Code 上下文；恢复历史、Workflow、定时任务和子 Agent 始终使用完整上下文。同一 Session 升级后不会自动降级，避免历史和工具状态反复重建。

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

1. 检查 `~/.claude-desktop-bridge/adapters.json` 中 wechat.botToken 是否存在
2. 检查 `~/.claude-desktop-bridge/bridge-paired.json` 中是否包含该用户的 `from_user_id`
3. 在桌面端 **设置 → IM 连接** 确认微信状态为运行中，并查看当前配对码
4. 查看 Gateway 日志 `gateway/bridge-logs/` 搜索 `[wechat]` 或 `poll`

### IM 配对失败 / 找不到授权码

授权码在 Gateway 每次启动时重新生成，流程分两步：先在设置页绑定平台，再在 IM 客户端里激活用户。常见问题：

1. **Bot 没有回复** → 检查平台绑定是否成功（设置页 IM 连接页状态应为“运行中”或“已连接”）
2. **找不到配对码** → 在桌面端 **设置 → IM 连接** 查看；日志和 Bot 回复不会显示配对码
3. **配对码不对** → 确认使用的是同一平台当前显示的 6 位配对码；适配器重启后旧码会失效
4. **连续输错被锁定** → 等待设置页提示的冷却时间后再试，避免继续触发暴力破解保护
5. **已配对用户重启后无需操作** → 配对信息持久化到 `~/.claude-desktop-bridge/bridge-paired*.json`；平台解绑后白名单会被清除

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
  <img src="./desktop-ui/public/pay/微信.jpg" width="260" alt="微信收款码" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./desktop-ui/public/pay/支付宝.jpg" width="260" alt="支付宝收款码" />
</div>
