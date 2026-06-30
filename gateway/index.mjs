/**
 * Claude Desktop Bridge — Gateway (SDK 0.3.179)
 * https://github.com/kankancuige/claude-desktop-bridge
 * query() + PushStream — MCP/工具直接透传，兼容 DeepSeek。
 */

import {createServer} from 'node:http'
import {readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmdirSync, openSync, readSync, closeSync} from 'node:fs'
import {execSync, spawn} from 'node:child_process'
import {homedir} from 'node:os'
import {join, dirname, basename, relative, resolve, extname as pathExtname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {WebSocketServer} from 'ws'
import {config as loadEnv} from 'dotenv'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {createLogger, logHttpRequest} from './logger.mjs'
import {startWeChatAdapter} from './wechat.mjs'
import {startFeishuAdapter} from './feishu.mjs'
import {startDingTalkAdapter} from './dingtalk.mjs'
import {
    setDeps,
    listWorkflows,
    getWorkflow,
    saveWorkflow,
    deleteWorkflow as deleteWorkflowFile,
    runWorkflow as runWfScript,
    parseMeta,
    getRunState,
    presetRunState,
    stopWorkflow,
    resumeWorkflow
} from './workflow-runner.mjs'
import {
    buildProjectCache,
    loadProjectCache,
    saveProjectCache,
    updateProjectCache,
    isExplorationAttempt,
    buildCacheInjectionText,
    cacheFilePath
} from './project-cache.mjs'
import {startDeepSeekProxy, getProxyUrl, stopDeepSeekProxy, isProxyRunning} from './deepseek-proxy.mjs'
import cron from 'node-cron'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({path: join(__dirname, '.env'), override: true})

// ── 版本号（读取本 package.json 的 version 字段）──
const PKG_VERSION = (() => {
    try { return JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version || '0.0.0' } catch { return '0.0.0' }
})()

const log = createLogger('gateway')

const PORT = parseInt(process.env.PORT || '3456', 10)
// npm 全局包解析: 从 shim 所在目录找到 node_modules/@anthropic-ai/claude-code 下的可用入口
// 旧版 npm 包提供 cli.js，新版提供 bin/claude.exe (native binary)，二者选其一
function resolveFromPkgDir(pkgDir) {
    if (!existsSync(pkgDir)) return null
    for (const rel of ['bin/claude.exe', 'cli.js']) {
        const p = join(pkgDir, rel)
        if (existsSync(p)) return p
    }
    return null
}

let _exe = null

function getClaudeExe() {
    if (_exe) return _exe

    // ── 1. 显式指定 ──
    if (process.env.CLAUDE_EXE) return (_exe = process.env.CLAUDE_EXE)
    const cliS = loadCliSettings()
    if (cliS.claudeExe && existsSync(cliS.claudeExe)) return (_exe = cliS.claudeExe)

    // ── 2. 已知原生安装路径 ──
    const base = join(homedir(), 'AppData', 'Local', 'Claude-3p', 'claude-code')
    if (existsSync(base)) {
        const vers = readdirSync(base).filter(d => statSync(join(base, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(base, v, 'claude.exe')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    // macOS: Claude-3p 第三方安装 / Claude 官方 App
    const macBase = join(homedir(), 'Library', 'Application Support', 'Claude-3p', 'claude-code')
    if (existsSync(macBase)) {
        const vers = readdirSync(macBase).filter(d => statSync(join(macBase, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(macBase, v, 'claude')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    // Linux: ~/.local/share/Claude-3p/claude-code/
    const linuxBase = join(homedir(), '.local', 'share', 'Claude-3p', 'claude-code')
    if (existsSync(linuxBase)) {
        const vers = readdirSync(linuxBase).filter(d => statSync(join(linuxBase, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(linuxBase, v, 'claude')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    for (const p of [
        join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
        // macOS Homebrew
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        // macOS 官方 Claude App 内嵌 CLI
        join(homedir(), 'Library', 'Application Support', 'Claude', 'claude'),
        // Linux 常见路径
        join(homedir(), '.local', 'bin', 'claude'),
        '/usr/bin/claude',
    ]) {
        if (existsSync(p)) return (_exe = p)
    }

    // ── 3. PATH 查找 ──
    // .exe / .js / .mjs → 直接使用
    // .cmd / .bat / 无扩展名 → npm 全局安装 shim，从同目录 node_modules 解析实际包
    try {
        const cmd = process.platform === 'win32' ? 'where claude' : 'which claude'
        const raw = execSync(cmd, {encoding: 'utf8', timeout: 3000}).trim().split('\n')[0].trim()
        if (raw && existsSync(raw)) {
            if (raw.endsWith('.exe') || raw.endsWith('.js') || raw.endsWith('.mjs')) return (_exe = raw)
            // shim: 同目录下 node_modules/@anthropic-ai/claude-code/
            const r = resolveFromPkgDir(join(dirname(raw), 'node_modules', '@anthropic-ai', 'claude-code'))
            if (r) return (_exe = r)
        }
    } catch {
    }

    // ── 4. npm root -g (以 npm 权威答案兜底) ──
    try {
        const root = execSync('npm root -g', {encoding: 'utf8', timeout: 5000}).trim()
        if (root) {
            const r = resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
            if (r) return (_exe = r)
        }
    } catch {
    }

    // ── 5. nvm 版本目录 ──
    const nvmHomes = [
        process.env.NVM_HOME, process.env.NVM_DIR,
        join(homedir(), 'AppData', 'Roaming', 'nvm'),
        join(homedir(), '.nvm'),
        join(homedir(), '.nvm', 'versions', 'node'),
    ].filter(Boolean)
    for (const nvmHome of nvmHomes) {
        if (!existsSync(nvmHome)) continue
        try {
            const vers = readdirSync(nvmHome)
                .filter(d => /^v\d/.test(d) && statSync(join(nvmHome, d)).isDirectory())
                .sort().reverse()
            for (const v of vers) {
                for (const sub of ['node_modules', 'lib/node_modules']) {
                    const r = resolveFromPkgDir(join(nvmHome, v, sub, '@anthropic-ai', 'claude-code'))
                    if (r) return (_exe = r)
                }
            }
        } catch {
        }
    }

    // ── 6. 常见全局路径兜底 ──
    const npmGlobalRoots = [
        join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
        process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, 'node_modules') : null,
        process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : null,
        process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node_modules') : null,
        'C:\\Program Files\\nodejs\\node_modules',
        process.env.PREFIX ? join(process.env.PREFIX, 'node_modules') : null,
    ].filter(Boolean)
    for (const root of npmGlobalRoots) {
        const r = resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
        if (r) return (_exe = r)
    }

    return (_exe = null)  // 找不到 → 前端弹窗提示
}

const MODEL = process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro'

// 模型名直传，不做映射。SDK 0.1.77 dJ() 对非别名模型名原样放行，DeepSeek API 也直接接受。
function mapModel(name) {
    return name || MODEL
}

const CLAUDE_HOME = join(homedir(), '.claude')

// ---- 动态模型/命令缓存 ----
// supportedModels()/supportedCommands() 是控制请求，需活跃 query；冷启动设置页读这里的缓存
// SIDE_EFFECT: mutates dynamicCache（内存）+ 落盘 bridge-dynamic-cache.json
const DYNAMIC_CACHE_FILE = join(CLAUDE_HOME, 'bridge-dynamic-cache.json')
const dynamicCache = {models: null, commands: null, agentNames: null, updatedAt: 0}
// 启动时从磁盘恢复缓存（失败忽略，保持空缓存）
try {
    const c = readJSON(DYNAMIC_CACHE_FILE);
    if (c) Object.assign(dynamicCache, c)
} catch {
}

function persistDynamicCache() {
    try {
        writeFileSync(DYNAMIC_CACHE_FILE, JSON.stringify(dynamicCache), 'utf8')
    } catch {
    }
}

// 取一个「已初始化」的活跃 query，用于发控制请求；没有则返回 null
// 功能说明: 获取一个"已初始化"的活跃 query 实例，用于发控制请求（supportedModels/Commands 等）
// 实现方式: 优先返回 focusedSessionId 的 query，其次遍历所有 sessions 找有 query 的
//   返回 null 表示当前没有可用的 query，调用方应回退到缓存
// 关键数据流: focusedSessionId → sessions[].query 查找 → query 对象 或 null
function getLiveQuery() {
    // 优先 focused，其次任意有 query 的 session
    if (focusedSessionId) {
        const s = sessions.get(focusedSessionId);
        if (s?.query) return s.query
    }
    for (const s of sessions.values()) {
        if (s.query) return s.query
    }
    return null
}

// 控制请求加超时保护：query 未就绪时 supportedModels/Commands 可能 hang 住 HTTP 响应
// 功能说明: 给 Promise 加超时保护，避免控制请求（supportedModels/Commands）在 query 未就绪时 hang 住 HTTP 响应
// 实现方式: Promise.race(原始, setTimeout(reject)) → 超时 ms 后 reject 或原始完成则正常 resolve
// 关键数据流: promise + timeout → race → resolve 或 reject('timeout')
function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

// ---- 文件快照 Diff：常量 ----
// SIDE_EFFECT: 无（纯常量）
const SNAP_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out',
    '.cache', '.vscode', '.idea', 'coverage', '.nuxt', '.output', '.turbo', 'target',
    '__pycache__', '.venv', 'venv'])
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
    '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
    '.otf', '.mp3', '.mp4', '.mov', '.wav', '.webm', '.class', '.jar', '.pyc', '.wasm', '.node', '.bin'])
const MAX_SNAP_FILE_BYTES = 512 * 1024  // 单文件超过此大小不存内容、不做 diff
const MAX_SNAP_FILES = 5000             // 文件总数上限，超过进入 degraded 模式

// ---- PushStream for multi-turn ----
// ── PushStream 异步消息队列 ──
// 功能说明: 实现一个可等待的异步消息队列，用于将用户消息推入 SDK query 的 prompt 流
//   支持多轮对话：用户发消息 → push() 推入队列 → SDK query 通过 asyncIterator 消费 → 开始新轮次
// 实现方式: 内部维护 _buf 数组和 _resolve Promise 回调，push() 有等待者则直接 resolve，否则暂存；close() 终止迭代
//   Symbol.asyncIterator 将队列暴露为 async iterable，SDK query 的 prompt 参数接收它作为流式输入
// 关键数据流: pushStream.push(msg) → _buf/_resolve → asyncIterator.next() → SDK query prompt 流 → 消费消息
class PushStream {
    constructor() {
        this._buf = [];
        this._resolve = null;
        this._closed = false
    }

    // 功能说明: 入队一条消息；如果有消费者在 await next() 则立即交付，否则暂存到 _buf
    // 实现方式: O(1) —— 检查 _resolve 是否存在（有等待者）→ 直接 resolve；否则 push 到队列
    // 关键数据流: msg → (有等待者? resolve({value:msg}) : _buf.push(msg))
    push(msg) {
        if (this._closed) return
        if (this._resolve) {
            this._resolve({value: msg, done: false});
            this._resolve = null
        } else {
            this._buf.push(msg)
        }
    }

    close() {
        this._closed = true;
        if (this._resolve) {
            this._resolve({value: undefined, done: true});
            this._resolve = null
        }
    }

    [Symbol.asyncIterator]() {
        const self = this
        return {
            next() {
                return new Promise(r => {
                    if (self._buf.length) r({value: self._buf.shift(), done: false})
                    else if (self._closed) r({value: undefined, done: true})
                    else self._resolve = r
                })
            }
        }
    }
}

// ---- Session pool ----
const sessions = new Map()
let focusedSessionId = null
const pendingQRCodes = new Map()

// ---- 确认请求注册表（权限/方案选择双通道）----
let reqCounter = 0
const confirmHooks = []   // [{platform, onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser}] —— 各 IM 适配器注册的钩子

// ── WebSocket 广播 ──
// 功能说明: 向指定 session 的所有已连接 WebSocket 客户端广播一条 JSON 消息
//   这是桌面端实时更新的核心通道：所有 SDK 输出/确认请求都通过此函数推给 UI
// 实现方式: 从 sessions Map 取 session → 遍历 s.clients Set → 对 readyState===1（OPEN）的客户端 send JSON 字符串
//   JSON.stringify 只执行一次（提前序列化），避免重复序列化
// 关键数据流: msg 对象 → JSON.stringify → forEach ws.send(raw) → 桌面端 WebSocket onmessage
function broadcast(sid, msg) {
    const s = sessions.get(sid);
    if (s) {
        const raw = JSON.stringify(msg);
        for (const w of s.clients) {
            if (w.readyState === 1) w.send(raw)
        }
    }
}

// 注入依赖到 workflow-runner（供 VM 沙箱内 agent() 调用）
setDeps({query, makeQueryOptions, loadCliSettings, PushStream, broadcast, sessions})

// 收口：任一通道响应或超时都走这里，幂等（已 settled 则忽略）
// ── 确认请求收口（settlePending）──
// 功能说明: 统一收口所有权限/方案选择确认请求的完成，幂等（已 settled 忽略），任一通道响应即生效
//   跨通道（desktop/wechat/feishu/dingtalk）共享同一确认机制：谁先响应谁赢
// 实现方式:
//   1. 从 sessions 取 pending Map，检查 entry 存在且未 settled
//   2. 标记 settled=true，清除超时定时器，从 Map 删除 entry
//   3. 调用 entry.resolve(result) 释放 SDK 的 canUseTool Promise
//   4. broadcast 通知 desktop 弹框关闭 + 遍历 confirmHooks 通知所有适配器清除挂起
// 关键数据流: 任一通道响应(permission_response/choice_response/wechat api)
//   → settlePending() → entry.resolve(decision) → SDK 继续执行/拒绝
//   → broadcast(confirmation_resolved) → 桌面弹框关闭
//   → confirmHooks[].onConfirmResolved() → 各适配器清除挂起状态
function settlePending(sessionId, requestId, result, wonBy) {
    const s = sessions.get(sessionId);
    if (!s) return
    const entry = s.pending?.get(requestId);
    if (!entry || entry.settled) return
    entry.settled = true
    if (entry.timeout) clearTimeout(entry.timeout)
    s.pending.delete(requestId)
    try {
        entry.resolve(result)
    } catch {
    }
    // 通知 desktop 弹框关闭 + 所有适配器清除挂起
    broadcast(sessionId, {type: 'confirmation_resolved', requestId, wonBy})
    for (const hook of confirmHooks) {
        try {
            hook.onConfirmResolved?.(sessionId, requestId)
        } catch {
        }
    }
}

// AskUserQuestion 选项标签查找
// 功能说明: 从 AskUserQuestion 的选项中提取指定索引的 label 文本
// 实现方式: 安全索引访问（entry.questions?.[qi]?.options?.[oi]?.label），找不到回退到 String(oi)
// 关键数据流: entry → questions[qi] → options[oi] → .label 或 String(oi)
function labelForChoice(entry, qi, oi) {
    return entry.questions?.[qi]?.options?.[oi]?.label ?? String(oi)
}

// canUseTool 回调工厂：每个 session 一份，挂起 Promise 直到任一通道响应
// ── canUseTool 回调工厂 ──
// 功能说明: 为每个 session 创建一个 SDK canUseTool 回调，当 Claude 要执行工具/询问用户时挂起 Promise
//   等待任意通道（desktop/wechat/feishu/dingtalk）返回确认结果
// 实现方式:
//   1. 生成唯一 requestId，区分 permission（工具权限）和 choice（AskUserQuestion）两种类型
//   2. 创建 entry 对象（含 resolve/settled/timeout），放入 s.pending Map
//   3. 设 5 分钟超时 → 拒绝并中断；监听 abort signal → 取消挂起
//   4. broadcast 给 desktop + 遍历 confirmHooks 推给 mirror 已开启的 IM 适配器
// 关键数据流: SDK tool 调用 → canUseTool(toolName, input) → create entry + push pending
//   → broadcast(desktop) + confirmHooks(IM) → 用户响应 → settlePending() → resolve(decision) → SDK 继续
function makeCanUseTool(sessionId) {
    return (toolName, input, {signal, toolUseID}) => new Promise((resolve) => {
        const s = sessions.get(sessionId)
        if (!s) {
            resolve({behavior: 'deny', message: 'session 已关闭', interrupt: true});
            return
        }
        const requestId = `req-${++reqCounter}`

        // Task / Workflow 工具 → 自动允许（SDK 内部处理子 agent 创建，hooks 负责广播状态）
        if (toolName === 'Task' || toolName === 'Workflow') {
            const st = input.name || input.subagent_type || 'unknown'
            const desc = input.description || ''
            log.info({
                sessionId: sessionId?.slice(0, 8),
                toolName: st,
                description: desc || 'no desc'
            }, `${toolName} tool`)
            broadcast(sessionId, {
                type: toolName === 'Workflow' ? 'workflow_started' : 'subagent_spawning',
                requestId,
                name: input.name || st,
                agentType: st,
                description: desc,
                ts: Date.now(),
                phases: input.phases || [],
                workflowId: 'wf-' + (input.name || st) + '-' + Date.now().toString(36),
            })
            resolve({behavior: 'allow', updatedInput: input})
            return
        }

        const isChoice = toolName === 'AskUserQuestion'
        const entry = {
            id: requestId, sessionId, type: isChoice ? 'choice' : 'permission',
            toolName, input, questions: isChoice ? (input?.questions || []) : undefined,
            resolve, settled: false, timeout: null,
        }
        // 5 分钟超时 → 拒绝并中断
        entry.timeout = setTimeout(() => {
            settlePending(sessionId, requestId, {behavior: 'deny', message: '确认超时', interrupt: true}, 'timeout')
        }, 5 * 60 * 1000)
        // query 被中止（stop_generation / abort）→ 拒绝并中断
        if (signal) signal.addEventListener('abort', () => {
            settlePending(sessionId, requestId, {behavior: 'deny', message: '已取消', interrupt: true}, 'abort')
        }, {once: true})
        s.pending.set(requestId, entry)
        log.info({sessionId: sessionId?.slice(0, 8), requestId, type: entry.type, toolName}, '确认请求')
        // 推 desktop
        broadcast(sessionId, isChoice
            ? {type: 'choice_request', requestId, toolName, questions: entry.questions}
            : {type: 'permission_request', requestId, toolName, input})
        // 权限确认推给 mirror 已开启的适配器（mirror 开启时由 hook 下发；关闭时适配器走 WS 内联路径）
        for (const hook of confirmHooks) {
            if (!s.mirrors[hook.platform]) continue
            try {
                hook.onConfirmRequest?.({
                    sessionId,
                    requestId,
                    type: entry.type,
                    toolName,
                    input,
                    questions: entry.questions
                })
            } catch {
            }
        }
    })
}

// 决策映射为 SDK PermissionResult
// 功能说明: 将用户的确认决策映射为 SDK PermissionResult 格式
// 实现方式: choice 类型解析 optionIndex/questionIndex 获取标签文本，引导喂回模型但不中断（interrupt:false）
//   permission 类型: allow → 返回 updatedInput；否则 deny + interrupt:false
// 关键数据流: 用户决策(allow/deny/选项索引) → PermissionResult {behavior, message, interrupt, updatedInput?}
function decisionToResult(entry, decision, optionIndex, questionIndex) {
    if (entry.type === 'choice') {
        const label = labelForChoice(entry, questionIndex ?? 0, optionIndex ?? 0)
        // 把用户选择作为引导喂回模型，不中断（spike 后可能改为 allow+updatedInput）
        return {behavior: 'deny', message: `用户选择了: ${label}`, interrupt: false}
    }
    if (decision === 'allow') return {behavior: 'allow', updatedInput: entry.input}
    return {behavior: 'deny', message: '用户拒绝了该操作', interrupt: false}
}

// ---- Helpers ----
// 功能说明: 解析 Markdown 文件中的 YAML frontmatter（---...---），分离元数据和正文
// 实现方式: 正则 ^---\r?\n([\s\S]*?)\r?\n--- 提取 frontmatter 块，逐行 : 分割为键值对
// 关键数据流: markdown 文本 → 正则匹配 → {frontmatter: {key:val}, body: 正文}
function parseFrontmatter(c) {
    const m = c.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {frontmatter: {}, body: c};
    const fm = {};
    for (const l of m[1].split('\n')) {
        const col = l.indexOf(':');
        if (col > 0) fm[l.slice(0, col).trim()] = l.slice(col + 1).trim()
    }
    ;
    return {frontmatter: fm, body: c.slice(m[0].length).trim()}
}

// 功能说明: 安全读取 JSON 文件，解析失败返回 null（不抛异常）
// 实现方式: try { JSON.parse(readFileSync) } catch { null }
// 关键数据流: 文件路径 → readFileSync → JSON.parse → 对象 或 null
function readJSON(p) {
    try {
        return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
        return null
    }
}

// 功能说明: 写入 JSON 文件（格式化缩进 2 空格）
// 实现方式: JSON.stringify(d, null, 2) + writeFileSync
// 关键数据流: 对象 → JSON.stringify → writeFileSync(p)
function writeJSON(p, d) {
    writeFileSync(p, JSON.stringify(d, null, 2), 'utf8')
}

// 功能说明: 写入前备份原文件到 .bak 后缀
// 实现方式: 先 readFileSync 再 writeFileSync(p + '.bak')
// 关键数据流: 源文件 → 复制到 .bak
function backupFile(p) {
    try {
        writeFileSync(p + '.bak', readFileSync(p))
    } catch {
    }
}

// 功能说明: 加载 ~/.claude/settings.json 配置文件，不存在则返回 {}
// 实现方式: readJSON 封装 JSON.parse + readFileSync + try/catch，失败返回 null → || {} 兜底
// 关键数据流: ~/.claude/settings.json → readFileSync → JSON.parse → 配置对象 或 {}
function loadCliSettings() {
    return readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
}

// workflow 全局开关
const WF_CONFIG_FILE = join(CLAUDE_HOME, 'bridge-workflow.json')

function loadWfConfig() {
    return readJSON(WF_CONFIG_FILE) || {enabled: false}
}

function saveWfConfig(c) {
    writeJSON(WF_CONFIG_FILE, c)
}

// ── Caveman skill 内置安装 + 配置 ──
// 功能说明: 确保 ~/.claude/skills/caveman/SKILL.md 存在，不存在则从内置模板写入
//   配置存 settings.json → caveman: {enabled, level}，默认开启 full 级别
// SIDE_EFFECT: 写入 ~/.claude/skills/caveman/SKILL.md（首次）
const CAVEMAN_SKILL_DIR = join(CLAUDE_HOME, 'skills', 'caveman')
const CAVEMAN_SKILL_FILE = join(CAVEMAN_SKILL_DIR, 'SKILL.md')
const CAVEMAN_VERSION_FILE = join(CAVEMAN_SKILL_DIR, 'VERSION')
const CAVEMAN_DEFAULT_CONFIG = {enabled: true, level: 'full'}
const CAVEMAN_VALID_LEVELS = ['lite', 'full', 'ultra', 'wenyan']

function ensureCavemanSkill() {
    try {
        if (!existsSync(CAVEMAN_SKILL_FILE)) {
            mkdirSync(CAVEMAN_SKILL_DIR, {recursive: true})
            // 内置原版 Caveman SKILL.md（MIT）——从 gateway/builtin-skills/caveman/SKILL.md 读取
            const builtinPath = join(__dirname, 'builtin-skills', 'caveman', 'SKILL.md')
            if (existsSync(builtinPath)) {
                writeFileSync(CAVEMAN_SKILL_FILE, readFileSync(builtinPath, 'utf8'), 'utf8')
            }
            log.info('caveman skill 已安装')
        }
        // 确保 VERSION 文件存在
        if (!existsSync(CAVEMAN_VERSION_FILE)) {
            writeFileSync(CAVEMAN_VERSION_FILE, 'builtin', 'utf8')
        }
    } catch (e) {
        log.warn({err: e}, 'caveman skill 安装失败')
    }
}

// ── 语义化版本号提取（从 v0.43.0 / dev-0.43.0-rc.292 等标签中提取 [major, minor, patch]）──
function extractSemver(tag) {
    const m = tag.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}
function compareSemver(a, b) {
    if (!a && !b) return 0
    if (!a) return -1  // 无法解析视为旧版本
    if (!b) return 1
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
}

// ── Caveman 版本检查（启动时调 GitHub API）──
async function checkCavemanUpdate() {
    let current = 'builtin'
    try {
        if (existsSync(CAVEMAN_VERSION_FILE)) current = readFileSync(CAVEMAN_VERSION_FILE, 'utf8').trim()
    } catch {}
    dynamicCache.cavemanCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/JuliusBrussee/caveman/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'Caveman releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        dynamicCache.cavemanReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const curSemver = extractSemver(current)
        if (latest && compareSemver(curSemver, extractSemver(latest)) < 0) {
            dynamicCache.cavemanUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'Caveman 有新版本可用')
        } else {
            dynamicCache.cavemanUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.warn({err: e}, 'Caveman releases 网络异常')
    }
}

// ── Caveman SKILL.md 更新（下载指定版本替换）──
async function downloadAndReplaceCaveman(targetVersion) {
    const skillUrl = `https://raw.githubusercontent.com/JuliusBrussee/caveman/${targetVersion}/skills/caveman/SKILL.md`
    log.info({version: targetVersion, url: skillUrl}, 'Caveman 开始下载')
    const resp = await fetch(skillUrl, {signal: AbortSignal.timeout(30000)})
    if (!resp.ok) throw new Error(`下载失败 ${resp.status}`)
    const content = await resp.text()
    if (!content.trim()) throw new Error('下载内容为空')
    // 备份旧文件
    if (existsSync(CAVEMAN_SKILL_FILE)) {
        writeFileSync(CAVEMAN_SKILL_FILE + '.bak', readFileSync(CAVEMAN_SKILL_FILE, 'utf8'), 'utf8')
    }
    writeFileSync(CAVEMAN_SKILL_FILE, content, 'utf8')
    writeFileSync(CAVEMAN_VERSION_FILE, targetVersion, 'utf8')
    dynamicCache.cavemanCurrent = targetVersion
    dynamicCache.cavemanUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'Caveman 更新完成')
}

function loadCavemanConfig() {
    const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
    const c = s.caveman
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean' && CAVEMAN_VALID_LEVELS.includes(c.level)) {
        return c
    }
    return {...CAVEMAN_DEFAULT_CONFIG}
}

function saveCavemanConfig(cfg) {
    const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
    s.caveman = cfg
    writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
}

// ── Caveman 系统提示词生成（会话级 systemPrompt.append 注入，不污染任何 CLAUDE.md）──
function buildCavemanSystemPrompt(cfg) {
    if (!cfg || !cfg.enabled || !cfg.level) return null
    const base = 'Use caveman compression (level: ' + cfg.level + '): drop filler/hedging/articles, use fragments and short synonyms. Keep all technical substance, code, error strings exact. No emoji, no tool-call narration. Speak user\'s language. Resume normal style for security warnings and destructive actions.'
    if (cfg.level === 'wenyan' || cfg.level.startsWith('wenyan')) {
        return base + ' Use classical Chinese (文言文) style.'
    }
    return base
}

// ── RTK 二进制定位 + 版本检查 + 配置 ──
// 功能说明: rtk（MIT）是 Rust 命令行压缩工具，bridge 打包内置，PostToolUse hook 调用
//   开发环境从 ../rtk-bin/ 找；生产环境从 process.resourcesPath/rtk/ 找
//   配置存 settings.json → bashCompress: {enabled}
//   版本检查: 启动时调 GitHub API 对比本地 version.txt，有更新写入 dynamicCache 供前端显示
// SIDE_EFFECT: 启动时调 GitHub API（checkRtkUpdate）→ 写入 dynamicCache.rtkUpdate → persistDynamicCache()
const RTK_TIMEOUT = 5000  // rtk 进程超时（ms）
const RTK_REJECT_RATIO = 0.95  // 压缩比 > 95% → 驳回
const RTK_CRITICAL_PATTERN = /fatal|panic|denied|segfault|corruption/i  // 致命关键词

function locateRtk() {
    const plat = process.platform
    const arch = process.arch
    const map = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }
    const name = map[`${plat}-${arch}`]
    if (!name) return null
    // rtk 在 gateway 同级目录：开发 rtk-bin/，生产打包 rtk/（extraResources.to）
    for (const dir of ['rtk-bin', 'rtk']) {
        const p = resolve(__dirname, '..', dir, name)
        if (existsSync(p)) return p
    }
    return null
}

function getRtkDir() {
    for (const dir of ['rtk-bin', 'rtk']) {
        const d = resolve(__dirname, '..', dir)
        if (existsSync(d)) return d
    }
    return resolve(__dirname, '..', 'rtk-bin')  // 默认，后续创建
}

function loadRtkConfig() {
    const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
    const c = s.bashCompress
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean') return c
    return {enabled: true}
}

function saveRtkConfig(cfg) {
    const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
    s.bashCompress = cfg
    writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
}

async function checkRtkUpdate() {
    const rtkDir = getRtkDir()
    const versionFile = join(rtkDir, 'version.txt')
    let current = 'unknown'
    try {
        if (existsSync(versionFile)) current = readFileSync(versionFile, 'utf8').trim()
    } catch {}
    // 持久化当前版本号供前端显示
    dynamicCache.rtkCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'RTK releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        // 缓存可用版本列表供前端选择（保留全部版本）
        dynamicCache.rtkReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const rtkSemver = extractSemver(current)
        if (latest && compareSemver(rtkSemver, extractSemver(latest)) < 0) {
            dynamicCache.rtkUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'RTK 有新版本可用')
        } else {
            dynamicCache.rtkUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.warn({err: e}, 'RTK releases 网络异常')
    }
}

// ── RTK 二进制更新（下载 + 替换）──
// 功能说明: 从 GitHub 下载指定版本的 RTK 二进制，解压替换本地文件，更新 version.txt
//   仅支持 Windows (.zip) 和 Linux/macOS (.tar.gz)
// SIDE_EFFECT: 覆盖 rtk-bin/ 或 resources/rtk/ 下的二进制 + version.txt
async function downloadAndReplaceRtk(targetVersion) {
    const plat = process.platform
    const arch = process.arch
    const binName = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }[`${plat}-${arch}`]
    if (!binName) throw new Error(`不支持的平台: ${plat}-${arch}`)

    const rtkDir = getRtkDir()
    mkdirSync(rtkDir, {recursive: true})

    // 1. 获取 release 详情找到下载 URL
    const releaseResp = await fetch(`https://api.github.com/repos/rtk-ai/rtk/releases/tags/${targetVersion}`, {
        signal: AbortSignal.timeout(30000)
    })
    if (!releaseResp.ok) throw new Error(`GitHub API 返回 ${releaseResp.status}`)
    const release = await releaseResp.json()
    const asset = (release.assets || []).find(a => a.name && a.name.includes(binName.replace('.exe', '')))
    if (!asset) throw new Error(`未找到 ${binName} 的下载链接`)
    const downloadUrl = asset.browser_download_url

    // 2. 下载到临时文件
    log.info({version: targetVersion, url: downloadUrl}, 'RTK 开始下载')
    const tmpFile = join(rtkDir, `_rtk_download${plat === 'win32' ? '.zip' : '.tar.gz'}`)
    const dlResp = await fetch(downloadUrl, {signal: AbortSignal.timeout(120000)})
    if (!dlResp.ok) throw new Error(`下载失败 ${dlResp.status}`)
    const buf = Buffer.from(await dlResp.arrayBuffer())
    writeFileSync(tmpFile, buf)
    log.info({version: targetVersion, size: buf.length}, 'RTK 下载完成')

    // 3. 解压
    try {
        if (plat === 'win32') {
            const extractDir = join(rtkDir, '_rtk_extract')
            if (existsSync(extractDir)) rmdirSync(extractDir, {recursive: true})
            mkdirSync(extractDir, {recursive: true})
            execSync(`powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${extractDir}' -Force"`, {timeout: 30000, windowsHide: true})
            const extracted = join(extractDir, 'rtk.exe')
            if (existsSync(extracted)) {
                const dest = join(rtkDir, binName)
                if (existsSync(dest)) unlinkSync(dest)
                writeFileSync(dest, readFileSync(extracted))
            } else {
                throw new Error('解压后未找到 rtk 可执行文件')
            }
            rmdirSync(extractDir, {recursive: true})
        } else {
            execSync(`tar -xzf "${tmpFile}" -C "${rtkDir}"`, {timeout: 30000})
            const dest = join(rtkDir, binName)
            try { execSync(`chmod +x "${dest}"`) } catch {}
        }
    } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile)
    }

    // 4. 更新 version.txt
    writeFileSync(join(rtkDir, 'version.txt'), targetVersion, 'utf8')
    dynamicCache.rtkCurrent = targetVersion

    // 5. 清除更新提示（版本列表保留，供后续切换）
    dynamicCache.rtkUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'RTK 更新完成')
}

// ── RTK PostToolUse hook 处理器 ──
// 功能说明: 拦截 Bash 工具的结果，将 stdout 通过 rtk 管道压缩后替换 tool_response
//   含两道安全检查：压缩比异常 → 驳回；致命关键词漏网 → 驳回
//   失败/超时/不可用 → 静默降级，原样返回
// 实现方式: spawn rtk <command> → stdin 写入 stdout 原文 → 收集输出 → 检查 → updatedMCPToolOutput
// 关键数据流: tool_response → spawn rtk → 压缩结果 → 安全检查 → {continue: true, hookSpecificOutput}
//   或 驳回/降级 → {continue: true}（不修改 tool_response）
async function rtkPostToolUseHandler(input, _toolUseID, _options) {
    const rtkPath = locateRtk()
    if (!rtkPath) return {continue: true}
    const cfg = loadRtkConfig()
    if (!cfg.enabled) return {continue: true}
    if (input.tool_name !== 'Bash') return {continue: true}

    const response = input.tool_response
    // 判断是否为结构化结果（SDK 返回 {stdout, stderr, exitCode, ...}），非结构化则跳过
    if (!response || typeof response !== 'object') return {continue: true}
    const {stdout, stderr, exitCode} = response
    const original = (stdout || '') + (stderr ? '\n' + stderr : '')
    if (!original.trim()) return {continue: true}
    // exitCode ≠ 0 → 失败命令不压缩
    if (exitCode !== undefined && exitCode !== 0) return {continue: true}

    // 获取原命令文本（从 tool_input 中取）
    const cmd = (input.tool_input && typeof input.tool_input === 'object' && input.tool_input.command)
        ? String(input.tool_input.command)
        : ''

    // 调用 rtk 压缩
    let compressed = null
    try {
        compressed = await spawnRtk(rtkPath, cmd, original)
    } catch (e) {
        log.warn({err: e, sessionId: input.session_id?.slice(0, 8)}, 'RTK 压缩失败，降级为原样')
        return {continue: true}
    }
    if (!compressed) return {continue: true}

    // ── bridge 安全检查层 ──
    const originalLen = Buffer.byteLength(original, 'utf8')
    const compressedLen = Buffer.byteLength(compressed, 'utf8')
    // 检查1: 压缩比异常（砍掉 95%+）
    if (originalLen > 0 && (compressedLen / originalLen) < (1 - RTK_REJECT_RATIO)) {
        log.warn({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen,
            ratio: (compressedLen / originalLen).toFixed(3)}, 'RTK 压缩比异常，驳回')
        return {continue: true}
    }
    // 检查2: 致命关键词漏网（被删除部分含致命关键词）
    if (RTK_CRITICAL_PATTERN.test(original) && !RTK_CRITICAL_PATTERN.test(compressed)) {
        log.warn({sessionId: input.session_id?.slice(0, 8)}, 'RTK 丢弃部分含致命关键词，驳回')
        return {continue: true}
    }

    const savedPct = originalLen > 0 ? Math.round((1 - compressedLen / originalLen) * 100) : 0
    log.info({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen, savedPct},
        `RTK 压缩 — ${originalLen}→${compressedLen} 字节 节省${savedPct}%`)

    return {
        continue: true,
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedMCPToolOutput: {...response, stdout: compressed, stderr: ''}
        }
    }
}

// ── 启动 rtk 子进程并收集输出 ──
// 功能说明: spawn rtk，stdin 传入要压缩的文本，收集 stdout 返回压缩结果
// 实现方式: child_process.spawn → stdin.write + stdin.end → 拼接 stdout chunks
//   5 秒超时，任何异常（崩溃/超时/spawn 失败）抛给调用方
// ── spawnRtk — 启动 RTK 子进程处理文本压缩 ──
// 功能说明: 将文本通过 stdin 传入 RTK 二进制，通过 stdout 收集压缩/解压结果
//   用于 Bash 命令输出压缩（减少 token 消耗）和解压（还原原始输出）
// 实现方式: child_process.spawn(rtkPath, [cmd]) → stdin.write(text) → 监听 stdout/stderr/close
//   exit code 非 0 时 reject 并携带 stderr 前 200 字符用于诊断
// @param {string} rtkPath - RTK 可执行文件绝对路径
// @param {string} cmd - RTK 命令（c=compress, d=decompress, v=version）
// @param {string} text - 待处理文本（通过 stdin 输入）
// @returns {Promise<string>} stdout 输出
function spawnRtk(rtkPath, cmd, text) {
    return new Promise((resolve, reject) => {
        const args = cmd ? [cmd] : []
        const child = spawn(rtkPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: RTK_TIMEOUT,
            windowsHide: true,
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.on('close', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`rtk exit ${code}: ${stderr.slice(0, 200)}`))
                return
            }
            resolve(stdout)
        })
        child.on('error', reject)
        child.stdin.write(text, 'utf8')
        child.stdin.end()
    })
}

// 功能说明: 扫描 ~/.claude/agents/*.md，解析 frontmatter 组装为 SDK AgentDefinition 字典
// key 为 agent name（frontmatter.name 或文件名去扩展名），value 含 description/tools/model/prompt
// 关键数据流: agents/ 目录 → 遍历 .md → parseFrontmatter → {name: AgentDefinition}
function loadAgentDefinitions() {
    const ad = join(CLAUDE_HOME, 'agents');
    const defs = {}
    try {
        for (const fn of readdirSync(ad)) {
            if (!fn.endsWith('.md')) continue
            try {
                const c = readFileSync(join(ad, fn), 'utf8')
                const {frontmatter: fm, body} = parseFrontmatter(c)
                const name = fm.name || fn.replace(/\.md$/, '')
                const tools = fm.tools ? fm.tools.split(',').map(t => t.trim()).filter(Boolean) : undefined
                defs[name] = {
                    description: fm.description || `Agent: ${name}`,
                    prompt: body?.trim() || fm.description || `You are the "${name}" specialized agent.`,
                    ...(tools ? {tools} : {}),
                    ...(fm.model && fm.model !== 'inherit' ? {model: fm.model} : {}),
                }
            } catch {
            }
        }
    } catch {
    }
    return defs
}

// 功能说明: 将存储用的编码目录名还原为真实路径（C--Users-xxx → C:/Users/xxx）
// 实现方式: 正则 ^([a-zA-Z])--(.+)$ 提取盘符和后段，后段 - 替换为 /
// 关键数据流: "C--Users-xxx" → 盘符 "C" + 路径段 → "C:/Users/xxx"
function decodeProjectName(n) {
    const m = n.match(/^([a-zA-Z])--(.+)$/);
    if (!m) return null;
    return m[1] + ':/' + m[2].replace(/-/g, '/')
}

// 功能说明: 将工作目录路径编码为文件系统安全的目录名
// 实现方式: 盘符 D:/path/to → "D--path-to"（: → --, / → -）
// 关键数据流: "D:/path/to/project" → "D--path-to-project"
function encodeProjectName(wd) {
    const n = wd.replace(/\\/g, '/');
    const dm = n.match(/^([a-zA-Z]):\/(.*)$/);
    if (!dm) return n.replace(/\//g, '-');
    return dm[1] + '--' + dm[2].replace(/\//g, '-')
}

// 功能说明: 从 HTTP 请求流中读取完整 body 并解析为 JSON 对象
// 实现方式: 监听 data 事件拼接字符串，end 事件时 JSON.parse；解析失败返回 {}（不抛异常）
// 关键数据流: req stream → data 拼接 → JSON.parse → 对象 或 {}
function readBody(req) {
    return new Promise(r => {
        let d = '';
        req.on('data', c => {
            d += c
        });
        req.on('end', () => {
            try {
                r(JSON.parse(d || '{}'))
            } catch {
                r({})
            }
        })
    })
}

// 功能说明: 解析 multipart/form-data 上传请求，提取 fields 和 files
// 实现方式: 从 Content-Type 取 boundary → 按 boundary 分割 buffer → 逐个解析 part → 区分字段/文件
// 关键数据流: req stream → Buffer 拼接 → boundary 分割 → {fields, files}
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => {
            try {
                const buf = Buffer.concat(chunks)
                const ct = req.headers['content-type'] || ''
                const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/)
                if (!bm) { resolve({fields: {}, files: {}}); return }
                const boundary = bm[1] || bm[2]
                const boundaryBuf = Buffer.from('--' + boundary)
                const fields = {}
                const files = {}
                let pos = buf.indexOf(boundaryBuf)
                while (pos !== -1) {
                    pos += boundaryBuf.length
                    const nextPos = buf.indexOf(boundaryBuf, pos)
                    if (nextPos === -1) break
                    const part = buf.slice(pos, nextPos)
                    // 去掉末尾的 \r\n--
                    const trimmedLen = part[part.length - 2] === 13 && part[part.length - 1] === 10 ? part.length - 2 : part.length
                    const content = part.slice(0, trimmedLen)
                    const headerEnd = content.indexOf('\r\n\r\n')
                    if (headerEnd === -1) { pos = nextPos; continue }
                    const headerStr = content.slice(0, headerEnd).toString()
                    const body = content.slice(headerEnd + 4)
                    // 去掉末尾 \r\n
                    const bodyContent = body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10
                        ? body.slice(0, body.length - 2) : body
                    const nameM = headerStr.match(/name="([^"]+)"/)
                    const filenameM = headerStr.match(/filename="([^"]+)"/)
                    if (nameM) {
                        const name = nameM[1]
                        if (filenameM) {
                            files[name] = {filename: filenameM[1], data: bodyContent, contentType: (headerStr.match(/Content-Type:\s*([^\s;]+)/i) || [])[1] || 'application/octet-stream'}
                        } else {
                            fields[name] = bodyContent.toString()
                        }
                    }
                    pos = nextPos
                }
                resolve({fields, files})
            } catch (e) { reject(e) }
        })
        req.on('error', reject)
    })
}

// 功能说明: 将前端 thinking 等级（off/low/medium/high/xhigh/max）映射为 SDK thinking budgetTokens 配置
// 实现方式: switch 匹配 6 级 → {type:'disabled'} 或 {type:'enabled', budgetTokens:N}；默认 16000 tokens
// 关键数据流: 'high' → {type: 'enabled', budgetTokens: 16000} / 'off' → {type: 'disabled'}
function mapThinkingLevel(lv) {
    switch (lv) {
        case 'off':
            return {type: 'disabled'};
        case 'low':
            return {type: 'enabled', budgetTokens: 2000};
        case 'medium':
            return {type: 'enabled', budgetTokens: 8000};
        case 'high':
            return {type: 'enabled', budgetTokens: 16000};
        case 'xhigh':
            return {type: 'enabled', budgetTokens: 24000};
        case 'max':
            return {type: 'enabled', budgetTokens: 32000};
        default:
            return {type: 'enabled', budgetTokens: 16000}
    }
}

// ---- SDK message conversion ----
// ── SDK 消息转 WebSocket 格式（convertSdkToWs）──
// 功能说明: 将 Claude Agent SDK 的各种消息类型映射为前端统一的 WebSocket JSON 消息
//   负责消息类型的甄别、筛选（null 表示不转发）、参数重映射
// 实现方式: switch (sdkMsg.type) 匹配 6 种 SDK 消息类型，stream_event 委托给 mapStreamEvent 处理子类型
//   丢弃不需要的类型（返回 null → startStreamPump 不广播）
// 关键数据流: SDK message → switch type → 对应 WS 格式 → broadcast 或 null（跳过）
//   覆盖类型: system_init / stream_event(含 tool_use_start/thinking/text_delta 等) / assistant_message / user_message_echo / result / tool_progress
function convertSdkToWs(sdkMsg, sessionId) {
    switch (sdkMsg.type) {
        case 'system':
            if (sdkMsg.subtype === 'init') return {
                type: 'system_init',
                cwd: sdkMsg.cwd,
                model: sdkMsg.model,
                tools: sdkMsg.tools,
                sessionId,
                permissionMode: sdkMsg.permissionMode,
                skills: sdkMsg.skills
            };
            return null
        case 'stream_event':
            return mapStreamEvent(sdkMsg.event)
        case 'assistant':
            return {type: 'assistant_message', message: sdkMsg.message, error: sdkMsg.error}
        case 'user':
            return {type: 'user_message_echo', message: sdkMsg.message}
        case 'result':
            return {
                type: 'result',
                subtype: sdkMsg.subtype,
                duration_ms: sdkMsg.duration_ms,
                is_error: sdkMsg.is_error,
                num_turns: sdkMsg.num_turns,
                result: sdkMsg.result,
                usage: sdkMsg.usage
            }
        case 'tool_progress':
            return {
                type: 'tool_progress',
                tool_use_id: sdkMsg.tool_use_id,
                tool_name: sdkMsg.tool_name,
                elapsed_time_seconds: sdkMsg.elapsed_time_seconds
            }
        default:
            return null
    }
}

// 功能说明: 映射 SDK stream_event 的细分事件类型为前端 WS 消息
// 实现方式: content_block_start 区分 tool_use/thinking → 提取对应字段；content_block_delta 提取 text_delta/thinking_delta
//   不认识的类型返回 null（不广播），减少前端噪音
// 关键数据流: stream_event → type 分支 → {type, tool_name/text/thinking, ...} 或 null
function mapStreamEvent(event) {
    if (event.type === 'content_block_start') {
        const b = event.content_block;
        if (b.type === 'tool_use') return {
            type: 'tool_use_start',
            tool_name: b.name,
            tool_use_id: b.id,
            input: b.input
        };
        if (b.type === 'thinking') return {type: 'thinking_start', index: event.index, thinking: b.thinking || ''};
        return {type: 'content_block_start'}
    }
    if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d.type === 'text_delta') return {type: 'text_delta', text: d.text};
        if (d.type === 'thinking_delta') return {
            type: 'thinking_delta',
            index: event.index,
            thinking: d.thinking || ''
        };
        return null
    }
    if (event.type === 'message_start') return {
        type: 'message_start',
        model: event.message.model,
        usage: event.message.usage
    }
    return null
}

// ── SDK query 选项组装（makeQueryOptions）──
// 功能说明: 从请求体/环境变量/cli settings 三个来源拼装 SDK query() 所需的完整 options 对象
//   处理 apiKey 优先级、model 映射、权限模式、thinking 预算、env 注入等
// 实现方式:
//   1. 三源合并: body(前端请求) > process.env > cli settings.json
//   2. 删除 ELECTRON_RUN_AS_NODE（claude.exe 是 Electron 二进制，带此 env 会当 node 跑导致 ENOENT）
//   3. 非 bypass 模式注册 canUseTool 回调；bypass 下 SDK 不触发回调所以不注册
// 关键数据流: body + env + cliS → merge → {model, executable, cwd, permissionMode, thinking, maxTurns, mcpServers, env, canUseTool?}
async function makeQueryOptions(body, workDir, cliS, extraEnv = {}, sessionId = null) {
    const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || cliS.env?.ANTHROPIC_AUTH_TOKEN
    let baseUrl = body.baseUrl || process.env.ANTHROPIC_BASE_URL || cliS.env?.ANTHROPIC_BASE_URL
    const exe = body.claudeExe || process.env.CLAUDE_EXE || cliS.claudeExe || getClaudeExe()
    const permissionMode = body.permissionMode || 'default'
    const agents = body._agents || loadAgentDefinitions()  // sub-session 可覆盖为单个 agent

    // DeepSeek 兼容代理: 自动路由请求通过本地代理修复参数冲突
    if (baseUrl && baseUrl.includes('deepseek') && !isProxyRunning()) {
        try {
            await startDeepSeekProxy(baseUrl)
        } catch (e) {
            log.error({err: e}, 'DeepSeek proxy 启动失败')
        }
    }
    const effectiveBaseUrl = (baseUrl && baseUrl.includes('deepseek') && isProxyRunning())
        ? getProxyUrl()
        : baseUrl

    const opts = {
        model: mapModel(body.model) || cliS.model || MODEL,
        executable: 'node',
        cwd: workDir,
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        thinking: mapThinkingLevel(body.thinkingLevel || 'auto'),
        maxTurns: body.maxTurns || cliS.maxTurns || 40,
        resume: body.resume || undefined,
        mcpServers: cliS.mcpServers || undefined,
        stderr: (msg) => process.stderr.write(`[claude.exe stderr] ${msg}`),
        env: (() => {
            const e = {
                ...process.env,
                CLAUDE_CODE_ENTRYPOINT: 'claude',
                ANTHROPIC_API_KEY: apiKey,
                ANTHROPIC_BASE_URL: effectiveBaseUrl,
                ANTHROPIC_MODEL: mapModel(body.model) || cliS.model || MODEL, ...extraEnv
            };
            delete e.ELECTRON_RUN_AS_NODE;
            return e
        })(),
    }
    // Caveman: 会话级 systemPrompt.append 注入，仅对 bridge 会话生效，不污染任何 CLAUDE.md
    const cavemanPrompt = buildCavemanSystemPrompt(cliS.caveman)
    if (cavemanPrompt) opts.systemPrompt = {type: 'preset', preset: 'claude_code', append: cavemanPrompt}
    // 有 native binary 路径时才传，否则 SDK 自动走自带的 cli.js
    if (exe) opts.pathToClaudeCodeExecutable = exe
    // 非 bypass 模式才注册 canUseTool（bypass 下 SDK 不触发回调）
    if (sessionId && permissionMode !== 'bypassPermissions') opts.canUseTool = makeCanUseTool(sessionId)
    // 注入 agent 定义（含内置+自定义），SDK 的 Task 工具用此列表找到子 agent
    if (Object.keys(agents).length) opts.agents = agents
    // 注册 Subagent 生命周期 hooks（SDK 子 agent 启动/停止时广播到前端）
    if (sessionId) {
        opts.hooks = {
            SubagentStart: [{
                matcher: '', timeout: 30, hooks: [(input) => {
                    try {
                        broadcast(sessionId, {
                            type: 'subagent_start',
                            agentId: input.agent_id,
                            agentType: input.agent_type,
                            ts: Date.now()
                        })
                    } catch {
                    }
                }]
            }],
            SubagentStop: [{
                matcher: '', timeout: 30, hooks: [(input) => {
                    try {
                        broadcast(sessionId, {
                            type: 'subagent_done',
                            agentId: input.agent_id,
                            transcriptPath: input.agent_transcript_path,
                            ts: Date.now()
                        })
                    } catch {
                    }
                }]
            }],
            PostToolUse: [{
                matcher: '', timeout: 10, hooks: [rtkPostToolUseHandler]
            }],
        }
    }
    return opts
}

// ── SDK 消息流泵（startStreamPump）──
// 功能说明: 从 SDK query 的 async iterable 中逐条消费消息，转换并广播到 WebSocket 客户端
//   同时完成以下 side-effect 工作：缓存命令/agent 名单、累积本轮文本、触发记录点结算和镜像同步
// 实现方式:
//   1. for await (const sdkMsg of s.query) 逐条消费 SDK 消息
//   2. system/init 时缓存 commands/agentNames 到 dynamicCache + 记录 lastSessionId
//   3. assistant 消息累积文本到 s.turnText（供 IM 镜像同步用）
//   4. result 消息时：结算记录点(finalizeCheckpoint) + 镜像到 IM(maybeMirror)
//   5. convertSdkToWs 转换为 WS 格式 → broadcast 给桌面端
//   6. tool_use_start 消息触发 maybeMirrorProgress（工具进度镜像）
// 关键数据流: SDK async iterator → convertSdkToWs() → broadcast(wsMsg)
//   → 并行: finalizeCheckpoint() + maybeMirror() (result 时)
//   → 并行: maybeMirrorProgress() (tool_use_start 时)
//   → catch: stream_error → broadcast error
async function startStreamPump(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return
    try {
        for await (const sdkMsg of s.query) {
            if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
                if (sdkMsg.session_id) s.lastSessionId = sdkMsg.session_id
                // 顺手把 init 暴露的命令/agent 名单缓存下来，供设置页冷启动读取
                if (Array.isArray(sdkMsg.slash_commands)) {
                    dynamicCache.commands = sdkMsg.slash_commands.map(n => ({
                        name: n,
                        description: '',
                        argumentHint: ''
                    }));
                    dynamicCache.updatedAt = Date.now()
                }
                if (Array.isArray(sdkMsg.agents)) dynamicCache.agentNames = sdkMsg.agents
                persistDynamicCache()
                // 缓存 SDK 内置 skills/agents/commands 名单（与硬编码兜底列表合并，取并集）
                if (Array.isArray(sdkMsg.skills)) builtinCache.skills = [...new Set([...builtinCache.skills, ...sdkMsg.skills])]
                if (Array.isArray(sdkMsg.agents)) builtinCache.agents = [...new Set([...builtinCache.agents, ...sdkMsg.agents])]
                if (Array.isArray(sdkMsg.slash_commands)) builtinCache.commands = sdkMsg.slash_commands.map(n => typeof n === 'string' ? {
                    name: n,
                    description: '',
                    argumentHint: ''
                } : n)
                builtinCache.updatedAt = Date.now()
            }
            // 累积本轮 assistant 文本 + 监听 [WF:run ...] 指令
            if (sdkMsg.type === 'assistant') {
                for (const b of (sdkMsg.message?.content || [])) {
                    if (b.type === 'text' && b.text) {
                        s.turnText = (s.turnText || '') + b.text;
                        // 检测 [WF:run 脚本名 {args}] 指令（仅当全局开关 enabled 时）
                        if (!loadWfConfig().enabled) continue;
                        const wfMatch = b.text.match(/\[WF:run\s+([\w.-]+?)\s+(\{[\s\S]*?\})\]/);
                        if (wfMatch && !s._wfRan) {
                            const wfName = wfMatch[1];
                            let wfArgs = {};
                            try {
                                wfArgs = JSON.parse(wfMatch[2]);
                            } catch {
                            }
                            // 验证脚本名必须在可用列表中，防止 DeepSeek 把占位符当真实名称
                            const valid = getWorkflow(wfName + '.mjs') || getWorkflow(wfName);
                            if (!valid) {
                                log.warn({sessionId: sessionId?.slice(0, 8), wfName}, '[WF:run] 脚本名无效，已忽略');
                                continue;
                            }
                            s._wfRan = true;
                            log.info({sessionId: sessionId?.slice(0, 8), wfName, wfArgs}, '[WF:run] 已触发');
                            runWfScript(wfName, sessionId, wfArgs).catch(function (e) {
                                log.error({err: e, sessionId: sessionId?.slice(0, 8), wfName}, 'Workflow 引擎错误');
                            });
                        }
                    }
                }
            }
            // result 标志一个回合结束 → 结算记录点 + 镜像到所有已开启的 IM 平台
            if (sdkMsg.type === 'result') {
                try {
                    finalizeCheckpoint(sessionId)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'finalizeCheckpoint 失败')
                }
                try {
                    maybeMirror(sessionId)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'mirror 失败')
                }
                try {
                    maybeUpdateProjectCache(sessionId, s)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'project-cache 更新失败')
                }
                s.turnText = ''
            }
            const wsMsg = convertSdkToWs(sdkMsg, sessionId)
            if (wsMsg) broadcast(sessionId, wsMsg)
            // 镜像工具进度到所有已开启 mirror 的 IM 平台
            if (wsMsg?.type === 'tool_use_start') {
                try {
                    maybeMirrorProgress(sessionId, wsMsg.tool_name)
                } catch {
                }
                ;
                try {
                    maybeInjectProjectCache(sessionId, s, wsMsg)
                } catch {
                }
            }
        }
    } catch (e) {
        log.error({err: e, sessionId: sessionId?.slice(0, 8)}, 'pump 异常')
        if (e.message !== 'cancelled') broadcast(sessionId, {type: 'error', message: e.message, code: 'stream_error'})
    } finally {
        const s2 = sessions.get(sessionId);
        if (s2) s2.query = null
    }
}

// ── 微信文本分段发送（按 UTF-8 字节切片 + 分页标记，避免超长被微信截断）──
const WX_MAX_BYTES = 3500       // 单条文本字节上限（留余量，中文 1 字 3 字节）
const WX_MARKER_RESERVE = 16    // 给【n/N】分页标记预留的字节
// 按字节切片，遍历码点不拆坏多字节字符
// 功能说明: 按 UTF-8 字节数切片文本，不拆坏多字节字符（中文一字 3 字节不会从中切开）
// 实现方式: 逐码点遍历，用 Buffer.byteLength 计算每个字符的 UTF-8 字节数，累加超过 maxBytes 时切段
// 关键数据流: text → for ch of String(text) → 累加 byteLength → 超限切段 → [segment1, segment2, ...]
// ── splitByBytes — 按 UTF-8 字节边界安全分段 ──
// 功能说明: 将文本按 UTF-8 字节数切成多段，确保不在多字节字符（如中文）中间切断
// 实现方式: 逐字符累加 Buffer.byteLength(ch, 'utf8')，超过 maxBytes 时在最后一个完整字符处分段
//   保证每段输出都是合法的 UTF-8 字符串，不会产生乱码
// 关键数据流: text → 逐字符累计字节 → 超限时 cut → parts[] → 返回至少一个元素([''] 兜底)
function splitByBytes(text, maxBytes) {
    const out = [];
    let cur = '';
    let n = 0
    for (const ch of String(text)) {
        const b = Buffer.byteLength(ch, 'utf8')
        if (n + b > maxBytes && cur) {
            out.push(cur);
            cur = '';
            n = 0
        }
        cur += ch;
        n += b
    }
    if (cur) out.push(cur)
    return out.length ? out : ['']
}

// 顺序分段发送给微信，返回 {sent, parts}
// 功能说明: 将长文本按 UTF-8 字节切片分段发送到微信 iLink Bot，避免超长被截断
// 实现方式: splitByBytes 按字节边界切片（不拆坏多字节字符），+【n/N】分页标记；条间 400ms 延迟防乱序/限频
// 关键数据流: fullText → splitByBytes(max WX_MAX_BYTES-16) → forEach chunk → iLink API POST → {sent, parts}
async function sendWeChatChunks(bn, token, userId, contextToken, fullText) {
    const parts = splitByBytes(fullText, WX_MAX_BYTES - WX_MARKER_RESERVE)
    const total = parts.length
    let sent = true
    for (let i = 0; i < total; i++) {
        const body = total > 1 ? `【${i + 1}/${total}】\n${parts[i]}` : parts[i]
        try {
            const ir = await fetch(`${bn}ilink/bot/sendmessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081',
                    'Authorization': `Bearer ${token}`,
                    'AuthorizationType': 'ilink_bot_token'
                },
                body: JSON.stringify({
                    msg: {
                        from_user_id: '',
                        to_user_id: userId,
                        client_id: `gw-${Date.now()}-${i}`,
                        message_type: 2,
                        message_state: 2,
                        context_token: contextToken || '',
                        item_list: [{type: 1, text_item: {text: body}}]
                    }, base_info: {channel_version: '0.1.0'}
                }),
                signal: AbortSignal.timeout(10000),
            })
            const d = await ir.json()
            if (!(ir.ok && (!d.ret || d.ret === 0))) sent = false
        } catch {
            sent = false
        }
        if (i < total - 1) await new Promise(r => setTimeout(r, 400))  // 条间小延迟，避免乱序/限频
    }
    return {sent, parts: total}
}

// 多平台镜像：遍历所有适配器，mirror 已开启的才推（各适配器自行实现 sendToUser/findUserForSession）
// ── 多平台镜像同步（maybeMirror）──
// 功能说明: 每个回合结束后，将本轮累积的 Claude 回复文本推送到所有开启 mirror 的 IM 平台
//   遍历 confirmHooks，仅对 session.mirrors[hook.platform]===true 的适配器调用 sendToUser
// 实现方式: 取 s.turnText 文本，trim 后非空则逐适配器 hook.sendToUser(sid, text)；各适配器负责自己的格式化/发送逻辑
// 关键数据流: s.turnText（startStreamPump 中累积）→ 遍历 confirmHooks
//   → check s.mirrors[hook.platform] → hook.sendToUser(sid, text) → IM 平台
async function maybeMirror(sid) {
    const s = sessions.get(sid)
    if (!s) return
    const text = (s.turnText || '').trim()
    if (!text) return
    for (const hook of confirmHooks) {
        if (!s.mirrors[hook.platform]) continue
        try {
            await hook.sendToUser(sid, text)
        } catch (e) {
            log.warn({err: e, platform: hook.platform, sessionId: sid?.slice(0, 8)}, 'mirror sendToUser 失败')
        }
    }
}

// 镜像工具进度到所有已开启 mirror 的 IM 平台
// ── 工具进度镜像（maybeMirrorProgress）──
// 功能说明: 每个 tool_use_start 事件触发时，将进度信息推送到已开启 mirror 的 IM 平台（如 "⏳ [2] 🔧 Read..."）
// 实现方式: 递增 s.turnToolCount 计数器，遍历 confirmHooks 检查 mirror 状态，调用 sendToUser 推送进度文本
// 关键数据流: tool_use_start → maybeMirrorProgress(sid, toolName) → confirmHooks[mirror=true] → sendToUser(进度文本)
function maybeMirrorProgress(sid, toolName) {
    const s = sessions.get(sid)
    if (!s) return
    s.turnToolCount = (s.turnToolCount || 0) + 1
    for (const hook of confirmHooks) {
        if (!s.mirrors[hook.platform]) continue
        try {
            hook.sendToUser(sid, `⏳ [${s.turnToolCount}] 🔧 ${toolName || '工具'}...`)
        } catch {
        }
    }
}

// ── 项目结构缓存注入（maybeInjectProjectCache）──
// 功能说明: 检测到 Claude 正在探索项目结构时（Glob/Grep/Agent Explore/Bash find），
//   如果存在项目缓存则注入摘要到 pushStream，避免重复探索
//   每 session 只注入一次（_cacheInjected 标记）
// 实现方式: isExplorationAttempt 判定 → loadProjectCache 读缓存 → pushStream.push 注入
function maybeInjectProjectCache(sessionId, s, wsMsg) {
    if (s._cacheInjected) return
    const toolName = wsMsg.tool_name
    const input = wsMsg.input
    if (!isExplorationAttempt(toolName, input)) return
    const cache = loadProjectCache(s.workDir)
    if (!cache) return
    const text = buildCacheInjectionText(cache)
    if (!text) return
    s._cacheInjected = true
    s.pushStream.push({
        type: 'user',
        session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text}]},
        parent_tool_use_id: null,
    })
    log.info({sessionId: sessionId?.slice(0, 8), toolName}, 'project-cache 已注入')
}

// ── 项目缓存增量更新（maybeUpdateProjectCache）──
// 功能说明: 每个回合结束时（result 事件），用已有 preSnapshot 与当前文件对比
//   有变更 → 增量更新缓存；无缓存 → 全量构建
async function maybeUpdateProjectCache(sessionId, s) {
    if (!s.pendingTurn?.preSnapshot) return
    const cache = loadProjectCache(s.workDir)
    const scan = scanWorkdirFiles(s.workDir)
    if (scan.missing) return
    const diffMap = diffSnapshotVsCurrent(s.pendingTurn.preSnapshot, scan.files, s.workDir)
    const changedCount = [...diffMap.values()].filter(d => d.status !== 'unchanged').length
    if (changedCount === 0 && cache) return // 无变更，跳过
    if (!cache) {
        const newCache = await buildProjectCache(s.workDir)
        if (newCache) saveProjectCache(s.workDir, newCache)
    } else {
        const result = await updateProjectCache(s.workDir, cache, diffMap)
        if (result.updated > 0) {
            saveProjectCache(s.workDir, cache)
            log.info({
                sessionId: sessionId?.slice(0, 8),
                updated: result.updated,
                skipped: result.skipped
            }, 'project-cache 已更新')
        }
    }
}

// Claude Code 内置命令兜底列表（冷启动无活跃 query 时用，无需等 SDK 连接）
const BUILTIN_COMMANDS = [
    {name: 'help', description: '获取帮助信息', argumentHint: ''},
    {name: 'clear', description: '清除对话历史', argumentHint: ''},
    {name: 'compact', description: '压缩上下文释放 token', argumentHint: ''},
    {name: 'config', description: '打开配置面板', argumentHint: ''},
    {name: 'cost', description: '查看当前会话 token 消耗', argumentHint: ''},
    {name: 'doctor', description: '诊断环境问题', argumentHint: ''},
    {name: 'init', description: '初始化项目 CLAUDE.md', argumentHint: ''},
    {name: 'review', description: '代码审查当前变更', argumentHint: ''},
    {name: 'simplify', description: '简化/重构当前代码', argumentHint: ''},
    {name: 'agents', description: '管理自定义子代理', argumentHint: ''},
    {name: 'memory', description: '管理项目记忆', argumentHint: ''},
    {name: 'permissions', description: '管理权限设置', argumentHint: ''},
    {name: 'hooks', description: '管理事件钩子', argumentHint: ''},
    {name: 'mcp', description: '管理 MCP 服务器', argumentHint: ''},
    {name: 'fast', description: '切换快速模式', argumentHint: ''},
    {name: 'context', description: '查看当前上下文信息', argumentHint: ''},
    {name: 'status', description: '查看会话状态', argumentHint: ''},
    {name: 'security-review', description: '安全审查代码', argumentHint: ''},
    {name: 'terminal-setup', description: '终端设置引导', argumentHint: ''},
    {name: 'basilica', description: 'Basilica 模式', argumentHint: ''},
]

// IM 自定义命令（微信/飞书/钉钉通用，显示在设置页"命令"Tab 自定义分组）
const IM_CUSTOM_COMMANDS = [
    {name: 'p', description: '列出所有已注册项目', argumentHint: '', aliases: ['projects', '项目']},
    {name: 'ss', description: '列出项目下所有Session', argumentHint: '[项目]', aliases: ['sessions', '会话']},
    {name: 'sw', description: '切换项目并同步桌面', argumentHint: '<项目> [编号]', aliases: ['switch', '切换']},
    {name: 'sws', description: '当前项目下切换会话', argumentHint: '<编号>', aliases: ['switch-session', '切换会话']},
    {name: 'ns', description: '新建会话并同步桌面', argumentHint: '[项目]', aliases: ['新会话']},
    {name: 'm', description: '开启/关闭平台镜像同步', argumentHint: '<微信/飞书/钉钉> [on/off]', aliases: ['mirror', '镜像']},
    {name: 'stop', description: '停止当前正在运行的 agent', argumentHint: '', aliases: ['停止']},
    {name: 'i', description: '当前项目/Session/桌面状态', argumentHint: '', aliases: ['info', '信息']},
    {name: 'h', description: '列出所有可用命令', argumentHint: '', aliases: ['help', '帮助']},
]

// SDK 内置 Skills 兜底列表（冷启动无活跃 session 时用）
const BUILTIN_SKILLS = [
    'avalonia-ui', 'db-sql', 'device-driver', 'embedded-c', 'project-router',
    'protocol-parser', 'spring-boot-api', 'ui-design', 'ui-winforms',
    'uniapp-android', 'vue-frontend', 'wechat-wait',
    'deep-research',
    'anthropic-skills:consolidate-memory', 'anthropic-skills:schedule', 'anthropic-skills:setup-cowork',
    'update-config', 'keybindings-help', 'verify',
    'code-review', 'simplify', 'fewer-permission-prompts',
    'loop', 'claude-api', 'run', 'init', 'review', 'security-review',
    'caveman',
]

// SDK 内置 Agents 兜底列表
const BUILTIN_AGENTS = [
    'claude', 'claude-code-guide', 'Explore', 'general-purpose', 'Plan', 'statusline-setup',
]
// 内置 agent 类型分类（SDK 内置无 .md 文件，手动打 type 标签）
const BUILTIN_AGENT_TYPES = {
    'claude': 'general',
    'claude-code-guide': 'guide',
    'Explore': 'explorer',
    'general-purpose': 'general',
    'Plan': 'planner',
    'statusline-setup': 'builder',
}

// SDK 内置 MCP 兜底列表（key: name → {version, scope}）
const BUILTIN_MCP = {
    'ccd_directory': {version: 'builtin', scope: 'builtin'},
    'ccd_session': {version: 'builtin', scope: 'builtin'},
    'ccd_session_mgmt': {version: 'builtin', scope: 'builtin'},
    'Claude_Preview': {version: 'builtin', scope: 'builtin'},
    'scheduled-tasks': {version: 'builtin', scope: 'builtin'},
}

// ---- 内置项缓存（SDK system_init 暴露的 skills/agents/commands 名单）----
// 冷启动时用硬编码兜底列表初始化，SDK 连接后由 system_init 合并更新
const builtinCache = {skills: [...BUILTIN_SKILLS], agents: [...BUILTIN_AGENTS], commands: [], updatedAt: 0}

// ── 定时任务调度（模块级状态）──
const SCHEDULED_TASKS_FILE = join(CLAUDE_HOME, 'bridge-scheduled-tasks.json')
const scheduledTasks = readJSON(SCHEDULED_TASKS_FILE) || {}
const cronJobs = new Map()

// ── executeScheduledTask — 执行单个定时任务 ──
// 功能说明: Cron 触发后，创建独立 session 并注入 prompt 启动 Agent 处理
//   复用 task.sessionId 可实现同一任务多轮复用上下文，未指定则新建 session
// 实现方式:
//   1. 从 scheduledTasks[id] 读取 task 配置（workDir/model/thinkingLevel 等）
//   2. 创建 PushStream → makeQueryOptions → sessions.set（permissionMode=bypassPermissions，无人值守模式）
//   3. pushStream 注入 task.prompt → startStreamPump 启动处理
//   任务失败（query 错误等）由 startStreamPump 内部的 pump 循环自动处理，不影响 cron 调度
// 关键数据流: id → scheduledTasks[id] → new session → push prompt → startStreamPump
async function executeScheduledTask(id) {
    const task = scheduledTasks[id]
    if (!task || !task.enabled) return
    log.info({taskId: id, prompt: task.prompt?.slice(0, 50)}, '定时任务触发')
    const body = {workDir: task.workDir, model: task.model || MODEL}
    const sessionId = task.sessionId || crypto.randomUUID()
    const pushStream = new PushStream()
    const cliS = loadCliSettings()
    const opts = await makeQueryOptions(body, task.workDir, cliS, {}, sessionId)
    if (task.sessionId) opts.resume = task.sessionId
    const q = query({prompt: pushStream, options: opts})
    sessions.set(sessionId, {
        query: q, workDir: task.workDir,
        pushStream, clients: new Set(),
        createdAt: Date.now(), pending: new Map(),
        permissionMode: opts.permissionMode || 'bypassPermissions',
        thinkingLevel: task.thinkingLevel || 'auto',
        mirrors: {wechat: false, feishu: false, dingtalk: false},
        queryOpts: opts,
        parentSessionId: null, agentName: 'scheduler',
        taskId: null, children: new Set(), depth: 0,
        turnText: '', turnToolCount: 0
    })
    pushStream.push({
        type: 'user', session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text: task.prompt}]},
        parent_tool_use_id: null,
    })
    startStreamPump(sessionId)
}

// ── resumeScheduledTasks — Gateway 启动时恢复所有已启用的定时任务 ──
// 功能说明: 从 bridge-scheduled-tasks.json 读取任务列表，逐个注册 node-cron 调度
//   任务在 cron 触发时异步执行，不相互阻塞
// 实现方式: 遍历 scheduledTasks → 过滤 enabled=true → cron.schedule(cron_expr, callback)
//   回调内 try-catch 确保单个任务失败不影响其他 cron 调度
// 关键数据流: bridge-scheduled-tasks.json → cron.schedule → executeScheduledTask
function resumeScheduledTasks() {
    for (const [id, task] of Object.entries(scheduledTasks)) {
        if (!task.enabled) continue
        try {
            const job = cron.schedule(task.cron || '* * * * *', () => {
                executeScheduledTask(id).catch(e => {
                    log.error({err: e, taskId: id}, '定时任务执行失败')
                })
            })
            cronJobs.set(id, job)
        } catch (e) {
            log.warn({err: e, taskId: id}, '定时任务恢复失败')
        }
    }
}

// ── 用户消息工作流自动匹配 ──
// 功能说明: AI 分类优先（高精度），关键词降级兜底（AI 超时/不可用时），自动选择最合适的 workflow
// 实现方式:
//   1. classifyWorkflowViaAI(text): fetch 调用 API 做意图分类，~100 token 输入 / 1 token 输出，5s 超时
//   2. analyzeMessageForWorkflow(text): 关键词匹配降级兜底，AI 失败时启用
//   3. autoTriggerWorkflow(sid, text): 编排函数——先推用户消息，再异步分类+启动 workflow
// 关键数据流: 用户消息 → classifyWorkflowViaAI → 命中→start workflow / 失败→关键词降级 / 都不中→跳过
const WF_VALID_NAMES = ['code-review', 'bug-hunter', 'audit-sweep', 'deep-research', 'judge-panel', 'generate-critic-fix', 'default']

async function classifyWorkflowViaAI(text) {
    const cliS = loadCliSettings()
    const apiKey = process.env.ANTHROPIC_API_KEY || cliS.env?.ANTHROPIC_AUTH_TOKEN
    const baseUrl = process.env.ANTHROPIC_BASE_URL || cliS.env?.ANTHROPIC_BASE_URL
    if (!apiKey || !baseUrl) return null

    const apiUrl = baseUrl.endsWith('/v1/messages') ? baseUrl : baseUrl.replace(/\/+$/, '') + '/v1/messages'
    const prompt = [
        '分类用户意图，只回复一个词。',
        '工作流: code-review(代码审查、review、检查代码质量)',
        'bug-hunter(找bug、排查异常、调试报错)',
        'audit-sweep(安全审计、全面排查、扫描漏洞)',
        'deep-research(深度调研、技术研究、了解新技术)',
        'judge-panel(方案对比、技术选型、架构决策)',
        'generate-critic-fix(修复代码、打补丁、修正bug)',
        'default(复杂多步骤任务、重构、实现新功能)',
        'none(简单问答、解释概念、聊天、不需要工作流)',
        '',
        '用户消息: """' + text.slice(0, 600).replace(/"/g, "'") + '"""',
        '',
        '回复:'
    ].join('\n')

    try {
        const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro',
                max_tokens: 10,
                temperature: 0,
                system: '你是工作流路由器。根据用户意图输出一个词。不要解释。',
                messages: [{role: 'user', content: prompt}],
            }),
            signal: AbortSignal.timeout(8000),
        })
        if (!resp.ok) return null
        const data = await resp.json()
        const answer = (data.content?.[0]?.text || '').trim().toLowerCase()
            .replace(/[^a-z-]/g, '')  // 去掉标点、空白等噪音
        if (answer === 'none') return null
        return WF_VALID_NAMES.includes(answer) ? answer : null
    } catch {
        return null
    }
}

const WORKFLOW_TRIGGERS = [
    {name: 'code-review', kw: ['审查', 'review', '检查代码', 'code review', '看下代码', '审阅', 'cr', '优化', '性能', '太慢', 'optimize', 'performance']},
    {name: 'bug-hunter', kw: ['找bug', 'bug', '缺陷', 'debug', 'exception', 'stack trace', '空指针', '死锁', '竞态', 'race condition', '内存泄漏', 'null pointer']},
    {name: 'audit-sweep', kw: ['审计', 'audit', '全面检查', 'sweep', '扫描漏洞', '安全审计', '安全审查']},
    {name: 'deep-research', kw: ['调研', 'research', '技术选型', '竞品', '对比一下市面', '深入分析']},
    {name: 'judge-panel', kw: ['方案', '对比', '选哪个', '比较优劣', '哪个好', '怎么选', '权衡', '架构决策']},
    {name: 'generate-critic-fix', kw: ['fix', '补丁', 'patch', '修正一下']},
]

function analyzeMessageForWorkflow(text) {
    if (!text || typeof text !== 'string') return null
    const lower = text.toLowerCase()
    for (const wf of WORKFLOW_TRIGGERS) {
        for (const k of wf.kw) {
            if (lower.includes(k.toLowerCase())) return wf.name
        }
    }
    // 高复杂度信号: >200字 或 含代码块 → 兜底
    if (text.length > 200 || text.includes('```')) return 'default'
    // 明确不需要 workflow 的问句: 简单问答、解释、闲聊
    if (/^(什么是|怎么|如何|为什么|what|how|why|帮我解释|hello|hi|你好)/i.test(text) && text.length < 50) return '__skip__'
    return null
}

async function autoTriggerWorkflow(sessionId, msgContent) {
    const wfCfg = loadWfConfig()
    if (!wfCfg.enabled) return

    let matchedWf = null
    const kwResult = analyzeMessageForWorkflow(msgContent)
    if (kwResult === '__skip__') return  // 明确不要 workflow

    // AI 分类优先；失败/超时/不可用 → 降级到关键词
    try {
        matchedWf = await classifyWorkflowViaAI(msgContent)
    } catch {
        matchedWf = null
    }
    if (!matchedWf) matchedWf = kwResult  // 关键词降级
    if (!matchedWf || matchedWf === '__skip__') return

    const wfList = listWorkflows()
    const exists = wfList.some(w => w.name.replace('.mjs', '') === matchedWf)
    if (!exists) return

    const wfId = 'wf-' + matchedWf + '-' + Date.now().toString(36)
    log.info({sessionId: sessionId?.slice(0, 8), workflow: matchedWf, wfId}, '自动启动 workflow')
    broadcast(sessionId, {
        type: 'workflow_auto_started',
        workflowId: wfId,
        name: matchedWf,
        task: msgContent.slice(0, 100),
        ts: Date.now(),
    })
    runWfScript(matchedWf, sessionId, {task: msgContent}).catch(e => {
        log.error({err: e, sessionId: sessionId?.slice(0, 8), workflow: matchedWf}, '自动 workflow 失败')
    })
}

// ---- HTTP server ----
// ── HTTP REST API 服务器 ──
// 功能说明: 统一 HTTP 入口，处理所有前端 REST API 请求（会话管理/配置CRUD/微信发送/确认响应/项目扫描/文件Diff等）
//   所有响应均为 JSON（Content-Type: application/json），所有路由都有 CORS 头
// 实现方式: 单 createServer 回调 + URL pathname 匹配 + method 检查；路由按 pathname 分组（sessions/config/wechat/confirm/projects）
//   匹配失败返回 404
// 关键数据流: HTTP request → URL pathname 匹配 → method dispatch → JSON response
const httpServer = createServer(async (req, res) => {
    res.setHeader('X-Source', 'github.com/kankancuige/claude-desktop-bridge')
    const httpStart = Date.now()
    // 拦截 res.end，记录 HTTP 请求日志
    const _end = res.end.bind(res)
    res.end = function (...args) {
        logHttpRequest(log, req, res.statusCode, httpStart)
        return _end(...args)
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return
    }
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

    // GET /debug-log —— 前端诊断用，msg 参数写入终端日志
    if (url.pathname === '/debug-log' && req.method === 'GET') {
        const msg = url.searchParams.get('msg') || ''
        log.info(msg)
        res.writeHead(200);
        res.end(JSON.stringify({ok: true, msg}));
        return
    }

    // ── POST /api/sessions —— 创建/恢复会话 ──
    // 功能说明: 创建一个新的 Claude Code SDK query 会话，或通过 resume 恢复已有会话
    //   完成以下初始化链：PushStream → query() → sessions Map → 文件快照基线 → 记录点恢复 → startStreamPump
    // 实现方式:
    //   1. body.workDir 必填，sessionId = body.resume 或 crypto.randomUUID()
    //   2. loadCliSettings + makeQueryOptions 组装 SDK query options
    //   3. 创建 PushStream 作为 prompt 输入，调用 query({prompt: pushStream, options})
    //   4. 存入 sessions Map（含 query/工作目录/pending/权限模式/mirrors 等）
    //   5. 恢复或新建文件快照基线（loadSnapshot / buildFileSnapshot）
    //   6. 恢复历史记录点（loadCheckpoints）
    //   7. 设为 focusedSessionId + 启动 startStreamPump
    // 关键数据流: POST {workDir, resume?, model?, ...} → PushStream → query() → sessions.set()
    //   → snapshot + checkpoints 恢复 → startStreamPump() → 201 {sessionId, workDir, resumed}
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readBody(req);
        const workDir = body.workDir
        if (!workDir) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'workDir required'}));
            return
        }
        const sessionId = body.resume || crypto.randomUUID()
        try {
            const cliS = loadCliSettings();
            const pushStream = new PushStream()
            const opts = await makeQueryOptions(body, workDir, cliS, {}, sessionId)
            if (body.resume) {
                opts.resume = body.resume
            }
            const q = query({prompt: pushStream, options: opts})
            sessions.set(sessionId, {
                query: q,
                workDir,
                pushStream,
                clients: new Set(),
                createdAt: Date.now(),
                pending: new Map(),
                permissionMode: opts.permissionMode,
                thinkingLevel: body.thinkingLevel || 'auto',
                mirrors: {wechat: false, feishu: false, dingtalk: false},
                queryOpts: opts,
                parentSessionId: null,
                agentName: body._agentName || 'main',
                taskId: null,
                children: new Set(),
                depth: body._depth || 0
            })
            // 文件 diff 基线：优先载入已持久化的基线（重启/resume 后仍显示累计改动）；没有才新拍并落盘
            try {
                const ss = sessions.get(sessionId)
                if (ss) {
                    const persisted = loadSnapshot(workDir, sessionId)
                    if (persisted) ss.snapshot = persisted
                    else {
                        ss.snapshot = buildFileSnapshot(workDir);
                        saveSnapshot(ss, sessionId)
                    }
                }
            } catch (e) {
                log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'snapshot 失败')
            }
            // resume 续接：载入历史记录点 + 恢复递增序号
            try {
                const ss = sessions.get(sessionId)
                if (ss) {
                    ss.checkpoints = loadCheckpoints(workDir, sessionId);
                    ss.checkpointSeq = ss.checkpoints.reduce((mx, c) => Math.max(mx, parseInt(String(c.id).replace('cp-', ''), 10) || 0), 0)
                }
            } catch (e) {
                log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'load checkpoints 失败')
            }
            focusedSessionId = sessionId
            startStreamPump(sessionId)
            // 后台异步构建项目结构缓存（仅首次，后续会话直接复用）
            if (!existsSync(cacheFilePath(workDir))) {
                buildProjectCache(workDir).then(c => {
                    if (c) saveProjectCache(workDir, c)
                }).catch(e => log.warn({err: e, workDir}, '后台 project-cache 构建失败'))
            }
            invalidateProjectsCache()
            res.writeHead(201);
            res.end(JSON.stringify({sessionId, workDir, resumed: !!body.resume}))
        } catch (e) {
            log.error({err: e}, 'session 创建失败')
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(JSON.stringify({error: String(e?.message || e)}))
            }
        }
        return
    }

    // ── POST /api/sessions/resolve —— IM 接入 resolve 会话 ──
    // 功能说明: 微信/飞书/钉钉等 IM 平台在收到用户消息后，通过此接口关联到当前桌面端正打开的活跃 session
    //   复用 focusedSessionId，并将 userId→sessionId 映射写入 adapter-sessions.json 用于后续消息路由
    // 实现方式:
    //   1. 检查 focusedSessionId 是否有效 → 有则复用，将 {userId: {sessionId, workDir, updatedAt}} 写 adapter-sessions.json
    //   2. 没有活跃 session → 返回 409 no_active_session，告知微信「请先在桌面端打开一个项目会话」
    // 关键数据流: POST {userId} → focusedSessionId 查找 → 写入 adapter-sessions.json → 200 {sessionId, reused:true}
    //   或 409 {error:'no_active_session'}
    if (req.method === 'POST' && url.pathname === '/api/sessions/resolve') {
        const body = await readBody(req);
        const userId = body.userId
        const af = join(CLAUDE_HOME, 'adapter-sessions.json');
        const ad = readJSON(af) || {}
        // 微信注入 desktop 当前打开的窗口（遥控模式）：复用 focusedSessionId
        if (focusedSessionId && sessions.has(focusedSessionId)) {
            const s = sessions.get(focusedSessionId)
            if (userId) {
                ad[userId] = {sessionId: focusedSessionId, workDir: s.workDir, updatedAt: Date.now()};
                writeJSON(af, ad)
            }
            res.writeHead(200);
            res.end(JSON.stringify({sessionId: focusedSessionId, workDir: s.workDir, reused: true}));
            return
        }
        // desktop 没有打开任何窗口 → 明确告知微信「没有活跃的 session」
        res.writeHead(409);
        res.end(JSON.stringify({
            error: 'no_active_session',
            message: '当前没有活跃的 session，请先在桌面端打开一个项目会话'
        }))
        return
    }

    // ── GET /api/sessions —— 列出所有活跃 session ──
    // 功能说明: 返回网关内存中当前所有活跃 session 的摘要（id/工作目录/创建时间/连接数）
    // 关键数据流: GET → sessions Map → 200 {sessions: [...], total}
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
        const list = [...sessions.entries()].map(([id, s]) => ({
            id,
            workDir: s.workDir,
            createdAt: s.createdAt,
            clientCount: s.clients.size
        }));
        res.writeHead(200);
        res.end(JSON.stringify({sessions: list, total: list.length}));
        return
    }
    // ── GET /api/sessions/focused —— 获取当前聚焦 session ──
    // 功能说明: 返回当前 focusedSessionId 对应的 session 信息，无则 404
    //   用于外部模块（如 IM 适配器）判断当前是否有活跃的桌面会话
    // 关键数据流: GET → focusedSessionId 查找 → 200 {sessionId, workDir} 或 404
    if (req.method === 'GET' && url.pathname === '/api/sessions/focused') {
        if (focusedSessionId && sessions.has(focusedSessionId)) {
            const s = sessions.get(focusedSessionId);
            res.writeHead(200);
            res.end(JSON.stringify({sessionId: focusedSessionId, workDir: s.workDir}))
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'no focused session'}))
        }
        ;
        return
    }
    // ── POST /api/sessions/:id/focus —— 切换聚焦会话 ──
    // 功能说明: 多标签页切换时，通知 Gateway 更新 focusedSessionId，
    //   确保 IM 消息（微信/飞书/钉钉）注入到当前查看的标签页对应会话
    // 关键数据流: POST /api/sessions/:id/focus → focusedSessionId = sid → 200 {ok:true}
    if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/focus')) {
        const sid = url.pathname.split('/')[3]
        if (!sessions.has(sid)) { res.writeHead(404); res.end(JSON.stringify({error: 'session not found'})); return }
        focusedSessionId = sid
        res.writeHead(200); res.end(JSON.stringify({ok: true, focused: sid.slice(0, 8)}))
        return
    }
    // ── POST /api/desktop/nudge —— IM 控制命令中继到桌面端 ──
    // 功能说明: 微信/飞书/钉钉发送控制命令后，通过此接口将命令广播给所有 desktop WS 客户端
    //   桌面端收到 nudge 事件后执行对应 UI 操作（切换项目、新建 session、镜像开关、停止 agent）
    // body: { action: 'switch_project'|'new_session'|'switch_session'|'toggle_mirror'|'stop', args: {...}, source?: string }
    // 关键数据流: POST → 遍历 sessions → 广播给 source=desktop 的 WS → 200 {ok, delivered, nudgeId}
    if (req.method === 'POST' && url.pathname === '/api/desktop/nudge') {
        const body = await readBody(req)
        const nudge = {type: 'nudge', action: body.action, args: body.args || {}, nudgeId: crypto.randomUUID(), source: body.source || 'hook'}
        let delivered = false
        // 先发给控制通道（桌面端无 session 时也能收到）
        for (const ws of controlClients) {
            if (ws.readyState === 1) { ws.send(JSON.stringify(nudge)); delivered = true }
        }
        // 再发给所有 session 级的 desktop 客户端
        for (const [, s] of sessions) {
            for (const ws of s.clients) {
                if (ws._source === 'desktop' && ws.readyState === 1) { ws.send(JSON.stringify(nudge)); delivered = true }
            }
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, delivered, nudgeId: nudge.nudgeId}))
        return
    }

    const delM = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    // ── DELETE /api/sessions/:id —— 删除会话 ──
    // 功能说明: 删除指定 session，清理所有挂起的确认请求 + 关闭 query + 从 sessions Map 移除
    // 实现方式:
    //   1. ?deleteFiles=1 时删除对应的 .jsonl 文件（清理持久化对话记录）
    //   2. settlePending 所有挂起的确认请求（拒绝 + 标记为 'deleted'）
    //   3. pushStream.close() + query.return() 关闭 SDK query
    //   4. 从 sessions Map 删除 + 如为 focusedSessionId 则置空
    // 关键数据流: DELETE /api/sessions/:id → settlePending(all) → close query → delete session → 200 {ok:true}
    if (req.method === 'DELETE' && delM) {
        const id = delM[1];
        const s = sessions.get(id)
        // 先停 query（SDK 可能持有 .jsonl 文件句柄，Windows 下不先释放会导致 unlinkSync 失败）
        if (s) {
            for (const pid of [...(s.pending?.keys() || [])]) settlePending(id, pid, {
                behavior: 'deny',
                message: '会话已删除',
                interrupt: true
            }, 'deleted');
            try {
                s.pushStream?.close();
                s.query?.return?.()
            } catch {
            }
            // 关闭所有 WS 客户端连接，触发桌面端 onclose 清理 UI 状态
            for (const ws of [...s.clients]) {
                try { ws.close(4001, JSON.stringify({error: 'session deleted'})) } catch {}
            }
            ;sessions.delete(id); invalidateProjectsCache()
        }
        if (url.searchParams.get('deleteFiles') === '1') {
            try {
                for (const e of readdirSync(join(CLAUDE_HOME, 'projects'))) {
                    const c = join(CLAUDE_HOME, 'projects', e, id + '.jsonl');
                    if (existsSync(c)) {
                        unlinkSync(c);
                        break
                    }
                }
            } catch {
            }
        }
        if (focusedSessionId === id) focusedSessionId = null;
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        return
    }

    // ── 文件快照 Diff endpoints ──
    // GET /api/sessions/:id/files —— 文件树 + 改动状态
    const filesM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/files$/)
    if (req.method === 'GET' && filesM) {
        const s = sessions.get(filesM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const scan = scanWorkdirFiles(s.workDir)
        if (scan.missing) {
            res.writeHead(200);
            res.end(JSON.stringify({
                workDir: s.workDir,
                hasSnapshot: !!s.snapshot,
                missing: true,
                files: [],
                truncated: false
            }));
            return
        }
        let files
        if (s.snapshot) {
            const diffMap = diffSnapshotVsCurrent(s.snapshot, scan.files, s.workDir)
            files = [...diffMap.entries()].map(([path, d]) => {
                const cur = scan.files.find(f => f.path === path)
                return {
                    path,
                    size: cur?.size ?? 0,
                    binary: d.binary,
                    status: d.status,
                    added: d.added,
                    removed: d.removed
                }
            })
        } else {
            files = scan.files.map(f => ({
                path: f.path,
                size: f.size,
                binary: f.binary,
                status: 'unchanged',
                added: 0,
                removed: 0
            }))
        }
        res.writeHead(200);
        res.end(JSON.stringify({
            workDir: s.workDir,
            hasSnapshot: !!s.snapshot,
            snapshotAt: s.snapshot?.takenAt || null,
            truncated: scan.truncated,
            files
        }))
        return
    }
    // ── POST /api/sessions/:id/upload —— 文件上传 + 多模态路由 ──
    // 功能说明: 接收前端上传的图片/文件，保存到临时目录并根据当前模型能力做路由处理
    //   支持多模态的模型 → 返回路径供 SDK 直接传 image content block
    //   不支持多模态 → 使用 Tesseract.js OCR 提取文字
    const uploadM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/upload$/)
    if (req.method === 'POST' && uploadM) {
        const sid = uploadM[1]
        const s = sessions.get(sid)
        if (!s) { res.writeHead(404); res.end(JSON.stringify({error: 'session not found'})); return }
        try {
            const { fields, files } = await parseMultipart(req)
            const file = files?.file
            if (!file) { res.writeHead(400); res.end(JSON.stringify({error: 'no file'})); return }

            const uploadDir = join(s.workDir, '.bridge-uploads')
            mkdirSync(uploadDir, {recursive: true})
            const ext = pathExtname(file.filename || '') || '.png'
            const destName = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
            const destPath = join(uploadDir, destName)
            writeFileSync(destPath, file.data)

            // 检查当前模型是否支持多模态
            const modelName = s.queryOpts?.model || ''
            const isMultimodal = /claude|gpt-4o|gpt-5|gemini|haiku|sonnet|opus/i.test(modelName)

            if (isMultimodal) {
                // 多模态模型 → 返回相对路径，前端构造 image content block
                const relPath = relative(s.workDir, destPath)
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, path: relPath, multimodal: true}))
            } else {
                // 非多模态模型 → 尝试 OCR 提取文字
                let ocrText = ''
                try {
                    const { createWorker } = await import('tesseract.js')
                    const worker = await createWorker('eng')
                    const { data } = await worker.recognize(destPath)
                    ocrText = data.text || ''
                    await worker.terminate()
                } catch (ocrErr) {
                    log.warn({err: ocrErr, sessionId: sid?.slice(0, 8)}, 'OCR 失败，回退到文件路径引用')
                }
                if (ocrText.trim()) {
                    res.writeHead(200)
                    res.end(JSON.stringify({
                        ok: true, path: relative(s.workDir, destPath), multimodal: false,
                        ocrText: ocrText.trim()
                    }))
                } else {
                    const relPath = relative(s.workDir, destPath)
                    res.writeHead(200)
                    res.end(JSON.stringify({ok: true, path: relPath, multimodal: false}))
                }
            }
        } catch (e) {
            log.error({err: e, sessionId: sid?.slice(0, 8)}, '上传处理失败')
            res.writeHead(500); res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // GET /api/sessions/:id/file?path=xxx —— 当前文件内容
    const fileM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/file$/)
    if (req.method === 'GET' && fileM) {
        const s = sessions.get(fileM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const rel = url.searchParams.get('path') || ''
        const abs = resolveSafe(s.workDir, rel)
        if (!abs || !existsSync(abs)) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'not_found'}));
            return
        }
        if (isBinaryPath(rel)) {
            let size = 0;
            try {
                size = statSync(abs).size
            } catch {
            }
            ;res.writeHead(200);
            res.end(JSON.stringify({path: rel, binary: true, size}));
            return
        }
        let size = 0;
        try {
            size = statSync(abs).size
        } catch {
        }
        if (size > MAX_SNAP_FILE_BYTES) {
            res.writeHead(413);
            res.end(JSON.stringify({error: 'too_large', size}));
            return
        }
        try {
            const content = readFileSync(abs, 'utf8');
            res.writeHead(200);
            res.end(JSON.stringify({
                path: rel,
                binary: false,
                content,
                size,
                lines: content.length ? content.split('\n').length : 0
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // GET /api/sessions/:id/diff?path=xxx —— 文件变更 diff
    // old 优先用最新记录点的 before（和上版本对比），无记录点则用基线快照
    const diffM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/diff$/)
    if (req.method === 'GET' && diffM) {
        const s = sessions.get(diffM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const rel = url.searchParams.get('path') || ''
        const abs = resolveSafe(s.workDir, rel)
        if (!abs) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'bad_path'}));
            return
        }
        if (isBinaryPath(rel)) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, binary: true}));
            return
        }
        const snap = s.snapshot?.files?.get(rel)
        if (snap && (snap.tooLarge || snap.binary)) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, tooLarge: !!snap.tooLarge, binary: !!snap.binary}));
            return
        }
        const curExists = existsSync(abs)
        // old=快照内容（基线），new=当前磁盘
        const oldStr = snap?.content ?? ''
        let newStr = ''
        if (curExists) {
            try {
                newStr = readFileSync(abs, 'utf8')
            } catch {
            }
        }
        const status = !snap ? 'added' : (!curExists ? 'deleted' : (oldStr === newStr ? 'unchanged' : 'modified'))
        const result = computeLineDiff(oldStr, newStr)
        if (result.tooLarge) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, status, tooLarge: true}));
            return
        }
        const st = lineDiffStats(oldStr, newStr)
        res.writeHead(200);
        res.end(JSON.stringify({path: rel, status, added: st.added, removed: st.removed, lines: result.lines}))
        return
    }
    // POST /api/sessions/:id/snapshot —— 重置基线
    const snapM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshot$/)
    if (req.method === 'POST' && snapM) {
        const s = sessions.get(snapM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            s.snapshot = buildFileSnapshot(s.workDir)  // SIDE_EFFECT: mutates session.snapshot
            saveSnapshot(s, snapM[1])                   // 持久化基线，重启后仍有效
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, snapshotAt: s.snapshot.takenAt, fileCount: s.snapshot.files.size}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // POST /api/sessions/:id/save-and-snapshot { path, content } —— Monaco 保存后写文件并记录改动
    const saveSnapM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/save-and-snapshot$/)
    if (req.method === 'POST' && saveSnapM) {
        const s = sessions.get(saveSnapM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            const b = await readBody(req)
            if (!b.path || typeof b.content !== 'string') {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'path and content required'}));
                return
            }
            const abs = resolveSafe(s.workDir, b.path)
            if (!abs) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'bad_path'}));
                return
            }
            if (isBinaryPath(b.path)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'binary_file'}));
                return
            }
            // 1. 文件写前内容：优先读磁盘（本次修改前状态），磁盘无则取快照
            let beforeContent = null
            try {
                beforeContent = readFileSync(abs, 'utf8')
            } catch {
            }
            if (beforeContent === null) {
                const snapEntry = s.snapshot?.files?.get(b.path)
                if (snapEntry && !snapEntry.binary && !snapEntry.tooLarge && !snapEntry.readError && typeof snapEntry.content === 'string') {
                    beforeContent = snapEntry.content
                }
            }
            // 2. 写文件
            if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), {recursive: true})
            writeFileSync(abs, b.content, 'utf8')
            // 3. 计算行级 diff 统计
            const diffStats = lineDiffStats(beforeContent || '', b.content)
            // 4. 创建记录点（和 AI 改完文件的体验一致）
            if (!s.checkpoints) s.checkpoints = []
            s.checkpointSeq = (s.checkpointSeq || 0) + 1
            const fileStatus = beforeContent === null ? 'added' : 'modified'
            s.checkpoints.push({
                id: `cp-${s.checkpointSeq}`,
                prompt: '手动保存 ' + b.path,
                time: Date.now(),
                files: [{
                    path: b.path,
                    status: fileStatus,
                    before: beforeContent,
                    notRevertible: beforeContent === null,
                    added: diffStats.added,
                    removed: diffStats.removed,
                }],
                revertible: beforeContent !== null,  // 新增文件不可回退
            })
            saveCheckpoints(s, saveSnapM[1])
            // 快照条目更新为保存前内容（beforeContent），持久化。
            // 文件面板 diffSnapshotVsCurrent(snapshot, 磁盘) → beforeContent ≠ 磁盘 → diff 按钮始终可见。
            // diff 端点 oldStr=snapshot.content, newStr=磁盘 → "上一版 vs 当前"。
            // 重启后 loadSnapshot 读到 beforeContent，仍然 ≠ 磁盘 → diff 按钮不消失。
            if (!s.snapshot) s.snapshot = { takenAt: Date.now(), files: new Map(), truncated: false }
            if (beforeContent !== null) {
              s.snapshot.files.set(b.path, { binary: false, content: beforeContent, size: Buffer.byteLength(beforeContent, 'utf8'), lines: beforeContent.length ? beforeContent.split('\n').length : 0 })
            }
            s.snapshot.takenAt = Date.now()
            saveSnapshot(s, saveSnapM[1])
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                snapshotAt: s.snapshot.takenAt,
                fileCount: s.snapshot.files.size,
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // POST /api/mirror —— IM 命令专用：一次调用完成镜像查询/设置/翻转
    // body: { platform, action?: 'query'|'set'|'toggle', enabled? }
    if (req.method === 'POST' && url.pathname === '/api/mirror') {
        const b = await readBody(req)
        const platform = b.platform
        // 查询所有镜像状态
        if (!platform) {
            if (!focusedSessionId || !sessions.has(focusedSessionId)) {
                res.writeHead(200); res.end(JSON.stringify({ok: true, mirrors: {wechat: false, feishu: false, dingtalk: false}, hasSession: false})); return
            }
            const s = sessions.get(focusedSessionId)
            res.writeHead(200); res.end(JSON.stringify({ok: true, mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false}, hasSession: true})); return
        }
        if (!['wechat', 'feishu', 'dingtalk'].includes(platform)) { res.writeHead(400); res.end(JSON.stringify({error: 'bad platform'})); return }
        if (!focusedSessionId || !sessions.has(focusedSessionId)) {
            res.writeHead(200); res.end(JSON.stringify({ok: true, error: 'no_session', hasSession: false})); return
        }
        const s = sessions.get(focusedSessionId)
        s.mirrors = s.mirrors || {wechat: false, feishu: false, dingtalk: false}
        let enabled
        if (b.action === 'set') {
            enabled = !!b.enabled
        } else {
            // toggle → 翻转
            enabled = !s.mirrors[platform]
        }
        s.mirrors[platform] = enabled
        // nudge 桌面端同步按钮状态
        const nudge = {type: 'nudge', action: 'toggle_mirror', args: {platform, enabled}, nudgeId: crypto.randomUUID(), source: 'adapter'}
        for (const ws of controlClients) {
            if (ws.readyState === 1) ws.send(JSON.stringify(nudge))
        }
        for (const [, ss] of sessions) {
            for (const ws of ss.clients) {
                if (ws._source === 'desktop' && ws.readyState === 1) ws.send(JSON.stringify(nudge))
            }
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, platform, enabled})); return
    }

    // POST /api/sessions/:id/mirror { platform, enabled } —— 切换 IM 平台镜像同步开关
    // GET  /api/sessions/:id/mirror —— 查当前各平台镜像开关状态
    const mirrorM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/mirror$/)
    if (mirrorM) {
        const s = sessions.get(mirrorM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        if (req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false}}));
            return
        }
        if (req.method === 'POST') {
            const b = await readBody(req)
            if (!b.platform) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'platform required'}));
                return
            }
            s.mirrors = s.mirrors || {wechat: false, feishu: false, dingtalk: false}
            s.mirrors[b.platform] = !!b.enabled   // SIDE_EFFECT: mutates session.mirrors
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, platform: b.platform, enabled: s.mirrors[b.platform]}));
            return
        }
    }
    // POST /api/sessions/:id/commit —— 提交修改：以当前状态为新基线 + 清空所有记录点
    // 可选 body: { files?: string[] } —— 指定文件列表则仅提交这些文件，未指定的保持旧基线
    const commitM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commit$/)
    if (req.method === 'POST' && commitM) {
        const s = sessions.get(commitM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            const body = await readBody(req).catch(() => ({}))
            const selectedFiles = Array.isArray(body.files) && body.files.length > 0 ? new Set(body.files) : null

            if (selectedFiles && s.snapshot) {
                // 选择性提交：用 buildFileSnapshot 生成当前全量快照，保证内容与 diff 对比一致
                const fresh = buildFileSnapshot(s.workDir)
                const oldFiles = s.snapshot.files
                const merged = new Map()

                // 遍历旧基线：已提交文件 → 用 fresh 内容（匹配当前磁盘，diff 归零）；
                // 未提交文件 → 保留旧基线内容（diff 继续显示变更）
                for (const [path, oldEntry] of oldFiles) {
                    if (selectedFiles.has(path)) {
                        const newEntry = fresh.files.get(path)
                        if (newEntry) merged.set(path, newEntry)
                        // 文件已删除且被提交：不加入新基线，后续 diff 视为新增
                    } else {
                        merged.set(path, oldEntry)
                    }
                }
                // 追加旧基线中没有的新文件（selected 的才纳入基线，未选中的保持 added 状态）
                for (const [path, newEntry] of fresh.files) {
                    if (!merged.has(path) && selectedFiles.has(path)) {
                        merged.set(path, newEntry)
                    }
                }
                s.snapshot = {takenAt: Date.now(), truncated: fresh.truncated, files: merged}
            } else {
                // 全量提交：重建整个基线
                s.snapshot = buildFileSnapshot(s.workDir)   // SIDE_EFFECT: 新基线=当前
            }

            // 记录点处理：选择性提交时只移除已提交文件，保留仍有未提交文件的记录点
            if (selectedFiles) {
                const cps = s.checkpoints || []
                if (cps.length) {
                    const kept = []
                    for (const cp of cps) {
                        const remaining = cp.files.filter(f => !selectedFiles.has(f.path))
                        if (remaining.length === 0) continue  // 该记录点所有文件都已提交，移除
                        const stillRevertible = remaining.every(f => !f.notRevertible)
                        kept.push({...cp, files: remaining, revertible: stillRevertible})
                    }
                    s.checkpoints = kept
                }
            } else {
                s.checkpoints = []  // 全量提交：清空所有记录点
            }

            saveSnapshot(s, commitM[1])
            saveCheckpoints(s, commitM[1])
            // 提交不改磁盘文件，无需重建缓存（maybeUpdateProjectCache 已在回合结束时处理）
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                snapshotAt: s.snapshot.takenAt,
                fileCount: selectedFiles ? selectedFiles.size : s.snapshot.files.size,
                keptCheckpoints: selectedFiles ? (s.checkpoints || []).length : 0
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }

    // GET /api/sessions/:id/checkpoints —— 记录点列表（剥离 before 大文本，只回元信息）
    const cpM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/checkpoints$/)
    if (req.method === 'GET' && cpM) {
        const s = sessions.get(cpM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const list = (s.checkpoints || []).map(c => ({
            id: c.id, prompt: c.prompt, time: c.time, revertible: c.revertible,
            fileCount: c.files.length,
            added: c.files.reduce((n, f) => n + (f.added || 0), 0),
            removed: c.files.reduce((n, f) => n + (f.removed || 0), 0),
            files: c.files.map(f => ({
                path: f.path,
                status: f.status,
                notRevertible: !!f.notRevertible,
                added: f.added,
                removed: f.removed
            })),
        }))
        res.writeHead(200);
        res.end(JSON.stringify({checkpoints: list}));
        return
    }
    // POST /api/sessions/:id/rewind { checkpointId, dryRun? } —— 回退到记录点之前
    const rwM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rewind$/)
    if (req.method === 'POST' && rwM) {
        const s = sessions.get(rwM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const b = await readBody(req)
        if (!b.checkpointId) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'checkpointId required'}));
            return
        }
        const r = rewindToCheckpoint(s, rwM[1], b.checkpointId, !!b.dryRun)  // SIDE_EFFECT: 写工作目录文件
        // 撤回后增量更新缓存（仅重提取被还原的文件）
        if (!b.dryRun && r.ok && r.reverted?.length) {
            try {
                const cache = loadProjectCache(s.workDir)
                if (cache) {
                    // 构造简易 diffMap：所有被还原文件标为 modified 强制重提取
                    const diffMap = new Map()
                    for (const path of r.reverted) {
                        diffMap.set(path, {status: 'modified', binary: false})
                    }
                    await updateProjectCache(s.workDir, cache, diffMap)
                    saveProjectCache(s.workDir, cache)
                } else {
                    const newCache = await buildProjectCache(s.workDir)
                    if (newCache) saveProjectCache(s.workDir, newCache)
                }
            } catch (e) {
                log.warn({err: e, sessionId: rwM[1]?.slice(0, 8)}, 'rewind 后缓存更新失败')
            }
        }
        res.writeHead(r.ok ? 200 : 404);
        res.end(JSON.stringify(r));
        return
    }

    // ── Config endpoints ──

    // ── /api/config/settings —— Claude Code 配置文件 CRUD ──
    // 功能说明: GET 读取 ~/.claude/settings.json；PUT 全量写入（写入前自动 .bak 备份）
    // 关键数据流: GET → readJSON → 200 配置对象 / 404
    //   PUT → backupFile → writeJSON → 200 {ok:true}
    if (url.pathname === '/api/config/settings') {
        const sp = join(CLAUDE_HOME, 'settings.json');
        if (req.method === 'GET') {
            const d = readJSON(sp);
            if (d) {
                res.writeHead(200);
                res.end(JSON.stringify(d))
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                backupFile(sp);
                writeJSON(sp, b);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── Claude Code 安装状态查询（前端弹窗用）──
    // ── GET /api/version —— 返回 Gateway 版本号 ──
    if (req.method === 'GET' && url.pathname === '/api/version') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({version: PKG_VERSION}));
        return
    }
    // ── GET /api/config/claude-status —— Claude Code 安装状态查询 ──
    // 功能说明: 前端弹窗用，检测本地是否安装了 Claude Code 可执行文件
    // 实现方式: 支持 ?path= 查询参数手动指定路径；无参数时调用 getClaudeExe() 多级回退查找
    // 关键数据流: GET → getClaudeExe() 或存在性检查 → 200 {found:bool, path:...}
    if (req.method === 'GET' && url.pathname === '/api/config/claude-status') {
        const qPath = url.searchParams.get('path')
        let foundPath = null
        if (qPath) {
            foundPath = existsSync(qPath) ? qPath : null
        } else {
            foundPath = getClaudeExe()
        }
        res.writeHead(200);
        res.end(JSON.stringify({found: !!foundPath, path: foundPath || null}));
        return
    }
    // ── POST /api/config/claude-path —— 手动设置 Claude Code 路径 ──
    // 功能说明: 前端弹窗中用户手动输入路径，校验后保存到 settings.json
    // 实现方式: 校验路径文件是否存在 → 写入 cliS.claudeExe → 保存 settings.json → 返回结果
    // 关键数据流: POST {path} → existsSync → writeJSON settings.json → 200 {found, path}
    if (req.method === 'POST' && url.pathname === '/api/config/claude-path') {
        try {
            const b = await readBody(req)
            const p = (b.path || '').trim()
            if (!p) {
                res.writeHead(400);
                res.end(JSON.stringify({ok: false, error: 'path required'}));
                return
            }
            if (!existsSync(p)) {
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, found: false, path: p, error: '文件不存在'}));
                return
            }
            const cliS = loadCliSettings()
            cliS.claudeExe = p
            backupFile(join(CLAUDE_HOME, 'settings.json'))
            writeJSON(join(CLAUDE_HOME, 'settings.json'), cliS)
            _exe = p // 更新缓存
            log.info({path: p}, '用户手动设置 claudeExe')
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, found: true, path: p}));
            return
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ok: false, error: e.message}));
            return
        }
    }
    // ── GET /api/config/skills —— 列出所有 Skills ──
    // 功能说明: 扫描 ~/.claude/skills/ 目录下所有 SKILL.md，解析 frontmatter 返回名称/描述/内容
    // 实现方式: readdirSync → forEach 读 SKILL.md → parseFrontmatter 提取元数据
    // 关键数据流: skills/ 目录 → 遍历读 SKILL.md → 200 {skills: [{name, description, content, size}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills') {
        const sd = join(CLAUDE_HOME, 'skills');
        const r = [];
        const builtinNames = new Set(builtinCache.skills);
        const seen = new Set();
        try {
            for (const n of readdirSync(sd)) {
                try {
                    const c = readFileSync(join(sd, n, 'SKILL.md'), 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const name = fm.name || n;
                    seen.add(name);
                    r.push({
                        name,
                        description: fm.description || '',
                        allowedTools: fm['allowed-tools'] || '',
                        content: c,
                        size: c.length,
                        source: 'custom'
                    })
                } catch {
                }
            }
        } catch {
        }
        ;
        for (const bn of builtinCache.skills) {
            if (!seen.has(bn)) r.push({
                name: bn,
                description: '',
                allowedTools: '',
                content: null,
                size: 0,
                source: 'builtin'
            })
        }
        ;res.writeHead(200);
        res.end(JSON.stringify({skills: r}));
        return
    }
    const skillM = url.pathname.match(/^\/api\/config\/skills\/(.+)$/);
    if (skillM) {
        const sn = decodeURIComponent(skillM[1]);
        const sp = join(CLAUDE_HOME, 'skills', sn, 'SKILL.md');
        if (req.method === 'GET') {
            try {
                const c = readFileSync(sp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({name: fm.name || sn, description: fm.description || '', content: c}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(sp))) mkdirSync(dirname(sp), {recursive: true});
                backupFile(sp);
                writeFileSync(sp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        // ── DELETE /api/config/skills/:name —— 删除 Skill 目录 ──
        // 仅已禁用的 skill 可删除（防止误删正在使用的 skill）
        if (req.method === 'DELETE') {
            try {
                const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
                if (!(s.disabledSkills || []).includes(sn)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '请先禁用再删除'}))
                    return
                }
                const sd = join(CLAUDE_HOME, 'skills', sn)
                if (existsSync(sd)) { backupFile(sd); rmdirSync(sd, {recursive: true}) }
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/skills —— 创建新 Skill ──
    // 功能说明: 在 ~/.claude/skills/ 下创建新的 SKILL.md，名称自动 sanitize 为小写+连字符
    //   已存在则返回 409
    // 关键数据流: POST {name, content?} → mkdir + writeFile → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/skills') {
        try {
            const b = await readBody(req);
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
                return
            }
            ;const d = join(CLAUDE_HOME, 'skills', n);
            if (existsSync(d)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            ;mkdirSync(d, {recursive: true});
            writeFileSync(join(d, 'SKILL.md'), b.content || `---\nname: ${n}\ndescription: \n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── GET /api/config/disabled-skills —— 获取已禁用的 skill 名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-skills') {
        const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledSkills || []}))
        return
    }
    // ── POST /api/config/disabled-skills —— 切换 skill 启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-skills') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
            if (!s.disabledSkills) s.disabledSkills = []
            if (b.disabled) {
                if (!s.disabledSkills.includes(name)) s.disabledSkills.push(name)
            } else {
                s.disabledSkills = s.disabledSkills.filter((n) => n !== name)
            }
            writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
        return
    }
    // ── GET /api/config/disabled-mcp-plugins —— 获取已禁用的 MCP 插件名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-mcp-plugins') {
        const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledMcpPlugins || []}))
        return
    }
    // ── POST /api/config/disabled-mcp-plugins —— 切换 MCP 插件启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-mcp-plugins') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
            if (!s.disabledMcpPlugins) s.disabledMcpPlugins = []
            if (b.disabled) {
                if (!s.disabledMcpPlugins.includes(name)) s.disabledMcpPlugins.push(name)
            } else {
                s.disabledMcpPlugins = s.disabledMcpPlugins.filter((n) => n !== name)
            }
            writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
        return
    }
    // ── GitHub raw 下载（多镜像回退）──
    // raw.githubusercontent.com 国内常被墙，jsdelivr CDN 优先
    async function fetchRawGithub(owner, repo, ref, filePath) {
        const urls = [
            `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`,
            `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
            `https://mirror.ghproxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
        ]
        for (const u of urls) {
            try {
                const r = await fetch(u, {signal: AbortSignal.timeout(8000)})
                if (r.ok) { log.info({url: u}, 'fetchRawGithub 成功'); return r }
            } catch {}
        }
        log.warn({owner, repo, ref, filePath}, 'fetchRawGithub 所有镜像均失败')
        return null
    }

    // ── GET /api/config/skills-market?q=xxx —— 多源搜索 Skills ──
    // 来源: skills.sh + GitHub Code Search (SKILL.md)
    // 返回: {results: [{name, description, url, source, stars?}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills-market') {
        const q = url.searchParams.get('q') || ''
        if (!q.trim()) { res.writeHead(200); res.end(JSON.stringify({results: []})); return }
        const results = []

        // ── 源 1: skills.sh ──
        try {
            const apiUrl = `https://skills.sh/api/search?q=${encodeURIComponent(q.trim())}`
            const resp = await fetch(apiUrl, {signal: AbortSignal.timeout(10000)})
            if (resp.ok) {
                const data = await resp.json()
                for (const item of (data.results || data || []).slice(0, 10)) {
                    results.push({
                        name: item.name || item.id || '',
                        description: item.description || item.summary || '',
                        url: item.url || item.downloadUrl || item.rawUrl || '',
                        source: 'skills.sh',
                        stars: item.stars,
                    })
                }
            }
        } catch { /* skills.sh 不可达，继续其他源 */ }

        // ── 源 2: GitHub Code Search (SKILL.md 文件) ──
        try {
            const ghQuery = encodeURIComponent(`SKILL.md ${q.trim()} in:file language:markdown`)
            const ghUrl = `https://api.github.com/search/code?q=${ghQuery}&per_page=10`
            const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'claude-desktop-bridge' }
            const ghResp = await fetch(ghUrl, {headers, signal: AbortSignal.timeout(10000)})
            if (ghResp.ok) {
                const ghData = await ghResp.json()
                for (const item of (ghData.items || [])) {
                    const repoFull = item.repository?.full_name || ''
                    const path = item.path || ''
                    // 从 path 提取 skill 名称 (skills/<name>/SKILL.md 或 <name>/SKILL.md)
                    const parts = path.replace(/\/SKILL\.md$/i, '').split('/')
                    const skillName = parts[parts.length - 1]
                    const rawUrl = `https://raw.githubusercontent.com/${repoFull}/main/${path}`
                    const name = repoFull ? `${repoFull}/${skillName}` : skillName
                    if (results.find(r => r.url === rawUrl)) continue  // 去重
                    results.push({
                        name,
                        description: `GitHub: ${repoFull} — ${path}`,
                        url: rawUrl,
                        source: 'github',
                        stars: item.repository?.stargazers_count,
                    })
                }
            }
        } catch { /* GitHub 不可达 */ }

        // ── 源 3: npm registry (关键词 claude-code-skill) ──
        try {
            const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q.trim())}+keywords:claude-code-skill&size=10`
            const npmResp = await fetch(npmUrl, {signal: AbortSignal.timeout(10000)})
            if (npmResp.ok) {
                const npmData = await npmResp.json()
                for (const obj of (npmData.objects || [])) {
                    const pkg = obj.package || {}
                    const repoUrl = pkg.links?.repository || ''
                    const rawUrl = repoUrl
                        ? repoUrl.replace('github.com', 'raw.githubusercontent.com').replace(/\/tree\//, '/') + '/main/SKILL.md'
                        : ''
                    if (!rawUrl || results.find(r => r.url === rawUrl)) continue
                    results.push({
                        name: pkg.name,
                        description: pkg.description || '',
                        url: rawUrl,
                        source: 'npm',
                        version: pkg.version,
                    })
                }
            }
        } catch { /* npm 不可达 */ }

        res.writeHead(200)
        res.end(JSON.stringify({results: results.slice(0, 30)}))
        return
    }
    // ── POST /api/config/skills-market/install —— 从 URL 安装 skill ──
    // 支持: 原始 SKILL.md URL / GitHub 各种链接
    if (req.method === 'POST' && url.pathname === '/api/config/skills-market/install') {
        try {
            const b = await readBody(req)
            const rawUrl = (b.url || '').trim()
            const name = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!rawUrl || !name) { res.writeHead(400); res.end(JSON.stringify({error: 'url and name required'})); return }

            let resp = null

            // ── 情况 1: github.com/owner/repo (裸 repo URL) ──
            const bareRepo = rawUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
            if (bareRepo) {
                const [_, owner, repo] = bareRepo
                // 尝试多种可能的 SKILL.md 路径
                const candidates = [
                    `skills/${name}/SKILL.md`,
                    `SKILL.md`,
                    `${name}/SKILL.md`,
                ]
                for (const fp of candidates) {
                    resp = await fetchRawGithub(owner, repo, 'main', fp)
                    if (resp) break
                }
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `仓库 ${owner}/${repo} 中未找到 SKILL.md，尝试路径: ${candidates.join(', ')}`}))
                    return
                }
            }

            // ── 情况 2: github.com/owner/repo/blob/<ref>/<path> ──
            const blobUrl = rawUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
            if (!resp && blobUrl) {
                resp = await fetchRawGithub(blobUrl[1], blobUrl[2], blobUrl[3], blobUrl[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法从 ${blobUrl[1]}/${blobUrl[2]} 下载 ${blobUrl[4]}`}))
                    return
                }
            }

            // ── 情况 3: raw.githubusercontent.com / cdn.jsdelivr.net 等直链 ──
            const rawGitHub = rawUrl.match(/^https?:\/\/(?:raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh|mirror\.ghproxy\.com\/https?\/raw\.githubusercontent\.com)\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
            if (!resp && rawGitHub) {
                resp = await fetchRawGithub(rawGitHub[1], rawGitHub[2], rawGitHub[3], rawGitHub[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法下载 ${rawGitHub[4]}，所有镜像均失败`}))
                    return
                }
            }

            // ── 情况 4: 其他直链 URL ──
            if (!resp) {
                try { resp = await fetch(rawUrl, {signal: AbortSignal.timeout(30000)}) } catch {}
            }

            if (!resp || !resp.ok) { res.writeHead(502); res.end(JSON.stringify({error: `下载失败 ${resp?.status || '网络不可达'}`})); return }
            const content = await resp.text()
            if (!content.trim()) { res.writeHead(502); res.end(JSON.stringify({error: '下载内容为空'})); return }

            // ── 校验: 拒绝非 SKILL.md 内容（GitHub HTML 页面等）──
            if (!content.includes('---') && content.includes('<!DOCTYPE')) {
                res.writeHead(502)
                res.end(JSON.stringify({error: '下载内容非 SKILL.md（可能是 GitHub 页面），请提供原始文件直链'}))
                return
            }

            const d = join(CLAUDE_HOME, 'skills', name)
            mkdirSync(d, {recursive: true})
            writeFileSync(join(d, 'SKILL.md'), content, 'utf8')
            log.info({name}, 'skill 已从市场安装')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'skill 安装失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message || '安装失败'}))
        }
        return
    }
    // ── GET/PUT /api/config/caveman —— Caveman 压缩模式配置 ──
    // 功能说明: GET 读取 Caveman 配置 + 版本信息；PUT 全量写入
    if (url.pathname === '/api/config/caveman') {
        if (req.method === 'GET') {
            res.writeHead(200)
            res.end(JSON.stringify({
                ...loadCavemanConfig(),
                cavemanCurrent: dynamicCache.cavemanCurrent || null,
                cavemanUpdate: dynamicCache.cavemanUpdate || null,
                releases: dynamicCache.cavemanReleases || [],
            }))
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                const level = (b.level || 'full').trim()
                if (!CAVEMAN_VALID_LEVELS.includes(level)) {
                    res.writeHead(400)
                    res.end(JSON.stringify({error: `无效级别，支持: ${CAVEMAN_VALID_LEVELS.join(', ')}`}))
                    return
                }
                saveCavemanConfig({enabled: !!b.enabled, level})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/caveman/update —— 下载并替换 Caveman SKILL.md ──
    if (req.method === 'POST' && url.pathname === '/api/config/caveman/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceCaveman(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'Caveman 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    // ── GET/PUT /api/config/rtk —— RTK Bash 压缩配置 ──
    // 功能说明: GET 返回 rtk 配置 + 版本更新信息 + 可用版本列表；PUT 全量写入 enabled
    //   配置存 settings.json → bashCompress: {enabled}
    //   版本存 dynamicCache → rtkUpdate + rtkReleases
    // 关键数据流: GET → loadRtkConfig() + dynamicCache → 200 {enabled, rtkAvailable, rtkUpdate, releases}
    //   PUT {enabled} → saveRtkConfig → 200 {ok:true}
    if (url.pathname === '/api/config/rtk') {
        if (req.method === 'GET') {
            const cfg = loadRtkConfig()
            const rtkPath = locateRtk()
            res.writeHead(200)
            res.end(JSON.stringify({
                enabled: cfg.enabled,
                rtkAvailable: !!rtkPath,
                rtkCurrent: dynamicCache.rtkCurrent || null,
                rtkUpdate: dynamicCache.rtkUpdate || null,
                releases: dynamicCache.rtkReleases || [],
            }))
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                saveRtkConfig({enabled: !!b.enabled})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/rtk/update —— 下载并替换 RTK 二进制 ──
    // 功能说明: 从 GitHub 下载指定版本 → 解压 → 替换本地二进制 + version.txt
    //   仅管理员操作；下载约 120s 超时
    // 关键数据流: POST {version: "v0.42.4"} → downloadAndReplaceRtk → 200 {ok, version}
    if (req.method === 'POST' && url.pathname === '/api/config/rtk/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceRtk(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'RTK 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    // ── GET /api/config/hooks —— 列出所有 Hooks ──
    // 功能说明: 从 settings.json 中读取 hooks 配置，同时读取 ~/.claude/hooks/ 下对应的脚本文件内容
    //   返回按事件类型分组的 hooks 列表，每个 hook 包含对应的脚本文件内容
    // 实现方式: readJSON settings.json → 提取 hooks 字段 → 遍历匹配 hooks 目录下实际脚本 → 嵌入 content
    // 关键数据流: settings.json hooks → 匹配 hooks/ 目录文件 → 200 {hooks: {eventType: [{matcher, hooks:[{command, filename, content}]}]}}
    if (req.method === 'GET' && url.pathname === '/api/config/hooks') {
        const hp = join(CLAUDE_HOME, 'settings.json');
        const hd = join(CLAUDE_HOME, 'hooks');
        const hooks = {};
        try {
            const s = readJSON(hp);
            if (s?.hooks) {
                for (const [et, entries] of Object.entries(s.hooks)) {
                    hooks[et] = entries.map(e => ({
                        matcher: e.matcher || '*',
                        timeout: e.timeout || 0,
                        source: 'custom',
                        hooks: (e.hooks || []).map(h => {
                            const fn = basename(h.command?.split(/\s+/).pop() || '');
                            let c = '';
                            try {
                                c = readFileSync(join(hd, fn), 'utf8')
                            } catch {
                            }
                            ;
                            return {...h, filename: fn, content: c, source: 'custom'}
                        })
                    }))
                }
            }
        } catch {
        }
        ;res.writeHead(200);
        res.end(JSON.stringify(hooks));
        return
    }
    const hookFileM = url.pathname.match(/^\/api\/config\/hooks\/([^/]+)$/);
    if (hookFileM) {
        const fn = decodeURIComponent(hookFileM[1]);
        const fp = join(CLAUDE_HOME, 'hooks', fn);
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/hooks —— 创建新 Hook 脚本 ──
    // 功能说明: 在 ~/.claude/hooks/ 下创建新的 .sh 或 .js 脚本文件，文件名自动 sanitize
    //   默认填充 #!/usr/bin/env bash + set -euo pipefail 模板
    // 关键数据流: POST {filename, content?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/hooks') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-hook').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.sh') && !fn.endsWith('.js')) fn += '.sh';
            const fp = join(CLAUDE_HOME, 'hooks', fn);
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            ;writeFileSync(fp, b.content || '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── 内置 Rules 名称集合（与项目 CLAUDE.md 模板一起发布的规则）──
    const BUILTIN_RULES = new Set([
        'avalonia', 'c', 'csharp', 'java', 'vue',
        'reactivity', 'security', 'testing',
        'coding-style',
    ])
    // ── 递归扫描 rules/ 目录下所有 .md 文件 ──
    function scanRulesDir(dir, baseDir, result) {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                scanRulesDir(full, baseDir, result);
            } else if (entry.name.endsWith('.md')) {
                try {
                    const c = readFileSync(full, 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const relPath = relative(baseDir, full).replace(/\\/g, '/');
                    const stem = entry.name.replace(/\.md$/, '');
                    const isBuiltin = BUILTIN_RULES.has(stem);
                    result.push({filename: relPath, content: c, frontmatter: fm, size: c.length, source: isBuiltin ? 'builtin' : 'custom'})
                } catch {
                }
            }
        }
    }
    // ── GET /api/config/rules —— 列出所有 Rules ──
    // 功能说明: 递归扫描 ~/.claude/rules/ 目录下所有 .md 文件，解析 frontmatter 返回源数据
    //   Rules 为按文件扩展名匹配注入的编码规范
    // 关键数据流: rules/ 目录 → 遍历 .md → parseFrontmatter → 200 {rules: [{filename, content, frontmatter}]}
    if (req.method === 'GET' && url.pathname === '/api/config/rules') {
        const rd = join(CLAUDE_HOME, 'rules');
        const r = [];
        try { scanRulesDir(rd, rd, r); } catch {}
        res.writeHead(200);
        res.end(JSON.stringify({rules: r}));
        return
    }
    const ruleM = url.pathname.match(/^\/api\/config\/rules\/(.+)$/);
    if (ruleM) {
        let fn = decodeURIComponent(ruleM[1]);
        // 防止路径穿越
        if (fn.includes('..')) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid filename'})); return }
        const fp = join(CLAUDE_HOME, 'rules', fn);
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, frontmatter: fm, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        if (req.method === 'DELETE') {
            try {
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/rules —— 创建新 Rule ──
    // 功能说明: 在 ~/.claude/rules/ 下创建新的 .md 规则文件，文件名自动 sanitize
    //   默认模板包含 paths frontmatter 配置
    // 关键数据流: POST {filename, content?, paths?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/rules') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-rule').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.md')) fn += '.md';
            const fp = join(CLAUDE_HOME, 'rules', fn);
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            ;writeFileSync(fp, b.content || `---\npaths: "${b.paths || '**/*.*'}"\n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── Agents CRUD（~/.claude/agents/<name>.md，frontmatter: name/description/tools/model）──
    if (req.method === 'GET' && url.pathname === '/api/config/agents') {
        const ad = join(CLAUDE_HOME, 'agents');
        const r = [];
        const seen = new Set()
        try {
            for (const fn of readdirSync(ad)) {
                if (!fn.endsWith('.md')) continue
                try {
                    const c = readFileSync(join(ad, fn), 'utf8')
                    const {frontmatter: fm} = parseFrontmatter(c)
                    const name = fm.name || fn.replace(/\.md$/, '')
                    seen.add(name)
                    const isBuiltin = Array.isArray(dynamicCache.agentNames) && dynamicCache.agentNames.includes(name)
                    r.push({
                        filename: fn,
                        name,
                        description: fm.description || '',
                        type: fm.type || '',
                        language: fm.language || '',
                        tools: fm.tools || '',
                        model: fm.model || 'inherit',
                        content: c,
                        size: c.length,
                        loaded: isBuiltin,
                        source: 'custom'
                    }) // 有磁盘文件的始终是自定义
                } catch {
                }
            }
        } catch {
        }
        if (Array.isArray(builtinCache.agents)) {
            for (const an of builtinCache.agents) {
                if (!seen.has(an)) r.push({
                    filename: '',
                    name: an,
                    type: BUILTIN_AGENT_TYPES[an] || '',
                    description: '',
                    tools: '',
                    model: 'inherit',
                    content: null,
                    size: 0,
                    loaded: true,
                    source: 'builtin'
                })
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({agents: r}));
        return
    }
    const agentM = url.pathname.match(/^\/api\/config\/agents\/(.+)$/)
    if (agentM) {
        const an = decodeURIComponent(agentM[1]).replace(/\.md$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
        const fp = join(CLAUDE_HOME, 'agents', an + '.md')
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({
                    name: fm.name || an,
                    description: fm.description || '',
                    tools: fm.tools || '',
                    model: fm.model || 'inherit',
                    content: c
                }))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        if (req.method === 'DELETE') {
            try {
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/agents —— 创建新 Agent ──
    // 功能说明: 在 ~/.claude/agents/ 下创建新的 .md 文件，名称自动 sanitize
    //   默认 frontmatter 模板: tools 留空 = 继承全部工具，model 默认 inherit
    // 关键数据流: POST {name, description?, tools?, model?} → writeFileSync → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/agents') {
        try {
            const b = await readBody(req)
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
                return
            }
            const ad = join(CLAUDE_HOME, 'agents');
            if (!existsSync(ad)) mkdirSync(ad, {recursive: true})
            const fp = join(ad, n + '.md')
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            // 默认 frontmatter 模板：tools 留空表示继承全部工具
            const lang = b.language || ''
            const tpl = b.content || `---\nname: ${n}\ntype: ${b.type || ''}\nlanguage: ${lang}\ndescription: ${b.description || ''}\ntools: ${b.tools || ''}\nmodel: ${b.model || 'inherit'}\n---\n\n`
            writeFileSync(fp, tpl, 'utf8')
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}));
            return
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}));
            return
        }
    }

    // 动态模型列表：活跃 query 调 supportedModels()，缓存供冷启动；拿不到回退缓存
    // ── GET /api/config/models —— 动态模型列表 ──
    // 功能说明: 通过活跃 query 调用 supportedModels() 获取模型列表（含 value/displayName/description）
    //   有活跃 query 时实时获取并刷新缓存；没有则回退到 dynamicCache 缓存的模型数据
    // 实现方式: getLiveQuery() → withTimeout(q.supportedModels(), 5s) → 更新 dynamicCache + 持久化
    //   5 秒超时保护防止 hang；冷启动无活跃 query 时用磁盘/内存缓存
    // 关键数据流: GET → getLiveQuery() → supportedModels() → dynamicCache.models 更新 + 持久化 → 200 {models, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/models') {
        const q = getLiveQuery()
        if (q) {
            try {
                const models = await withTimeout(q.supportedModels(), 5000)  // [{value,displayName,description}]
                if (Array.isArray(models) && models.length) {
                    dynamicCache.models = models;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedModels 失败')
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({models: dynamicCache.models || [], live: !!q, cachedAt: dynamicCache.updatedAt}));
        return
    }
    // OpenAI 兼容供应商(DeepSeek/OpenAI)的真实模型列表：用配置的 key 调其 /models 接口
    // ── GET /api/config/live-models —— OpenAI 兼容供应商真实模型列表 ──
    // 功能说明: 用配置的 baseUrl+apiKey 调供应商的 /models 接口获取真实可用的模型 ID 列表
    //   支持 ?baseUrl=&apiKey= 查询参数覆盖全局配置（切换供应商时前端传对应凭据）
    // 实现方式: 不同供应商 models 端点位置不同，按 baseUrl 特征判断
    //   8 秒超时保护；失败返回 {models:[], error:...}
    // 关键数据流: GET ?baseUrl=X&apiKey=Y → 判断供应商 → fetch models 端点 → 解析 data[] → 200 {models, source}
    if (req.method === 'GET' && url.pathname === '/api/config/live-models') {
        try {
            const cliS = loadCliSettings()
            const qBaseUrl = url.searchParams.get('baseUrl') || ''
            const qApiKey = url.searchParams.get('apiKey') || ''
            const baseUrl = qBaseUrl || process.env.ANTHROPIC_BASE_URL || cliS.env?.ANTHROPIC_BASE_URL || ''
            const key = qApiKey || process.env.ANTHROPIC_API_KEY || cliS.env?.ANTHROPIC_AUTH_TOKEN || ''
            if (!baseUrl || !key) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: 'no_creds'}));
                return
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (baseUrl.includes('dashscope.aliyuncs.com')) {
                // 阿里云百炼：Anthropic 端点 /apps/anthropic，models 在 /compatible-mode/v1/models
                modelsUrl = baseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else {
                // DeepSeek/智谱/Moonshot 等：Anthropic 端点在根路径 /anthropic，models 在 /models
                modelsUrl = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            const r = await fetch(modelsUrl, {
                headers: {Authorization: `Bearer ${key}`},
                signal: AbortSignal.timeout(8000)
            })
            if (!r.ok) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: `http_${r.status}`}));
                return
            }
            const d = await r.json()
            const models = (d.data || []).map(m => ({value: m.id, displayName: m.id}))
            res.writeHead(200);
            res.end(JSON.stringify({models, source: modelsUrl}));
            return
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({models: [], error: String(e?.message || e)}));
            return
        }
    }
    // 供应商连接测试：用前端传的 baseUrl+apiKey 调 /models 验证连通性
    // ── GET /api/config/test-model —— 供应商连接测试 ──
    // 功能说明: 用前端传的 baseUrl+apiKey 调供应商 /models 接口验证连通性
    //   返回 ok 状态 + 可选的前 10 个模型 ID 列表，失败时返回 HTTP 状态码和响应摘要
    // 关键数据流: GET ?baseUrl=X&apiKey=Y → fetch {origin}/models → 200 {ok:true, count, list} 或 {ok:false, error}
    if (req.method === 'GET' && url.pathname === '/api/config/test-model') {
        try {
            const qBaseUrl = url.searchParams.get('baseUrl') || ''
            const qApiKey = url.searchParams.get('apiKey') || ''
            if (!qBaseUrl || !qApiKey) {
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: 'missing baseUrl or apiKey'}));
                return
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (qBaseUrl.includes('dashscope.aliyuncs.com')) {
                modelsUrl = qBaseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else {
                modelsUrl = qBaseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            const r = await fetch(modelsUrl, {
                headers: {Authorization: `Bearer ${qApiKey}`},
                signal: AbortSignal.timeout(10000)
            })
            if (!r.ok) {
                let detail = `HTTP ${r.status}`
                try {
                    const b = await r.text();
                    if (b) detail += ` — ${b.slice(0, 200)}`
                } catch {
                }
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: detail}));
                return
            }
            const d = await r.json()
            const count = Array.isArray(d.data) ? d.data.length : 0
            const list = Array.isArray(d.data) ? d.data.slice(0, 10).map(m => m.id) : []
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, count, list, source: modelsUrl}));
            return
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({ok: false, error: String(e?.message || e)}));
            return
        }
    }
    // 动态斜杠命令列表：活跃 query 调 supportedCommands()，缓存供冷启动
    // ── GET /api/config/commands —— 动态斜杠命令列表 ──
    // 功能说明: 通过活跃 query 调用 supportedCommands() 获取 Claude Code 内置命令列表
    //   有活跃 query 时实时获取并刷新缓存；没有则回退 dynamicCache 或 BUILTIN_COMMANDS 兜底列表
    // 实现方式: getLiveQuery() → withTimeout(q.supportedCommands(), 5s) → 更新 dynamicCache + 持久化
    //   兜底: BUILTIN_COMMANDS 含 20 个常见命令（help/clear/compact/config/cost/review 等）
    // 关键数据流: GET → getLiveQuery() → supportedCommands() → commands 列表 || BUILTIN_COMMANDS → 200 {commands, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/commands') {
        const q = getLiveQuery();
        if (q) {
            try {
                const cmds = await withTimeout(q.supportedCommands(), 5000);
                if (Array.isArray(cmds) && cmds.length) {
                    dynamicCache.commands = cmds;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedCommands 失败')
            }
        }
        ;const commandsList = (dynamicCache.commands?.length ? dynamicCache.commands : null) || BUILTIN_COMMANDS;
        const builtin = commandsList.map(c => ({...c, source: 'builtin'}));
        const custom = IM_CUSTOM_COMMANDS.map(c => ({...c, source: 'custom'}));
        const tagged = [...builtin, ...custom];
        res.writeHead(200);
        res.end(JSON.stringify({commands: tagged, live: !!q, cachedAt: dynamicCache.updatedAt}));
        return
    }


    // ── GET/PUT /api/config/workflow-settings —— 全局 Workflow 开关 ──
    if (url.pathname === '/api/config/workflow-settings') {
        if (req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify(loadWfConfig()));
            return
        }
        if (req.method === 'PUT') {
            const b = await readBody(req);
            saveWfConfig({enabled: !!b.enabled});
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}));
            return
        }
    }

    // ── GET /api/config/providers —— AI 供应商预设列表 ──
    // 功能说明: 返回内置的 AI 供应商预设（DeepSeek/Anthropic/OpenAI），含 baseUrl、模型列表、定价信息
    //   前端设置页的供应商选择器依赖此接口
    // 关键数据流: GET → 硬编码预设 → 200 {providers: [{id, name, baseUrl, models, pricing}]}
    if (req.method === 'GET' && url.pathname === '/api/config/providers') {
        res.writeHead(200);
        res.end(JSON.stringify({
            providers: [
                {
                    id: 'deepseek', name: 'DeepSeek', icon: 'D',
                    baseUrl: 'https://api.deepseek.com/anthropic',
                    officialUrl: 'https://platform.deepseek.com',
                    docsUrl: 'https://api-docs.deepseek.com',
                    models: [
                        {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
                        {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: '256K'},
                        {id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
                        {id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: '128K'},
                    ],
                    pricing: {input: '4 CNY/1M tokens', output: '16 CNY/1M tokens'},
                },
                {
                    id: 'zhipu', name: '智谱AI', icon: 'Z',
                    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
                    officialUrl: 'https://open.bigmodel.cn',
                    docsUrl: 'https://docs.bigmodel.cn',
                    models: [
                        {id: 'glm-5.2', name: 'GLM-5.2', contextWindow: '128K'},
                        {id: 'glm-5.1', name: 'GLM-5.1', contextWindow: '128K'},
                        {id: 'glm-5', name: 'GLM-5', contextWindow: '128K'},
                        {id: 'glm-4.7', name: 'GLM-4.7', contextWindow: '128K'},
                        {id: 'glm-4.6', name: 'GLM-4.6', contextWindow: '128K'},
                        {id: 'glm-4.5', name: 'GLM-4.5', contextWindow: '128K'},
                        {id: 'glm-4-flash', name: 'GLM-4-Flash', contextWindow: '128K'},
                    ],
                    pricing: {input: '1 CNY/1M tokens', output: '4 CNY/1M tokens'},
                },
                {
                    id: 'moonshot', name: 'Kimi 月之暗面', icon: 'K',
                    baseUrl: 'https://api.moonshot.ai/anthropic',
                    officialUrl: 'https://platform.kimi.ai',
                    docsUrl: 'https://platform.kimi.ai/docs',
                    models: [
                        {id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: '256K'},
                        {id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: '256K'},
                        {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: '256K'},
                    ],
                    pricing: {input: '0.95 USD/1M tokens', output: '4 USD/1M tokens'},
                },
                {
                    id: 'anthropic', name: 'Anthropic', icon: 'A',
                    baseUrl: 'https://api.anthropic.com',
                    officialUrl: 'https://console.anthropic.com',
                    docsUrl: 'https://docs.anthropic.com/en/api',
                    models: [
                        {id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: '200K'},
                        {id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: '200K'},
                        {id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: '200K'},
                    ],
                    pricing: {input: '15 USD/1M tokens', output: '75 USD/1M tokens'},
                },
                {
                    id: 'qwen', name: '千问', icon: 'Q',
                    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
                    officialUrl: 'https://bailian.console.aliyun.com',
                    docsUrl: 'https://help.aliyun.com/zh/model-studio',
                    models: [
                        {id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: '128K'},
                        {id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: '128K'},
                        {id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', contextWindow: '128K'},
                        {id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: '128K'},
                    ],
                    pricing: {input: '0.5 CNY/1M tokens', output: '2 CNY/1M tokens'},
                },
                {
                    id: 'openrouter', name: 'OpenRouter', icon: 'R',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    officialUrl: 'https://openrouter.ai',
                    docsUrl: 'https://openrouter.ai/docs',
                    models: [
                        {id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: '200K'},
                        {id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', contextWindow: '200K'},
                        {id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
                        {id: 'openai/gpt-5', name: 'GPT-5', contextWindow: '128K'},
                        {id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
                    ],
                    pricing: {input: '按模型不同', output: '聚合定价'},
                },
                {
                    id: 'ollama', name: 'Ollama (本地)', icon: 'O',
                    baseUrl: 'http://localhost:11434/v1',
                    officialUrl: 'https://ollama.com',
                    docsUrl: 'https://ollama.com/docs',
                    models: [
                        {id: 'qwen3', name: 'Qwen 3', contextWindow: '32K'},
                        {id: 'llama4', name: 'Llama 4', contextWindow: '128K'},
                        {id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: '128K'},
                        {id: 'codestral', name: 'Codestral', contextWindow: '256K'},
                    ],
                    pricing: {input: '本地免费', output: '不限量'},
                },
                {
                    id: 'volcengine', name: '火山引擎', icon: 'V',
                    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
                    officialUrl: 'https://console.volcengine.com/ark',
                    docsUrl: 'https://www.volcengine.com/docs/82379',
                    models: [
                        {id: 'doubao-seed-1.6', name: '豆包 Seed 1.6', contextWindow: '128K'},
                        {id: 'doubao-seed-1.6-flash', name: '豆包 Flash 1.6', contextWindow: '128K'},
                        {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
                        {id: 'deepseek-r1-0528', name: 'DeepSeek R1', contextWindow: '128K'},
                    ],
                    pricing: {input: '0.8 CNY/1M tokens', output: '2 CNY/1M tokens'},
                },
                {
                    id: 'gemini', name: 'Gemini', icon: 'G',
                    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                    officialUrl: 'https://ai.google.dev',
                    docsUrl: 'https://ai.google.dev/gemini-api/docs',
                    models: [
                        {id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextWindow: '1M'},
                        {id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextWindow: '1M'},
                        {id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
                        {id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: '1M'},
                    ],
                    pricing: {input: '0.15 USD/1M tokens', output: '0.60 USD/1M tokens'},
                },
                {
                    id: 'codex', name: 'Codex', icon: 'X',
                    baseUrl: 'https://api.openai.com/v1',
                    officialUrl: 'https://github.com/openai/codex',
                    docsUrl: 'https://github.com/openai/codex',
                    models: [
                        {id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', contextWindow: '200K'},
                        {id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', contextWindow: '200K'},
                        {id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', contextWindow: '200K'},
                    ],
                    pricing: {input: '3 USD/1M tokens', output: '15 USD/1M tokens'},
                },
                {
                    id: 'custom', name: '自定义', icon: '···',
                    baseUrl: '',
                    officialUrl: '',
                    docsUrl: '',
                    models: [],
                    pricing: {input: '', output: ''},
                },
            ]
        }));
        return;
    }
    // ── HTTP: 定时任务 ──

    // GET /api/config/scheduled-tasks
    if (req.method === 'GET' && url.pathname === '/api/config/scheduled-tasks') {
        const list = Object.entries(scheduledTasks).map(([id, t]) => ({
            id, cron: t.cron, prompt: t.prompt, workDir: t.workDir,
            model: t.model, enabled: t.enabled !== false,
        }))
        res.writeHead(200); res.end(JSON.stringify({tasks: list}))
        return
    }
    // POST /api/config/scheduled-tasks
    if (req.method === 'POST' && url.pathname === '/api/config/scheduled-tasks') {
        const b = await readBody(req)
        const id = (b.id || crypto.randomUUID())
        if (!b.cron || !b.prompt || !b.workDir) {
            res.writeHead(400); res.end(JSON.stringify({error: 'cron, prompt, workDir required'})); return
        }
        // validate cron
        if (!cron.validate(b.cron)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid cron expression'})); return }
        scheduledTasks[id] = {
            cron: b.cron, prompt: b.prompt, workDir: b.workDir,
            model: b.model || MODEL, enabled: b.enabled !== false,
        }
        writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        // 注册新 cron job
        if (scheduledTasks[id].enabled) {
            try {
                const job = cron.schedule(b.cron, () => {
                    executeScheduledTask(id).catch(e => {
                        log.error({err: e, taskId: id}, '定时任务执行失败')
                    })
                })
                cronJobs.set(id, job)
            } catch {}
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, id}))
        return
    }
    // PUT /api/config/scheduled-tasks/:id
    const schedPutM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)$/)
    if (req.method === 'PUT' && schedPutM) {
        const id = schedPutM[1]
        if (!scheduledTasks[id]) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        const b = await readBody(req)
        if (b.cron !== undefined) {
            if (!cron.validate(b.cron)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid cron'})); return }
            scheduledTasks[id].cron = b.cron
        }
        if (b.prompt !== undefined) scheduledTasks[id].prompt = b.prompt
        if (b.workDir !== undefined) scheduledTasks[id].workDir = b.workDir
        if (b.model !== undefined) scheduledTasks[id].model = b.model
        if (b.enabled !== undefined) scheduledTasks[id].enabled = !!b.enabled
        writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        // 重启 cron job
        if (cronJobs.has(id)) { cronJobs.get(id).stop(); cronJobs.delete(id) }
        if (scheduledTasks[id].enabled) {
            try { cronJobs.set(id, cron.schedule(scheduledTasks[id].cron, () => {
                    executeScheduledTask(id).catch(e => {
                        log.error({err: e, taskId: id}, '定时任务执行失败')
                    })
                })) } catch {}
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true}))
        return
    }
    // DELETE /api/config/scheduled-tasks/:id
    const schedDelM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)$/)
    if (req.method === 'DELETE' && schedDelM) {
        const id = schedDelM[1]
        if (cronJobs.has(id)) { cronJobs.get(id).stop(); cronJobs.delete(id) }
        delete scheduledTasks[id]
        writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        res.writeHead(200); res.end(JSON.stringify({ok: true}))
        return
    }
    // POST /api/config/scheduled-tasks/:id/run —— 立即执行一次
    const schedRunM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)\/run$/)
    if (req.method === 'POST' && schedRunM) {
        const id = schedRunM[1]
        const task = scheduledTasks[id]
        if (!task) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        if (!task.enabled) { res.writeHead(400); res.end(JSON.stringify({error: 'task is disabled'})); return }
        res.writeHead(200); res.end(JSON.stringify({ok: true}))
        // 异步执行，不阻塞响应
        executeScheduledTask(id).catch(e => {
            log.error({err: e, taskId: id}, '手动执行定时任务失败')
        })
        return
    }

    // ── GET /api/config/adapters —— IM 适配器状态列表 ──
    // 功能说明: 返回三个 IM 平台（微信/飞书/钉钉）的配置状态、绑定方式、运行状态
    //   从 adapters.json 读取凭据信息，用 confirmHooks 判断各适配器是否正在运行
    //   前端适配器设置页面依赖此接口展示各平台卡片
    // 关键数据流: GET → adapters.json + confirmHooks 运行状态 → 200 {platforms: [{id, name, status, hasAccount, guideSteps, ...}]}
    if (req.method === 'GET' && url.pathname === '/api/config/adapters') {
        const ad = readJSON(join(CLAUDE_HOME, 'adapters.json')) || {};
        const isRunning = p => confirmHooks.some(h => h.platform === p);
        res.writeHead(200);
        res.end(JSON.stringify({
            platforms: [{
                id: 'wechat',
                name: '微信',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
                color: '#07C160',
                bindMethod: 'qr',
                guideTitle: '微信扫码绑定',
                guideSteps: ['1. 微信搜索并关注你的 iLink Bot', '2. 发送任意消息给 Bot', '3. 配对码发给Bot完成绑定'],
                hasAccount: !!(ad.wechat?.botToken),
                accountId: ad.wechat?.accountId || '',
                baseUrl: ad.wechat?.baseUrl || 'https://ilinkai.weixin.qq.com',
                status: isRunning('wechat') ? 'running' : (ad.wechat?.botToken ? 'configured' : 'not_configured')
            }, {
                id: 'feishu',
                name: '飞书',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
                color: '#3370FF',
                bindMethod: 'app_config',
                guideTitle: '飞书企业自建应用接入',
                guideSteps: ['1. 飞书开放平台创建企业自建应用 + 机器人', '2. 获取 App ID + App Secret', '3. 事件订阅 选择「使用长连接接收事件」', '4. 发布版本生效'],
                configFields: [{
                    key: 'appId',
                    label: 'App ID',
                    placeholder: 'cli_xxxxxxxxxxxx',
                    type: 'text'
                }, {key: 'appSecret', label: 'App Secret', placeholder: '输入 App Secret', type: 'password'}],
                hasAccount: !!(ad.feishu?.appId && ad.feishu?.appSecret),
                accountId: ad.feishu?.appId ? ad.feishu.appId.replace(/./g, '●').slice(0, 20) : '',
                baseUrl: ad.feishu?.baseUrl || 'https://open.feishu.cn',
                status: isRunning('feishu') ? 'running' : ((ad.feishu?.appId && ad.feishu?.appSecret) ? 'configured' : 'not_configured')
            }, {
                id: 'dingtalk',
                name: '钉钉',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 11-3 11h18s-3-4-3-11"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
                color: '#0089FF',
                bindMethod: 'app_config',
                guideTitle: '钉钉企业内部应用接入',
                guideSteps: ['1. 钉钉开发者后台创建企业内部应用', '2. 获取 Client ID + Client Secret', '3. 选择 Stream 模式', '4. 发布版本生效'],
                configFields: [{
                    key: 'appKey',
                    label: 'Client ID',
                    placeholder: 'dingxxxxxxxxxx',
                    type: 'text'
                }, {key: 'appSecret', label: 'Client Secret', placeholder: '输入 App Secret', type: 'password'}],
                hasAccount: !!(ad.dingtalk?.appKey && ad.dingtalk?.appSecret),
                accountId: ad.dingtalk?.appKey ? ad.dingtalk.appKey.replace(/./g, '●').slice(0, 20) : '',
                baseUrl: ad.dingtalk?.baseUrl || 'https://api.dingtalk.com',
                status: isRunning('dingtalk') ? 'running' : ((ad.dingtalk?.appKey && ad.dingtalk?.appSecret) ? 'configured' : 'not_configured')
            }]
        }));
        return
    }

    // ── POST /api/config/adapters/wechat/qrcode —— 获取微信 Bot 二维码 ──
    // 功能说明: 调用 iLink API 获取微信 Bot 的绑定二维码，缓存到 pendingQRCodes Map（5 分钟有效期）
    //   前端展示二维码供用户扫码绑定
    // 关键数据流: POST → fetch iLink get_bot_qrcode → 缓存 qrcode + expires → 200 {qrImgUrl, expiresIn}
    if (req.method === 'POST' && url.pathname.startsWith('/api/config/adapters/') && url.pathname.endsWith('/qrcode')) {
        const pid = url.pathname.split('/')[4];
        if (pid !== 'wechat') {
            res.writeHead(400);
            res.end();
            return
        }
        ;
        try {
            const r = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3', {
                headers: {
                    'AuthorizationType': 'ilink_bot_token',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081'
                }, signal: AbortSignal.timeout(10000)
            });
            const q = await r.json();
            if (!q.qrcode) {
                res.writeHead(500);
                res.end();
                return
            }
            ;pendingQRCodes.set(pid, {qrcode: q.qrcode, expires: Date.now() + 300000});
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                qrImgUrl: `https://quickchart.io/qr?text=${encodeURIComponent(q.qrcode_img_content || q.qrcode)}&size=300`,
                expiresIn: 300
            }))
        } catch (e) {
            res.writeHead(500);
            res.end()
        }
        ;
        return
    }
    // ── POST /api/config/adapters/wechat/qrcode/poll —— 轮询二维码状态 ──
    // 功能说明: 轮询微信二维码绑定状态，确认后自动保存 botToken 到 adapters.json + channels/ 账号缓存
    //   前端在展示二维码后定时轮询此接口直到 status === 'confirmed'
    // 关键数据流: POST → fetch iLink get_qrcode_status → confirmed? 保存 token + 清理 pending → 200 {status:'confirmed'}
    //   未确认 → 200 {status:'wait'}
    if (req.method === 'POST' && url.pathname.includes('/qrcode/poll')) {
        const pid = url.pathname.split('/')[4];
        const p = pendingQRCodes.get(pid);
        if (!p) {
            res.writeHead(400);
            res.end();
            return
        }
        ;
        try {
            const r = await fetch(`https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(p.qrcode)}`, {
                headers: {
                    'AuthorizationType': 'ilink_bot_token',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081'
                }, signal: AbortSignal.timeout(5000)
            });
            const s = await r.json();
            if (s.status === 'confirmed' && s.bot_token) {
                const af = join(CLAUDE_HOME, 'adapters.json');
                const a = readJSON(af) || {};
                a.wechat = {
                    ...(a.wechat || {}),
                    botToken: s.bot_token,
                    accountId: s.ilink_bot_id,
                    baseUrl: s.baseurl || 'https://ilinkai.weixin.qq.com'
                };
                writeJSON(af, a);
                pendingQRCodes.delete(pid);
                try {
                    const cd = join(CLAUDE_HOME, 'channels', 'wechat', 'default');
                    if (!existsSync(cd)) mkdirSync(cd, {recursive: true});
                    writeJSON(join(cd, 'account.json'), {
                        token: s.bot_token,
                        baseUrl: s.baseurl || 'https://ilinkai.weixin.qq.com',
                        botId: s.ilink_bot_id,
                        savedAt: new Date().toISOString()
                    })
                } catch {
                }
                ;res.writeHead(200);
                res.end(JSON.stringify({status: 'confirmed'}))
            } else {
                res.writeHead(200);
                res.end(JSON.stringify({status: s.status || 'wait'}))
            }
        } catch {
            res.writeHead(200);
            res.end(JSON.stringify({status: 'wait'}))
        }
        ;
        return
    }
    // ── PUT /api/config/adapters/:id —— 更新适配器凭据 ──
    // 功能说明: 保存飞书/钉钉的 App ID + Secret 到 adapters.json
    // 关键数据流: PUT {appId, appSecret} / {appKey, appSecret} → 写入 adapters.json → 200 {ok:true}
    const apm = url.pathname.match(/^\/api\/config\/adapters\/([^/]+)$/);
    if (req.method === 'PUT' && apm) {
        const pid = apm[1];
        try {
            const b = await readBody(req);
            const a = readJSON(join(CLAUDE_HOME, 'adapters.json')) || {};
            if (pid === 'feishu') a.feishu = {
                ...(a.feishu || {}),
                appId: b.appId,
                appSecret: b.appSecret
            }; else if (pid === 'dingtalk') a.dingtalk = {
                ...(a.dingtalk || {}),
                appKey: b.appKey,
                appSecret: b.appSecret
            }; else {
                res.writeHead(400);
                res.end();
                return
            }
            ;writeJSON(join(CLAUDE_HOME, 'adapters.json'), a);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}))
        } catch (e) {
            res.writeHead(500);
            res.end()
        }
        ;
        return
    }
    // ── DELETE /api/config/adapters/:id —— 删除适配器配置 ──
    // 功能说明: 从 adapters.json 移除指定平台的凭据配置，同时清理 ~/.claude/channels/ 下的账号缓存目录
    // 关键数据流: DELETE → 移除 adapters.json[platform] + 清理 channels/ 目录 → 200 {ok:true}
    if (req.method === 'DELETE' && apm) {
        const pid = apm[1];
        try {
            const a = readJSON(join(CLAUDE_HOME, 'adapters.json')) || {};
            delete a[pid];
            writeJSON(join(CLAUDE_HOME, 'adapters.json'), a); // 同时清理 channels 目录下的账号缓存
            try {
                const cd = join(CLAUDE_HOME, 'channels', pid);
                if (existsSync(cd)) {
                    for (const f of readdirSync(cd)) {
                        const fp = join(cd, f);
                        try {
                            statSync(fp).isDirectory() ? rmdirSync(fp, {recursive: true}) : unlinkSync(fp)
                        } catch {
                        }
                    }
                    rmdirSync(cd)
                }
            } catch {
            }
            ;res.writeHead(200);
            res.end(JSON.stringify({ok: true}))
        } catch (e) {
            log.error({err: e}, 'adapters DELETE 失败');
            res.writeHead(500);
            res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        ;
        return
    }
    // ── GET /api/config/mcp —— MCP 插件列表 ──
    // 功能说明: 从 ~/.claude/plugins/installed_plugins.json 读取已安装的 MCP 插件信息
    // 关键数据流: GET → readJSON installed_plugins.json → 200 {plugins: [{name, version, scope, enabled}]}
    // ── GET /api/config/mcp —— MCP 插件列表 ──
    // 功能说明: 合并硬编码内置 MCP + installed_plugins.json 用户安装的插件
    // 关键数据流: BUILTIN_MCP 打底 → 叠加 installed_plugins.json → 200 {plugins}
    if (req.method === 'GET' && url.pathname === '/api/config/mcp') {
        const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
        const disabledList = s.disabledMcpPlugins || []
        const pj = join(CLAUDE_HOME, 'plugins', 'installed_plugins.json')
        const pm = new Map()
        for (const [k, v] of Object.entries(BUILTIN_MCP)) {
            pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: !disabledList.includes(k), source: 'builtin'})
        }
        try {
            const d = readJSON(pj)
            if (d?.plugins) {
                for (const [k, vs] of Object.entries(d.plugins)) {
                    for (const v of vs) {
                        const src = v.scope === 'user' || v.scope === 'project' ? 'custom' : 'builtin'
                        pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: !disabledList.includes(k), source: src})
                    }
                }
            }
        } catch {
        }
        res.writeHead(200)
        res.end(JSON.stringify({plugins: [...pm.values()]}))
        return
    }

    // ── GET /api/config/mcp-servers —— MCP 服务器配置列表 ──
    // 功能说明: 从 settings.json 读取 mcpServers 配置，返回服务器列表（名称/transport/command/参数等）
    // 关键数据流: GET → loadCliSettings().mcpServers → 200 {servers: [{name, transport, command, args, env, url, headers}]}
    if (req.method === 'GET' && url.pathname === '/api/config/mcp-servers') {
        const cliS = loadCliSettings()
        const servers = cliS.mcpServers || {}
        const list = Object.entries(servers).map(([name, cfg]) => ({
            name,
            transport: cfg.type || cfg.transport || 'stdio',
            command: cfg.command || '',
            args: cfg.args || [],
            env: cfg.env || {},
            url: cfg.url || '',
            headers: cfg.headers || {},
            enabled: cfg.enabled !== false,
        }))
        res.writeHead(200)
        res.end(JSON.stringify({servers: list}))
        return
    }

    // ── POST /api/config/mcp-servers —— 新增/更新 MCP 服务器 ──
    // 功能说明: 写入 settings.json 的 mcpServers 字段，支持新增和覆盖已有服务器
    //   校验 name 必填，transport 合法（stdio/sse/http）；已有同名校验后覆盖
    // 关键数据流: POST {name, transport, command, args, env, url, headers}
    //   → readJSON settings.json → 更新 mcpServers[name] → writeJSON → 200 {ok:true}
    if (req.method === 'POST' && url.pathname === '/api/config/mcp-servers') {
        try {
            const body = await readBody(req)
            const name = (body.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name 必填'})); return }
            const transport = body.transport || 'stdio'
            if (!['stdio', 'sse', 'http'].includes(transport)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'transport 需为 stdio/sse/http'})); return
            }
            const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
            if (!s.mcpServers) s.mcpServers = {}
            const existing = s.mcpServers[name] || {}
            const cfg = {type: transport}
            if (body.enabled !== undefined) cfg.enabled = !!body.enabled
            else if (existing.enabled !== undefined) cfg.enabled = existing.enabled
            if (transport === 'stdio') {
                if (body.command) cfg.command = body.command
                if (body.args && body.args.length) cfg.args = body.args
                if (body.env && Object.keys(body.env).length) cfg.env = body.env
            } else {
                if (body.url) cfg.url = body.url
                if (body.headers && Object.keys(body.headers).length) cfg.headers = body.headers
            }
            s.mcpServers[name] = cfg
            writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
            log.info({name, transport}, 'MCP 服务器已保存')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'MCP 服务器保存失败')
            res.writeHead(500); res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        return
    }

    // ── DELETE /api/config/mcp-servers/:name —— 删除 MCP 服务器 ──
    // 功能说明: 从 settings.json 的 mcpServers 中删除指定名称的服务器配置
    // 关键数据流: DELETE /api/config/mcp-servers/:name → delete mcpServers[name] → writeJSON → 200 {ok:true}
    const delMcpM = url.pathname.match(/^\/api\/config\/mcp-servers\/([^/]+)$/)
    if (req.method === 'DELETE' && delMcpM) {
        try {
            const name = delMcpM[1]
            const s = readJSON(join(CLAUDE_HOME, 'settings.json')) || {}
            if (s.mcpServers) {
                delete s.mcpServers[name]
                writeJSON(join(CLAUDE_HOME, 'settings.json'), s)
            }
            log.info({name}, 'MCP 服务器已删除')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'MCP 服务器删除失败')
            res.writeHead(500); res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        return
    }

    // ── POST /api/wechat/send —— 主动推送消息到微信 ──
    // 功能说明: 前端手动推送文本消息到指定微信用户，自动分段发送长文本
    // 实现方式: 从 adapters.json 或 channels/ 获取 botToken → sendWeChatChunks 分段发送
    // 关键数据流: POST {userId, text} → 取 token → sendWeChatChunks → 200 {sent, parts}
    if (req.method === 'POST' && url.pathname === '/api/wechat/send') {
        try {
            const {userId, text} = await readBody(req);
            if (!userId || !text) {
                res.writeHead(400);
                res.end();
                return
            }
            ;let t, u;
            try {
                const a = readJSON(join(CLAUDE_HOME, 'adapters.json'));
                t = a.wechat?.botToken;
                u = a.wechat?.baseUrl || 'https://ilinkai.weixin.qq.com'
            } catch {
            }
            ;
            if (!t) {
                try {
                    const a = readJSON(join(CLAUDE_HOME, 'channels', 'wechat', 'default', 'account.json'));
                    t = a.token;
                    u = a.baseUrl || 'https://ilinkai.weixin.qq.com'
                } catch {
                }
            }
            ;
            if (!t) {
                res.writeHead(500);
                res.end();
                return
            }
            ;const bn = u.replace(/\/+$/, '') + '/';
            const r = await sendWeChatChunks(bn, t, userId, '', text);
            res.writeHead(200);
            res.end(JSON.stringify({sent: r.sent, parts: r.parts}))
        } catch (e) {
            res.writeHead(500);
            res.end()
        }
        ;
        return
    }
    // ── POST /api/wechat/reply —— 回复微信消息 ──
    // 功能说明: 通过 iLink Bot 回复微信用户消息，带 contextToken 维持会话上下文
    //   自动分段发送长文本 + 返回发送结果
    // 关键数据流: POST {sessionId, userId, contextToken, replyText} → sendWeChatChunks → 200 {sent, parts, length}
    if (req.method === 'POST' && url.pathname === '/api/wechat/reply') {
        try {
            const {sessionId, userId, contextToken, replyText} = await readBody(req);
            if (!sessionId || !userId || !replyText) {
                res.writeHead(200);
                res.end(JSON.stringify({sent: false}));
                return
            }
            ;let t, u;
            try {
                const a = readJSON(join(CLAUDE_HOME, 'adapters.json'));
                t = a.wechat?.botToken;
                u = a.wechat?.baseUrl || 'https://ilinkai.weixin.qq.com'
            } catch {
            }
            ;
            if (!t) {
                try {
                    const a = readJSON(join(CLAUDE_HOME, 'channels', 'wechat', 'default', 'account.json'));
                    t = a.token;
                    u = a.baseUrl || 'https://ilinkai.weixin.qq.com'
                } catch {
                }
            }
            ;
            if (!t) {
                res.writeHead(500);
                res.end();
                return
            }
            ;const bn = u.replace(/\/+$/, '') + '/';
            const r = await sendWeChatChunks(bn, t, userId, contextToken, replyText);
            res.writeHead(200);
            res.end(JSON.stringify({sent: r.sent, parts: r.parts, length: replyText.length}))
        } catch (e) {
            res.writeHead(500);
            res.end()
        }
        ;
        return
    }

    // 微信通道确认回复入口
    // ── POST /api/confirm —— 微信通道确认响应入口 ──
    // 功能说明: 微信 IM 消息通过此接口提交用户对权限/方案选择的确认结果
    //   查找 session 的 pending entry，将决策转换为 PermissionResult，调用 settlePending 收口
    // 实现方式: readBody → 查找 s.pending.get(requestId) → decisionToResult 映射 → settlePending(sid, requestId, result, 'wechat')
    // 关键数据流: POST {sessionId, requestId, decision/optionIndex} → s.pending 查找
    //   → decisionToResult → settlePending → 200 {ok:true} 或 {ok:false, reason:'already_resolved'}
    if (req.method === 'POST' && url.pathname === '/api/confirm') {
        const b = await readBody(req);
        const {sessionId: sid, requestId, decision, optionIndex, questionIndex} = b
        const s = sessions.get(sid)
        const entry = s?.pending?.get(requestId)
        if (!entry) {
            res.writeHead(200);
            res.end(JSON.stringify({ok: false, reason: 'already_resolved'}));
            return
        }
        const result = entry.type === 'choice'
            ? decisionToResult(entry, null, optionIndex, questionIndex)
            : decisionToResult(entry, decision)
        settlePending(sid, requestId, result, 'wechat')
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        return
    }

    // ── GET /api/config/memory-summary —— 项目记忆摘要 ──
    // 功能说明: 扫描所有项目的 memory/ 目录，返回每个项目的工作目录路径和记忆文件列表
    //   前端设置页 Memory 面板依赖此接口展示各项目的记忆文件
    // 实现方式: 遍历 ~/.claude/projects/ → 读 memory/ 目录 → 从 .jsonl 解析真实 cwd
    // 关键数据流: GET → 遍历 projects/ → 200 {projects: [{workDir, fileCount, files}]}
    if (req.method === 'GET' && url.pathname === '/api/config/memory-summary') {
        const bp = join(CLAUDE_HOME, 'projects');
        const rs = [];
        try {
            for (const ed of readdirSync(bp)) {
                // 跳过非项目目录（无 jsonl session 记录）
                const jls = readdirSync(join(bp, ed)).filter(f => f.endsWith('.jsonl'));
                if (!jls.length) continue;
                const md = join(bp, ed, 'memory');
                const fl = existsSync(md) ? readdirSync(md).filter(f => f.endsWith('.md')) : [];
                let wd = decodeProjectName(ed) || ed;
                try {
                    const c = readFileSync(join(bp, ed, jls[0]), 'utf8');
                    const cm = c.match(/"cwd":\s*"([^"]+)"/);
                    if (cm) wd = cm[1].replace(/\\/g, '/')
                } catch {
                }
                ;rs.push({
                    workDir: wd,
                    encodedDir: ed,
                    fileCount: fl.length,
                    files: fl.map(f => ({filename: f, size: statSync(join(md, f)).size}))
                })
            }
        } catch {
        }
        ;rs.sort((a, b) => b.fileCount - a.fileCount);
        res.writeHead(200);
        res.end(JSON.stringify({projects: rs}));
        return
    }
    // ── GET /api/balance —— 余额查询 ──
    // 功能说明: 调用 DeepSeek API 查询账户余额（CNY），前端设置页展示
    // 关键数据流: GET → fetch DeepSeek /user/balance → 200 {balance, currency}
    if (req.method === 'GET' && url.pathname === '/api/balance') {
        try {
            const cliS = loadCliSettings();
            const k = process.env.ANTHROPIC_API_KEY || cliS.env?.ANTHROPIC_AUTH_TOKEN;
            if (!k) {
                res.writeHead(502);
                res.end();
                return
            }
            ;const r = await fetch('https://api.deepseek.com/user/balance', {
                headers: {Authorization: `Bearer ${k}`},
                signal: AbortSignal.timeout(5000)
            });
            if (!r.ok) {
                res.writeHead(502);
                res.end();
                return
            }
            ;const d = await r.json();
            const i = d.balance_infos?.[0] || {};
            res.writeHead(200);
            res.end(JSON.stringify({balance: parseFloat(i.total_balance || '0'), currency: i.currency || 'CNY'}))
        } catch {
            res.writeHead(502);
            res.end()
        }
        ;
        return
    }

    // ── POST /api/sessions-by-label —— IM 命令专用：按项目名查会话
    // body: { label: 'claude-desktop-bridge' }
    // 一次调用完成"查项目→查session"，返回 {ok, label, sessions}
    if (req.method === 'POST' && url.pathname === '/api/sessions-by-label') {
        const b = await readBody(req)
        const label = (b.label || '').toLowerCase()
        if (!label) { res.writeHead(400); res.end(JSON.stringify({error: 'label required'})); return }
        const projects = await scanProjects()
        let match = projects.find(p => {
            const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
            return dn.toLowerCase() === label
        })
        if (!match) {
            match = projects.find(p => {
                const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
                return dn.toLowerCase().includes(label) || (p.workDir || '').toLowerCase().includes(label)
            })
        }
        if (!match) { res.writeHead(200); res.end(JSON.stringify({ok: true, label: b.label, sessions: []})); return }
        const sessions = await listProjectSessions(match.encodedDir)
        res.writeHead(200); res.end(JSON.stringify({ok: true, label: b.label, sessions: sessions.map(s => ({id: s.id, title: s.title}))})); return
    }

    // ── GET /api/projects —— 扫描所有项目 ──
    // 功能说明: 扫描 ~/.claude/projects/ 目录，返回所有项目的列表（含 session 摘要和最后活跃时间）
    //   去重按 workDir 合并多 session 的同一项目
    // 关键数据流: GET → scanProjects() → 200 {projects: [{workDir, sessionCount, sessions, lastActive}]}
    if (req.method === 'GET' && url.pathname === '/api/projects') {
        const projects = await scanProjects();
        res.writeHead(200);
        res.end(JSON.stringify({projects}));
        return
    }
    const psm = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
    if (req.method === 'GET' && psm) {
        const sessions = await listProjectSessions(psm[1]);
        res.writeHead(200);
        res.end(JSON.stringify({sessions}));
        return
    }
    const msm = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && msm) {
        const messages = await loadMessages(msm[1], msm[2]);
        res.writeHead(200);
        res.end(JSON.stringify({messages}));
        return
    }

    // ── GET /api/projects/:encodedDir/memory —— 读取项目所有 memory 文件 ──
    const projMemM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory$/);
    if (req.method === 'GET' && projMemM) {
        const ed = projMemM[1];
        const md = join(CLAUDE_HOME, 'projects', ed, 'memory');
        const files = [];
        try {
            if (existsSync(md)) {
                for (const f of readdirSync(md)) {
                    if (!f.endsWith('.md')) continue;
                    const content = readFileSync(join(md, f), 'utf8');
                    files.push({filename: f, content, size: Buffer.byteLength(content)});
                }
            }
        } catch {
        }
        res.writeHead(200);
        res.end(JSON.stringify({files}));
        return
    }
    // ── PUT/DELETE /api/projects/:encodedDir/memory/:filename —— 创建/编辑/删除 memory 文件 ──
    const projMemFileM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory\/([^/]+)$/);
    if (req.method === 'PUT' && projMemFileM) {
        const ed = projMemFileM[1];
        const fn = projMemFileM[2];
        const body = await readBody(req);
        const md = join(CLAUDE_HOME, 'projects', ed, 'memory');
        try { mkdirSync(md, {recursive: true}); } catch {
        }
        writeFileSync(join(md, fn), body.content || '', 'utf8');
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        return
    }
    if (req.method === 'DELETE' && projMemFileM) {
        const ed = projMemFileM[1];
        const fn = projMemFileM[2];
        const fp = join(CLAUDE_HOME, 'projects', ed, 'memory', fn);
        try { unlinkSync(fp); } catch {
        }
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        return
    }

    // ── Workflow 脚本 CRUD ( ~/.claude/workflows/*.mjs ) ──
    // GET  /api/workflows          → 列出所有脚本
    // GET  /api/workflows/:name    → 读取脚本内容
    // PUT  /api/workflows/:name    → 保存脚本
    // DELETE /api/workflows/:name → 删除脚本
    // POST /api/workflows/:name/run → 执行脚本
    // GET  /api/workflows/:name/state → 查询运行状态
    if (url.pathname === '/api/workflows' && req.method === 'GET') {
        const list = listWorkflows();
        res.writeHead(200);
        res.end(JSON.stringify({workflows: list}));
        return
    }
    const wfRunM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/run$/)
    if (req.method === 'POST' && wfRunM) {
        const name = decodeURIComponent(wfRunM[1])
        try {
            const body = await readBody(req);
            const sid = body.sessionId
            if (!sid || !sessions.has(sid)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'sessionId 无效'}));
                return
            }
            const wfCfg = loadWfConfig()
            if (!wfCfg.enabled) {
                res.writeHead(403);
                res.end(JSON.stringify({error: 'Workflow 功能已禁用，请在 Workflow 面板开启'}));
                return
            }
            presetRunState(name)
            runWfScript(name, sid, body.args || {}).catch(e => {
                broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
            })
            res.writeHead(202);
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    const wfStateM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/state$/)
    if (req.method === 'GET' && wfStateM) {
        const state = getRunState(decodeURIComponent(wfStateM[1]))
        res.writeHead(200);
        res.end(JSON.stringify(state || {status: 'not_run', logs: [], phases: []}))
        return
    }
    // POST /api/workflows/:name/stop → 暂停运行中的工作流
    const wfStopM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/stop$/)
    if (req.method === 'POST' && wfStopM) {
        const name = decodeURIComponent(wfStopM[1])
        const ok = stopWorkflow(name)
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify(ok ? {ok: true, name, status: 'paused'} : {error: 'not running'}))
        return
    }
    // POST /api/workflows/:name/resume → 恢复暂停的工作流
    const wfResumeM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/resume$/)
    if (req.method === 'POST' && wfResumeM) {
        const name = decodeURIComponent(wfResumeM[1])
        try {
            const body = await readBody(req);
            const sid = body.sessionId
            if (!sid || !sessions.has(sid)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'sessionId 无效'}));
                return
            }
            const wfCfg = loadWfConfig()
            if (!wfCfg.enabled) {
                res.writeHead(403);
                res.end(JSON.stringify({error: 'Workflow 功能已禁用，请在 Workflow 面板开启'}));
                return
            }
            presetRunState(name)
            resumeWorkflow(name, sid).catch(e => {
                broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
            })
            res.writeHead(202);
            res.end(JSON.stringify({ok: true, name, status: 'resumed'}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    const wfFileM = url.pathname.match(/^\/api\/workflows\/([^/]+)$/)
    if (wfFileM) {
        const name = decodeURIComponent(wfFileM[1])
        if (req.method === 'GET') {
            const content = getWorkflow(name);
            const meta = content ? parseMeta(content) : null
            if (!content) {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}));
                return
            }
            res.writeHead(200);
            res.end(JSON.stringify({name, content, meta}));
            return
        }
        if (req.method === 'PUT') {
            const body = await readBody(req)
            if (!body.content) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'content 不能为空'}));
                return
            }
            // 安全校验：sessionId 有则验证，没有则要求至少一个活跃 session
            if (body.sessionId) {
                if (!sessions.has(body.sessionId)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({error: 'sessionId 无效'}));
                    return
                }
            } else if (sessions.size === 0) {
                res.writeHead(403);
                res.end(JSON.stringify({error: '无活跃会话，请先创建工作区'}));
                return
            }
            saveWorkflow(name, body.content);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, name}));
            return
        }
        if (req.method === 'DELETE') {
            const body = await readBody(req).catch(() => ({}))
            // 安全校验：同 PUT
            if (body.sessionId) {
                if (!sessions.has(body.sessionId)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({error: 'sessionId 无效'}));
                    return
                }
            } else if (sessions.size === 0) {
                res.writeHead(403);
                res.end(JSON.stringify({error: '无活跃会话，请先创建工作区'}));
                return
            }
            deleteWorkflowFile(name);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}));
            return
        }
    }

    if (!res.headersSent) {
        res.writeHead(404);
        res.end(JSON.stringify({error: 'not found'}))
    }
})

// ---- WebSocket ----
// 控制通道客户端池：独立于 session，用于接收 nudge 等全局事件
const controlClients = new Set()

const wss = new WebSocketServer({server: httpServer})
wss.on('connection', (ws, req) => {
    const urlStr = req.url || '';
    const qi = urlStr.indexOf('?')
    const pathPart = qi >= 0 ? urlStr.slice(0, qi) : urlStr;
    const qPart = qi >= 0 ? urlStr.slice(qi + 1) : ''
    const sessionId = pathPart.split('/').pop()
    const params = {};
    for (const p of qPart.split('&')) {
        const [k, v] = p.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '')
    }
    // 控制通道：不绑定 session，桌面端启动即连，用于接收 nudge 事件
    if (pathPart === '/ws/control' || pathPart === '/ws/control/') {
        ws._source = 'desktop'
        controlClients.add(ws)
        ws.send(JSON.stringify({type: 'control_connected'}))
        ws.on('close', () => { controlClients.delete(ws) })
        return
    }
    if (!sessionId || !sessions.has(sessionId)) {
        ws.close(4000, JSON.stringify({error: 'unknown session'}));
        return
    }
    const s = sessions.get(sessionId);
    s.clients.add(ws)
    ws._source = params.source || 'desktop'
    if (params.source === 'desktop') focusedSessionId = sessionId
    ws.send(JSON.stringify({type: 'connected', sessionId}))
    log.info({
        sessionId: sessionId?.slice(0, 8),
        source: params.source || 'desktop',
        clients: s.clients.size
    }, 'WS 已连接')

    ws.on('message', async (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            return
        }
        if (msg.type === 'stop_generation') {
            // 中止前先 reject 所有挂起的确认请求
            for (const id of [...(s.pending?.keys() || [])]) settlePending(sessionId, id, {
                behavior: 'deny',
                message: '已取消',
                interrupt: true
            }, 'stopped')
            // 懒重建: 只中止当前 query，下条消息来了再 spawn 新进程（避免 abort signal 冲突导致 ENOENT）
            try {
                s.pushStream.close();
                s.query?.return?.()
            } catch {
            }
            s.query = null;
            s.pushStream = null;
            s.lastSessionId = s.lastSessionId || sessionId
            ws.send(JSON.stringify({type: 'generation_stopped'}))
            return
        }
        // 桌面端权限/方案选择响应
        if (msg.type === 'permission_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, msg.decision), 'desktop')
            return
        }
        if (msg.type === 'choice_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, null, msg.optionIndex, msg.questionIndex), 'desktop')
            return
        }
        if (msg.type === 'user_message' && msg.content) {
            log.info({
                sessionId: sessionId?.slice(0, 8),
                source: ws._source,
                text: msg.content?.slice(0, 80)
            }, '← 用户消息')
            // IM 平台注入时，把消息 echo 给桌面端，让 desktop 窗口能看到
            const imSources = ['wechat', 'feishu', 'dingtalk']
            if (imSources.includes(ws._source)) broadcast(sessionId, {
                type: 'remote_user_message',
                source: ws._source,
                content: msg.content
            })
            // 记录本轮来源（desktop / wechat / feishu / dingtalk）+ 清空本轮回复累积/工具计数
            s.lastTurnSource = ws._source
            s.turnText = ''
            s.turnToolCount = 0
            // 回合开始：拍「修改前」快照，本轮 result 时结算为记录点
            const srcLabel = imSources.includes(ws._source) ? `[${ws._source}] ` : ''
            beginTurn(sessionId, srcLabel + msg.content)
            // 检测权限/思考设置是否变更，若变更则更新 session 并重建 query
            const newPerm = msg.permissionMode
            const newThink = msg.thinkingLevel
            const permChanged = newPerm && newPerm !== s.permissionMode
            const thinkChanged = newThink && newThink !== s.thinkingLevel
            if (permChanged || thinkChanged) {
                if (permChanged) {
                    s.permissionMode = newPerm;
                    log.info({sessionId: sessionId?.slice(0, 8), permissionMode: newPerm}, 'permissionMode 变更')
                }
                if (thinkChanged) {
                    s.thinkingLevel = newThink;
                    log.info({sessionId: sessionId?.slice(0, 8), thinkingLevel: newThink}, 'thinkingLevel 变更')
                }
                try {
                    s.pushStream.close();
                    s.query?.return?.()
                } catch {
                }
                s.query = null;
                s.pushStream = null;
                s.lastSessionId = s.lastSessionId || sessionId
            }
            // query 为 null（被中止过或设置变更重建）→ 懒重建，resume 续接原会话
            if (!s.query) {
                const cliS = loadCliSettings()
                s.pushStream = new PushStream()
                const opts = await makeQueryOptions({
                    resume: s.lastSessionId || sessionId,
                    permissionMode: s.permissionMode,
                    thinkingLevel: s.thinkingLevel
                }, s.workDir, cliS, {}, sessionId)
                s.query = query({prompt: s.pushStream, options: opts})
                startStreamPump(sessionId)
            }
            s.pushStream.push({
                type: 'user',
                session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: msg.content}]},
                parent_tool_use_id: null
            })
            // 异步 AI 分类 + 启动 workflow（不阻塞用户消息，仅当无 _noWorkflow 标记时）
            if (!msg._noWorkflow) {
                autoTriggerWorkflow(sessionId, msg.content).catch(e => {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'autoTriggerWorkflow 异常')
                })
            }
        }
    })

    ws.on('close', () => {
        s.clients.delete(ws);
        if (s.clients.size === 0 && focusedSessionId === sessionId) focusedSessionId = null
    })
})

// ---- Start ----
process.on('uncaughtException', (e) => {
    log.fatal({err: e}, 'uncaughtException')
})
process.on('unhandledRejection', (reason) => {
    log.error({err: reason}, 'unhandledRejection')
})

// 启动前杀死占用端口的旧进程（上次非正常退出残留）
try {
    if (process.platform === 'win32') {
        const o = execSync(`netstat -ano | findstr :${PORT}`, {encoding: 'utf8', timeout: 3000})
        const seen = new Set()
        for (const m of o.matchAll(/\d+\s*$/gm)) {
            const pid = m[0].trim()
            if (seen.has(pid) || pid === String(process.pid)) continue
            seen.add(pid)
            try {
                execSync(`taskkill /PID ${pid} /F`, {timeout: 3000, windowsHide: true})
            } catch {
            }
        }
    } else if (process.platform === 'darwin') {
        // macOS 没有 fuser，用 lsof 查找占用端口的进程
        try {
            execSync(`lsof -ti :${PORT} | xargs kill -9`, {timeout: 3000})
        } catch {
        }
    } else {
        try {
            execSync(`fuser -k ${PORT}/tcp`, {timeout: 3000})
        } catch {
        }
    }
} catch {
}
// Caveman skill 安装（首次/升级后自动写入 ~/.claude/skills/caveman/SKILL.md）
ensureCavemanSkill()
// Caveman 版本检查（每次启动检测 GitHub 是否有新版本）
checkCavemanUpdate().catch(e => log.warn({err: e}, 'Caveman 版本检查异常'))
// RTK 版本检查（每次启动检测 GitHub 是否有新版本）
checkRtkUpdate().catch(e => log.warn({err: e}, 'RTK 版本检查异常'))
httpServer.listen(PORT, '127.0.0.1', () => {
    log.info({port: PORT}, `Gateway 已启动`)
    resumeScheduledTasks()
    // 启动时预启动 DeepSeek 代理（固定端口 8787），供 settings.json ANTHROPIC_BASE_URL 引用
    startDeepSeekProxy('https://api.deepseek.com/anthropic').catch(e => log.warn({err: e}, 'proxy boot 启动失败'))
    // 注册所有 IM 适配器（各适配器返回钩子，由 gateway 统一管理确认/镜像/同步）
    ;[
        {fn: startWeChatAdapter, platform: 'wechat'},
        {fn: startFeishuAdapter, platform: 'feishu'},
        {fn: startDingTalkAdapter, platform: 'dingtalk'},
    ].forEach(({fn, platform}) => {
        const hooks = fn()
        if (hooks) confirmHooks.push({...hooks, platform})
    })
})

// 只读文件头 N 字节，按行切分，丢弃可能截断的最后一行
function readFileHeadLines(path, maxBytes = 4096) {
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(maxBytes);
        const n = readSync(fd, buf, 0, maxBytes, 0);
        const text = buf.toString('utf8', 0, n);
        const lastNL = text.lastIndexOf('\n');
        return (lastNL >= 0 ? text.slice(0, lastNL) : text).split('\n');
    } finally {
        closeSync(fd);
    }
}

// ---- Project scanning (hand-rolled) ----
let _projectsCache = null, _projectsCacheTs = 0
const PROJECTS_CACHE_TTL = 10_000  // 10s 内复用缓存，避免每次 /p 命令触发全量扫描

async function scanProjects() {
    const now = Date.now()
    if (_projectsCache && (now - _projectsCacheTs) < PROJECTS_CACHE_TTL) return _projectsCache

    const base = join(CLAUDE_HOME, 'projects');
    const results = []
    try {
        for (const name of readdirSync(base)) {
            const full = join(base, name);
            if (!statSync(full).isDirectory()) continue
            const files = readdirSync(full).filter(f => f.endsWith('.jsonl'))
                .map(f => ({name: f, mtime: statSync(join(full, f)).mtimeMs}))
                .sort((a, b) => b.mtime - a.mtime)
                .map(f => f.name);
            if (!files.length) continue
            let wd = null
            try {
                const head = readFileHeadLines(join(full, files[0]), 4096);
                const c = head.join('\n');
                const m = c.match(/"cwd":\s*"([^"]+)"/);
                if (m) wd = m[1].replace(/\\/g, '/')
            } catch {
            }
            if (!wd) {
                wd = decodeProjectName(name) || name
            }
            const sds = files.map(f => {
                const id = f.replace('.jsonl', '');
                let t = id.slice(0, 8);
                try {
                    const l = readFileHeadLines(join(full, f), 4096);
                    for (let i = 0; i < l.length; i++) {
                        if (!l[i].trim()) continue;
                        const e = JSON.parse(l[i]);
                        let x = e.content || '';
                        if (!x && e.message?.content) x = typeof e.message.content === 'string' ? e.message.content : (Array.isArray(e.message.content) ? (e.message.content.find(b => b.type === 'text')?.text || '') : '');
                        if (x && !String(x).startsWith('<task-notification')) {
                            t = String(x).slice(0, 50);
                            break
                        }
                    }
                } catch {
                }
                ;
                return {id, title: t, size: statSync(join(full, f)).size}
            })
            const ex = results.find(r => r.workDir === wd)
            if (ex) {
                for (const s of sds) {
                    if (!ex.sessions.find(es => es.id === s.id)) ex.sessions.push(s)
                }
                ;ex.sessionCount = ex.sessions.length;
                const lm = await getLastModified(full, files);
                if (lm > (ex.lastActive || 0)) ex.lastActive = lm;
                continue
            }
            results.push({
                workDir: wd,
                encodedDir: name,
                sessionCount: files.length,
                sessions: sds,
                lastActive: await getLastModified(full, files)
            })
        }
    } catch {
    }
    ;results.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
    _projectsCache = results; _projectsCacheTs = Date.now()
    return results
}
function invalidateProjectsCache() { _projectsCache = null }

async function listProjectSessions(ed) {
    const base = join(CLAUDE_HOME, 'projects', ed);
    const r = []
    try {
        for (const f of readdirSync(base).filter(x => x.endsWith('.jsonl'))) {
            const id = f.replace('.jsonl', '');
            const st = statSync(join(base, f));
            let t = id.slice(0, 8);
            try {
                const l = readFileHeadLines(join(base, f), 4096);
                for (let i = 0; i < l.length; i++) {
                    if (!l[i].trim()) continue;
                    const e = JSON.parse(l[i]);
                    let x = e.content || '';
                    if (!x && e.message?.content) x = typeof e.message.content === 'string' ? e.message.content : (Array.isArray(e.message.content) ? (e.message.content.find(b => b.type === 'text')?.text || '') : '');
                    if (x && !String(x).startsWith('<task-notification')) {
                        t = String(x).slice(0, 50);
                        break
                    }
                }
            } catch {
            }
            ;r.push({id, title: t, size: st.size, mtime: st.mtimeMs})
        }
    } catch {
    }
    r.sort((a, b) => b.mtime - a.mtime);
    return r
}

async function loadMessages(ed, sessionId) {
    const fp = join(CLAUDE_HOME, 'projects', ed, sessionId + '.jsonl');
    const m = []
    try {
        const d = readFileSync(fp, 'utf8');
        for (const l of d.split('\n')) {
            if (!l.trim()) continue;
            try {
                const e = JSON.parse(l);
                if (e.type === 'user' && e.message?.content) {
                    const t = typeof e.message.content === 'string' ? e.message.content : e.message.content.map(b => b.type === 'text' ? b.text : '').join(' ').trim();
                    if (t) m.push({role: 'user', text: t.slice(0, 500), time: e.timestamp})
                } else if (e.type === 'assistant' && e.message?.content) {
                    for (const b of Array.isArray(e.message.content) ? e.message.content : [e.message.content]) {
                        if (b?.type === 'text' && b.text) m.push({
                            role: 'assistant',
                            text: b.text.slice(0, 500),
                            time: e.timestamp
                        })
                    }
                }
            } catch {
            }
        }
    } catch {
        return m
    }
    return m.slice(-30)
}

async function getLastModified(dir, files) {
    let l = 0;
    for (const f of files) {
        try {
            const s = statSync(join(dir, f));
            if (s.mtimeMs > l) l = s.mtimeMs
        } catch {
        }
    }
    ;
    return l
}

// ════════════════════════ 文件快照 Diff ════════════════════════

// 按扩展名判断是否二进制文件（不做内容 diff）
function isBinaryPath(p) {
    const dot = p.lastIndexOf('.')
    if (dot < 0) return false
    return BINARY_EXTS.has(p.slice(dot).toLowerCase())
}

// 规范化路径：统一用正斜杠 + 折叠多余斜杠（workDir 可能含 // 双斜杠）
function normPath(p) {
    return String(p).replace(/\\/g, '/').replace(/\/+/g, '/')
}

// 安全解析：把相对路径拼到 workDir 下，拒绝越权（.. / 绝对路径）
// 返回绝对路径；非法返回 null
function resolveSafe(workDir, relPath) {
    if (!relPath || typeof relPath !== 'string') return null
    // 统一分隔符，拒绝绝对路径与 .. 段
    const norm = relPath.replace(/\\/g, '/')
    if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return null
    if (norm.split('/').some(seg => seg === '..')) return null
    const abs = join(workDir, norm)
    // 二次校验：解析后仍须在 workDir 内（两边都规范化，兼容 // 双斜杠）
    const wdNorm = normPath(workDir).replace(/\/$/, '')
    const absNorm = normPath(abs)
    if (absNorm !== wdNorm && !absNorm.startsWith(wdNorm + '/')) return null
    return abs
}

// 栈式递归扫描工作目录，跳过排除目录。返回扁平相对路径列表。
// SIDE_EFFECT: 无（只读文件系统）
// ── scanWorkdirFiles — 扫描工作目录文件列表 ──
// 功能说明: 深度遍历工作目录，排除 node_modules/.git 等目录和二进制文件，生成路径列表
// 实现方式: 栈迭代 BFS（非递归，避免深层目录栈溢出），每个文件记录 rel 路径 + 大小 + 是否二进制
//   超过 MAX_SNAP_FILES (5000) 时标记 truncated=true 并中断
// 关键数据流: workDir → stack BFS 遍历 → [{path, size, binary}] → {files, truncated, missing}
function scanWorkdirFiles(workDir) {
    const files = []
    let truncated = false
    if (!existsSync(workDir)) return {files, truncated, missing: true}
    const stack = [workDir]
    while (stack.length) {
        if (files.length >= MAX_SNAP_FILES) {
            truncated = true;
            break
        }
        const dir = stack.pop()
        let entries
        try {
            entries = readdirSync(dir, {withFileTypes: true})
        } catch {
            continue
        }
        for (const ent of entries) {
            const full = join(dir, ent.name)
            if (ent.isDirectory()) {
                if (SNAP_EXCLUDE_DIRS.has(ent.name)) continue
                stack.push(full)
            } else if (ent.isFile()) {
                if (files.length >= MAX_SNAP_FILES) {
                    truncated = true;
                    break
                }
                let size = 0
                try {
                    size = statSync(full).size
                } catch {
                }
                // relative() 规范化两边，兼容 workDir 里的 // 双斜杠
                const rel = relative(workDir, full).replace(/\\/g, '/')
                files.push({path: rel, size, binary: isBinaryPath(rel)})
            }
        }
    }
    return {files, truncated, missing: false}
}

// ── buildFileSnapshot — 工作目录文件快照构建 ──
// 功能说明: 为工作目录创建完整文件内容快照，用作每个 session 的 diff 基线
//   文本文件存储完整内容 + sha256 hash；二进制文件仅存元信息(size, lastModified)；超大文件跳过内容
// 实现方式: scanWorkdirFiles → 逐文件读内容 → sha256 hash → 构建 {path→{content,hash,size}} Map
// SIDE_EFFECT: 无（只读文件系统）；返回对象会挂到 session.snapshot
// 关键数据流: scanWorkdirFiles() → 读文件+hash → snapshot{files:{path,content?,hash?,size?,binary?,mtime?},fileMap{}}
function buildFileSnapshot(workDir) {
    const {files, truncated} = scanWorkdirFiles(workDir)
    const map = new Map()
    for (const f of files) {
        if (f.binary) {
            map.set(f.path, {binary: true, size: f.size});
            continue
        }
        if (f.size > MAX_SNAP_FILE_BYTES) {
            map.set(f.path, {binary: false, tooLarge: true, size: f.size});
            continue
        }
        try {
            const content = readFileSync(join(workDir, f.path), 'utf8')
            map.set(f.path, {
                binary: false,
                content,
                size: f.size,
                lines: content.length ? content.split('\n').length : 0
            })
        } catch {
            map.set(f.path, {binary: false, readError: true, size: f.size})
        }
    }
    return {takenAt: Date.now(), files: map, truncated}
}

// 滚动数组只算 LCS 长度（O(min) 空间）——给徽章算 +x/-y 用，轻量
// ── lcsLength — 最长公共子序列长度（DP 滚动数组，O(n*m) 时间，O(min(n,m)) 空间）──
// 功能说明: 计算两个字符串数组的最长公共子序列长度，用于 lineDiffStats 估算改动行数
// 实现方式: 二维 DP 压缩为两个一维滚动数组（prev + cur），每次迭代复用降低内存
//   让 b 为较短边以减少滚动数组长度
function lcsLength(a, b) {
    if (a.length === 0 || b.length === 0) return 0
    // 让 b 为较短的一边
    if (b.length > a.length) {
        const t = a;
        a = b;
        b = t
    }
    const m = b.length
    let prev = new Array(m + 1).fill(0)
    let cur = new Array(m + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= m; j++) {
            if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1] + 1
            else cur[j] = prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]
        }
        const tmp = prev;
        prev = cur;
        cur = tmp
        cur.fill(0)
    }
    return prev[m]
}

// 用 LCS 算改动行数：added = 新行数 - 公共，removed = 旧行数 - 公共
function lineDiffStats(oldStr, newStr) {
    const a = oldStr.length ? oldStr.split('\n') : []
    const b = newStr.length ? newStr.split('\n') : []
    const lcs = lcsLength(a, b)
    return {added: b.length - lcs, removed: a.length - lcs}
}

// ── computeLineDiff — 完整行级 diff（DP + 回溯）──
// 功能说明: 计算两个文本的逐行差异，返回 type/oldNo/newNo/text 结构供 Monaco diff 渲染
//   仅点 diff 按钮时按需调用一次，不在文件列表渲染时批量触发
// 实现方式: 二维 DP (n+1)*(m+1) 计算 LCS 矩阵，再双向回溯生成 diff 行序列
//   矩阵元素超过 4M (a.length*b.length>4_000_000) 时返回 {tooLarge:true} 避免 OOM
// 关键数据流: oldStr/newStr → split('\n') → DP LCS 矩阵 → 回溯 → [{type,oldNo,newNo,text}]
function computeLineDiff(oldStr, newStr) {
    const a = oldStr.length ? oldStr.split('\n') : []
    const b = newStr.length ? newStr.split('\n') : []
    if (a.length * b.length > 4_000_000) return {tooLarge: true}
    const n = a.length, m = b.length
    // dp[i][j] = LCS(a[i:], b[j:])
    const dp = Array.from({length: n + 1}, () => new Int32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
            else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1]
        }
    }
    const lines = []
    let i = 0, j = 0, oldNo = 1, newNo = 1
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            lines.push({type: 'context', oldNo: oldNo++, newNo: newNo++, text: a[i]});
            i++;
            j++
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: a[i]});
            i++
        } else {
            lines.push({type: 'add', oldNo: null, newNo: newNo++, text: b[j]});
            j++
        }
    }
    while (i < n) {
        lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: a[i]});
        i++
    }
    while (j < m) {
        lines.push({type: 'add', oldNo: null, newNo: newNo++, text: b[j]});
        j++
    }
    return {lines}
}

// ── diffSnapshotVsCurrent — 快照 vs 当前工作目录文件差异对比 ──
// 功能说明: 将 session 起始快照与当前工作目录文件对比，识别新增/修改/删除/未变四种状态
//   结果用于文件面板「仅改动」过滤 + 记录点自动生成 + 提交确认
// 实现方式:
//   1. 当前文件 > 快照文件: 先建 hash 快速查找表(snap.fileMap)
//   2. 逐当前文件比对: 无 snapshot 记录→added; hash 匹配→unchanged; hash 不同→modified
//   3. 快照中有但当前无: deleted 状态
//   4. 二进制文件用 lastModified 时间戳代替内容 hash（二进制文件读全量太贵）
//   5. modified 文件用 lineDiffStats 快速计算 added/removed 行数（仅统计，不做逐行 diff）
// 关键数据流: snapshot.fileMap{} + currentFiles[] → 逐文件 hash/lastModified 对比
//   → Map<path, {status,added,removed,binary}>
function diffSnapshotVsCurrent(snapshot, currentFiles, workDir) {
    const result = new Map()
    const snapFiles = snapshot.files
    const seen = new Set()
    for (const f of currentFiles) {
        seen.add(f.path)
        const snap = snapFiles.get(f.path)
        if (!snap) {
            // 快照里没有 → 新增
            result.set(f.path, {status: 'added', binary: f.binary, added: null, removed: 0})
            continue
        }
        if (f.binary || snap.binary) {
            // 二进制：只按 size 判断改没改
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: true, added: null, removed: null})
            continue
        }
        if (snap.tooLarge || snap.readError) {
            // 快照没存内容，只能按 size 粗判
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
            continue
        }
        // 文本文件：读当前内容对比
        let cur = null
        try {
            if (f.size <= MAX_SNAP_FILE_BYTES) cur = readFileSync(join(workDir, f.path), 'utf8')
        } catch {
        }
        if (cur == null) {
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
        } else if (cur === snap.content) {
            result.set(f.path, {status: 'unchanged', binary: false, added: 0, removed: 0})
        } else {
            const st = lineDiffStats(snap.content, cur)
            result.set(f.path, {status: 'modified', binary: false, added: st.added, removed: st.removed})
        }
    }
    // 快照有、当前没有 → 删除
    for (const [path, snap] of snapFiles) {
        if (seen.has(path)) continue
        result.set(path, {status: 'deleted', binary: !!snap.binary, added: 0, removed: snap.lines ?? null})
    }
    return result
}

// ════════════════════════ 记录点（Checkpoint）持久化 + 回退 ════════════════════════
// 每轮用户消息 = 一个记录点，只存改动文件的「修改前内容」增量，落盘项目存储跨重启存活。

// ── 基线快照持久化（让文件面板「仅改动」在重启/resume 后仍以会话起始为基线）──
// SIDE_EFFECT: 读写 bridge-snapshot/<sessionId>.json
function snapshotStorePath(workDir, sessionId) {
    return join(CLAUDE_HOME, 'projects', encodeProjectName(workDir), 'bridge-snapshot', sessionId + '.json')
}

function saveSnapshot(s, sessionId) {
    try {
        if (!s?.snapshot) return
        const fp = snapshotStorePath(s.workDir, sessionId)
        if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true})
        // Map 不能直接 JSON，转 entries 数组
        const obj = {
            takenAt: s.snapshot.takenAt,
            truncated: s.snapshot.truncated,
            files: [...s.snapshot.files.entries()]
        }
        writeFileSync(fp, JSON.stringify(obj), 'utf8')
    } catch (e) {
        log.warn({err: e}, 'snapshot 保存失败')
    }
}

function loadSnapshot(workDir, sessionId) {
    const d = readJSON(snapshotStorePath(workDir, sessionId))
    if (!d || !Array.isArray(d.files)) return null
    return {takenAt: d.takenAt, truncated: !!d.truncated, files: new Map(d.files)}
}

// 记录点落盘路径：~/.claude/projects/<encoded>/bridge-checkpoints/<sessionId>.json
function checkpointStorePath(workDir, sessionId) {
    return join(CLAUDE_HOME, 'projects', encodeProjectName(workDir), 'bridge-checkpoints', sessionId + '.json')
}

// 从磁盘载入历史记录点（resume 续接用）；失败返回空数组
function loadCheckpoints(workDir, sessionId) {
    const d = readJSON(checkpointStorePath(workDir, sessionId))
    return Array.isArray(d?.checkpoints) ? d.checkpoints : []
}

// 落盘当前 session 的记录点（含 before 增量内容）
// SIDE_EFFECT: 写 bridge-checkpoints/<sessionId>.json
function saveCheckpoints(s, sessionId) {
    try {
        const fp = checkpointStorePath(s.workDir, sessionId)
        if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true})
        writeFileSync(fp, JSON.stringify({workDir: s.workDir, checkpoints: s.checkpoints || []}), 'utf8')
    } catch (e) {
        log.warn({err: e}, 'checkpoint 保存失败')
    }
}

// ── beginTurn — 回合开始：记录修改前状态 ──
// 功能说明: 在 Claude 每轮开始处理用户消息前，拍下「修改前」快照并记录 prompt，
//   供 finalizeCheckpoint 在回合结束时对比 diff，生成记录点
// 实现方式: buildFileSnapshot(workDir) → 写 pendingTurn{preSnapshot, prompt, time}
//   构建失败时 pendingTurn=null，后续 finalizeCheckpoint 会跳过
// SIDE_EFFECT: mutates session.pendingTurn
function beginTurn(sessionId, prompt) {
    const s = sessions.get(sessionId);
    if (!s) return
    try {
        s.pendingTurn = {
            prompt: String(prompt || '').slice(0, 500),
            preSnapshot: buildFileSnapshot(s.workDir),
            time: Date.now()
        }
    } catch (e) {
        log.warn({err: e}, 'beginTurn snapshot 失败');
        s.pendingTurn = null
    }
}

// ── finalizeCheckpoint — 回合结束：对比修改前后的文件差异，生成记录点 ──
// 功能说明: 在 Claude 每轮完成后（收到 result 事件），diff 本轮修改前(preSnapshot) vs 当前文件状态，
//   识别变更文件及其 before/after 内容，组装 checkpoint 对象追加到 session.checkpoints
// 实现方式:
//   1. diffSnapshotVsCurrent(preSnapshot, currentFiles) → diffMap
//   2. 逐变更文件构造 {path,status,added,removed,before,notRevertible}
//   3. 修改前内容从 preSnapshot.files.get(path).content 获取
//   4. 二进制/超大文件标记 notRevertible=true（无可回退内容）
//   5. checkpointSeq 递增生成唯一 ID (cp-{seq})
//   6. 同步更新 session.snapshot 为当前状态（作为新一轮的基线）
// SIDE_EFFECT: mutates session.checkpoints/snapshot/pendingTurn + 落盘 bridge-checkpoints/<sessionId>.json
function finalizeCheckpoint(sessionId) {
    const s = sessions.get(sessionId);
    if (!s || !s.pendingTurn) return
    const pre = s.pendingTurn.preSnapshot;
    const prompt = s.pendingTurn.prompt;
    const time = s.pendingTurn.time
    s.pendingTurn = null
    if (!pre) return
    const scan = scanWorkdirFiles(s.workDir)
    if (scan.missing) return
    const diffMap = diffSnapshotVsCurrent(pre, scan.files, s.workDir)
    const files = []
    let revertible = true
    for (const [path, d] of diffMap) {
        if (d.status === 'unchanged') continue
        const snap = pre.files.get(path)
        let before = null, notRevertible = false
        if (d.status === 'added') {
            before = null  // 本轮新增 → 回退时删除
        } else {
            // modified / deleted → 需要修改前内容才能回写
            if (snap && !snap.binary && !snap.tooLarge && !snap.readError && typeof snap.content === 'string') before = snap.content
            else {
                notRevertible = true;
                revertible = false
            }  // 二进制/超大/读失败 → 该文件不可回退
        }
        files.push({path, status: d.status, before, notRevertible, added: d.added, removed: d.removed})
    }
    if (!files.length) return  // 本轮没动文件，不建记录点
    if (!s.checkpoints) s.checkpoints = []
    s.checkpointSeq = (s.checkpointSeq || 0) + 1
    s.checkpoints.push({id: `cp-${s.checkpointSeq}`, prompt, time, files, revertible})
    saveCheckpoints(s, sessionId)
    // 注意：不要在这里重置 session.snapshot —— 文件面板「仅改动」依赖会话起始基线，
    // 重置会让累计改动清零导致「仅改动」空白。记录点用自己的 per-turn preSnapshot，互不影响。
}

// 回退到指定记录点之前的状态：倒序撤销该记录点及其之后的所有轮次
// dryRun=true 仅预览受影响文件，不写盘
// ── rewindToCheckpoint — 文件回退到指定记录点 ──
// 功能说明: 将工作目录的所有文件回退到目标 checkpoint 之前的状态
//   倒序遍历从尾部到目标 index 的所有 checkpoint，逐文件还原:
//     added → 删除文件; modified/deleted → 写回 before 内容
//   dryRun=true 时仅计算影响面不实际写盘（用于前置校验）
// 实现方式: 从 cps.length-1 到 idx 倒序处理，每轮按 status 类型决定恢复操作
//   回退完成后截断 checkpoints 数组到 idx 之前，保存到磁盘
// 关键数据流: checkpoints[idx..] → 倒序恢复文件 → cps.slice(0, idx) → saveCheckpoints
// SIDE_EFFECT: 写/删工作目录文件 + 截断 session.checkpoints（不动文件面板基线）
function rewindToCheckpoint(sessionId, checkpointId, dryRun) {
    const s = sessions.get(sessionId);
    if (!s) return {ok: false, error: 'session_not_found'}
    const cps = s.checkpoints || []
    const idx = cps.findIndex(c => c.id === checkpointId)
    if (idx < 0) return {ok: false, error: 'checkpoint_not_found'}
    // 待撤销范围：[idx, 末尾]，倒序应用保证最终回到 idx 轮之前的状态
    const affected = new Set()
    let blocked = []
    for (let i = cps.length - 1; i >= idx; i--) {
        for (const f of cps[i].files) {
            if (f.notRevertible) {
                blocked.push(f.path);
                continue
            }
            affected.add(f.path)
            if (dryRun) continue
            const abs = resolveSafe(s.workDir, f.path)
            if (!abs) continue
            try {
                if (f.status === 'added') {
                    if (existsSync(abs)) unlinkSync(abs)
                }  // 新增 → 删除
                else {
                    if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), {recursive: true});
                    writeFileSync(abs, f.before ?? '', 'utf8')
                }  // 改/删 → 写回
            } catch (e) {
                log.warn({err: e, path: f.path}, 'rewind write 失败')
            }
        }
    }
    if (dryRun) return {ok: true, dryRun: true, files: [...affected], blocked}
    // 截断记录点到 idx 之前 + 落盘（不动 session.snapshot：回退后仍以会话起始为基线对比）
    s.checkpoints = cps.slice(0, idx)
    saveCheckpoints(s, sessionId)
    return {ok: true, reverted: [...affected], blocked, remaining: s.checkpoints.length}
}
