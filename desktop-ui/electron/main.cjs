/**
 * Electron 主进程入口
 * <https://github.com/kankancuige/claude-desktop-bridge>
 * ── 功能说明 ──
 * 负责：gateway 子进程生命周期管理（启动/停止/自动重启）、BrowserWindow 创建、
 * IPC 通信处理（窗口控制、gateway 重启、目录选择）、日志重定向到文件。
 * ── 架构 ──
 * gateway 以 ELECTRON_RUN_AS_NODE=1 模式复用 Electron 内置 Node.js 运行 index.mjs，
 * 避免额外依赖外部 Node 运行时。gateway 崩溃后最多自动重启 MAX_RESTARTS 次。
 */

const { app, BrowserWindow, shell, ipcMain, dialog, Tray, Menu, nativeImage, safeStorage } = require('electron')
const { spawn } = require('child_process')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const {normalizeExternalUrl} = require('./external-url.cjs')
const {openDirectoryInShell} = require('./open-directory.cjs')
const { checkForUpdates, downloadUpdate, quitAndInstall } = require('./updater.cjs')
const {resolveBridgeHome} = require('./bridge-home.cjs')
const {decideGatewayRestart} = require('./gateway-restart-policy.cjs')

const BRIDGE_HOME = resolveBridgeHome()

// ── 全局状态 ──
let mainWindow = null           // 主窗口实例，全局唯一
let tray = null                 // 系统托盘图标实例
let gatewayProcess = null       // gateway 子进程句柄，null 表示未运行
const stoppingGatewayProcesses = new WeakSet()
let gatewayRestarts = 0         // 当前生命周期内已重启次数
let gatewayRestartTimer = null  // 自动重启定时器，退出/手动重启时必须取消
let gatewayStableTimer = null   // 连续稳定运行后清零重启预算
const MAX_RESTARTS = 5          // 最大自动重启次数，防止无限重启循环
const GATEWAY_STABLE_RESET_MS = 5 * 60 * 1000
let GATEWAY_LOG = ''            // gateway 日志文件路径，在 app.whenReady 中初始化
let isQuitting = false          // 真退出标记，区分"关闭窗口"和"退出应用"
let quitCleanupStarted = false
let gatewaySecurePayloadKey = null

const ownsAppInstance = app.requestSingleInstanceLock()
if (!ownsAppInstance) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

/**
 * ── 写入 gateway 日志文件（异步队列，不阻塞事件循环）──
 * 写入请求入队后由 drain 循环逐个消费，保证日志顺序不交错。
 * 队列有上限；异常刷屏时丢弃最旧记录，避免主进程内存持续增长。
 */
let _logQueue = []
let _logDraining = false
const MAX_LOG_QUEUE = 2000  // 日志队列上限，防止异常刷屏时内存无限增长
const MAX_LOG_BYTES = 10 * 1024 * 1024
const MAX_LOG_FILES = 7
let _logDay = ''

function rotateGatewayLogIfNeeded(incomingBytes = 0) {
  if (!GATEWAY_LOG) return
  const today = new Date().toISOString().slice(0, 10)
  let currentSize = 0
  try { currentSize = fs.statSync(GATEWAY_LOG).size } catch (error) {
    if (error?.code !== 'ENOENT') console.error('[main] gateway 日志状态读取失败:', error.message)
  }
  if (_logDay && _logDay !== today || currentSize + incomingBytes > MAX_LOG_BYTES) {
    for (let index = MAX_LOG_FILES - 1; index >= 1; index--) {
      const source = `${GATEWAY_LOG}.${index}`
      const target = `${GATEWAY_LOG}.${index + 1}`
      try { if (fs.existsSync(source)) fs.renameSync(source, target) } catch (error) { console.error('[main] gateway 日志轮转失败:', error.message) }
    }
    try { if (fs.existsSync(GATEWAY_LOG)) fs.renameSync(GATEWAY_LOG, `${GATEWAY_LOG}.1`) } catch (error) { console.error('[main] gateway 日志归档失败:', error.message) }
  }
  _logDay = today
}

function logToFile(msg) {
  if (!GATEWAY_LOG) return
  const line = `[${new Date().toISOString()}] ${msg}\n`
  if (_logQueue.length >= MAX_LOG_QUEUE) _logQueue.shift()  // 丢弃最旧日志
  _logQueue.push(line)
  if (!_logDraining) drainLogQueue()
}
function drainLogQueue() {
  _logDraining = true
  // 使用 setImmediate 迭代，避免 process.nextTick 饿死其他 IO
  function next() {
    if (_logQueue.length === 0) { _logDraining = false; return }
    const batch = _logQueue
    _logQueue = []
    rotateGatewayLogIfNeeded(Buffer.byteLength(batch.join('')))
    fs.appendFile(GATEWAY_LOG, batch.join(''), (err) => {
      if (err) console.error('[main] gateway 日志写入失败:', err.message)
      setImmediate(next)
    })
  }
  setImmediate(next)
}

function readBridgeSecurePayloadKey() {
  const keyPath = path.join(BRIDGE_HOME, 'bridge-store-key')
  try {
    const encoded = fs.readFileSync(keyPath, 'utf8').trim()
    const key = Buffer.from(encoded, 'hex')
    if (key.length === 32) return {key, keyPath}
  } catch (error) {
    if (error?.code !== 'ENOENT') logToFile(`[WARN] Bridge secure key read failed: ${error.message}`)
  }
  return {key: null, keyPath}
}

function getGatewaySecurePayloadKey() {
  if (gatewaySecurePayloadKey) return gatewaySecurePayloadKey
  const {key: bridgeKey, keyPath} = readBridgeSecurePayloadKey()
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : null
  const canUseOsStore = safeStorage.isEncryptionAvailable() && backend !== 'basic_text'

  if (!canUseOsStore) {
    const key = bridgeKey || crypto.randomBytes(32)
    if (!bridgeKey) {
      fs.mkdirSync(path.dirname(keyPath), {recursive: true})
      fs.writeFileSync(keyPath, key.toString('hex'), {encoding: 'utf8', mode: 0o600})
    }
    logToFile('[WARN] OS secure storage unavailable; using permission-restricted local key')
    gatewaySecurePayloadKey = key.toString('base64')
    return gatewaySecurePayloadKey
  }

  const protectedPath = path.join(app.getPath('userData'), 'bridge-store-key.bin')
  let key = null
  if (fs.existsSync(protectedPath)) {
    const decrypted = safeStorage.decryptString(fs.readFileSync(protectedPath))
    const decoded = Buffer.from(decrypted, 'hex')
    if (decoded.length !== 32) throw new Error('OS-protected secure payload key is invalid')
    key = decoded
  } else {
    key = bridgeKey || crypto.randomBytes(32)
    fs.mkdirSync(path.dirname(protectedPath), {recursive: true})
    const tmp = `${protectedPath}.tmp`
    fs.writeFileSync(tmp, safeStorage.encryptString(key.toString('hex')), {mode: 0o600})
    fs.renameSync(tmp, protectedPath)
  }
  gatewaySecurePayloadKey = key.toString('base64')
  return gatewaySecurePayloadKey
}

/**
 * ── 启动 gateway 子进程 ──
 * 功能说明: 以 ELECTRON_RUN_AS_NODE 模式启动 gateway/index.mjs
 * 实现方式:
 *   1. 根据 VITE_DEV_SERVER_URL 判断开发/生产环境，决定 gateway 目录路径
 *   2. 开发环境: 相对于 __dirname 的 ../../gateway
 *   3. 生产环境: process.resourcesPath 下的 gateway 目录（打包后 extraResources）
 *   4. 重定向 stdout/stderr 到主进程输出 + 日志文件
 *   5. 监听 exit 事件：非零退出码时自动重启（最多 MAX_RESTARTS 次，间隔 2 秒）
 * SIDE_EFFECT: 设置 gatewayProcess 全局变量；写入日志文件
 */
function startGateway() {
  if (gatewayProcess || isQuitting || !ownsAppInstance) return
  // ── 计算 gateway 目录和入口文件路径 ──
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  const gatewayDir = isDev
    ? path.join(__dirname, '../../gateway')
    : path.join(process.resourcesPath, 'gateway')
  const gatewayEntry = path.join(gatewayDir, 'index.mjs')

  logToFile(`Starting gateway: ${gatewayEntry}`)
  logToFile(`Gateway dir: ${gatewayDir}`)

  // ELECTRON_RUN_AS_NODE=1 让 electron.exe 作为纯 Node.js 运行，不创建窗口
  let securePayloadKey
  try {
    securePayloadKey = getGatewaySecurePayloadKey()
  } catch (error) {
    logToFile(`[ERROR] secure payload key unavailable: ${error.message}`)
    return
  }

  const proc = spawn(process.execPath, [gatewayEntry], {
    cwd: gatewayDir,                              // 工作目录设为 gateway 目录，确保相对路径正确
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],       // IPC 用于 Windows 下可靠的优雅关闭
    windowsHide: true,                            // Windows 下隐藏控制台窗口
    env: { ...process.env, BRIDGE_HOME, ELECTRON_RUN_AS_NODE: '1' },  // 子进程与 Electron 共用 Bridge 私有目录
  })
  gatewayProcess = proc
  proc.on('message', (message) => {
    if (message?.type !== 'bridge:init-request') return
    try {
      proc.send({type: 'bridge:init', securePayloadKey})
    } catch (error) {
      logToFile(`[ERROR] gateway secure initialization failed: ${error.message}`)
    }
  })
  if (gatewayStableTimer) clearTimeout(gatewayStableTimer)
  gatewayStableTimer = setTimeout(() => {
    if (gatewayProcess === proc) {
      gatewayRestarts = 0
      logToFile('[RECOVERY] gateway stable; restart budget reset')
    }
    gatewayStableTimer = null
  }, GATEWAY_STABLE_RESET_MS)
  gatewayStableTimer.unref?.()

  // ── stdout 重定向：输出到主进程 stdout 并写入日志 ──
  proc.stdout.on('data', (d) => {
    const msg = d.toString()
    process.stdout.write(`[gw] ${msg}`)
    logToFile(`[stdout] ${msg.trim()}`)
  })

  // ── stderr 重定向：输出到主进程 stderr 并写入日志 ──
  proc.stderr.on('data', (d) => {
    const msg = d.toString()
    process.stderr.write(`[gw:err] ${msg}`)
    logToFile(`[stderr] ${msg.trim()}`)
  })

  // ── spawn 错误处理：如可执行文件不存在、权限不足等 ──
  proc.on('error', (e) => {
    logToFile(`[ERROR] spawn failed: ${e.message}`)
  })

  // ── 退出处理：非零退出码时自动重启（指数退避简化为固定 2s） ──
  proc.on('exit', (code) => {
    logToFile(`[EXIT] code=${code}`)
    if (gatewayStableTimer) {
      clearTimeout(gatewayStableTimer)
      gatewayStableTimer = null
    }
    if (gatewayProcess === proc) gatewayProcess = null
    if (stoppingGatewayProcesses.has(proc)) return
    if (isQuitting) return  // 退出中，不重启
    const restart = decideGatewayRestart({
      exitCode: code,
      restartCount: gatewayRestarts,
      maxRestarts: MAX_RESTARTS,
    })
    gatewayRestarts = restart.restartCount
    if (restart.shouldRestart) {
      logToFile(`[RESTART] ${gatewayRestarts}/${MAX_RESTARTS}`)
      logToFile(`[RESTART] retrying in ${restart.delayMs}ms`)
      gatewayRestartTimer = setTimeout(() => {
        gatewayRestartTimer = null
        startGateway()
      }, restart.delayMs)
      gatewayRestartTimer.unref?.()
    }
  })

  logToFile('Gateway spawned')
}

/**
 * ── 停止 gateway 子进程 ──
 * 功能说明: 优雅关闭 gateway，先发 SIGTERM，3 秒后未退出则强杀 SIGKILL
 * 实现方式:
 *   1. 发送 SIGTERM 给子进程（允许 gateway 做清理工作）
 *   2. 设置 3 秒超时：若进程仍未退出（killed 标志为 false），发送 SIGKILL 强制终止
 *   3. 立即置 gatewayProcess = null，防止 stopGateway 被重复调用时重复 kill
 * SIDE_EFFECT: 清空 gatewayProcess 全局引用
 */
function stopGateway() {
  if (gatewayRestartTimer) {
    clearTimeout(gatewayRestartTimer)
    gatewayRestartTimer = null
  }
  if (gatewayStableTimer) {
    clearTimeout(gatewayStableTimer)
    gatewayStableTimer = null
  }
  const proc = gatewayProcess
  if (!proc) return Promise.resolve()
  stoppingGatewayProcesses.add(proc)
  if (gatewayProcess === proc) gatewayProcess = null

  return new Promise((resolve) => {
    let settled = false
    let termTimer = null
    let killTimer = null
    let resolveTimer = null
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(termTimer)
      clearTimeout(killTimer)
      clearTimeout(resolveTimer)
      resolve()
    }
    proc.once('exit', finish)
    try {
      if (proc.connected) proc.send({type: 'shutdown'})
      else proc.kill('SIGTERM')
    } catch (error) {
      logToFile(`[WARN] graceful gateway stop failed: ${error.message}`)
      try { proc.kill('SIGTERM') } catch (killError) {
        logToFile(`[WARN] gateway SIGTERM failed: ${killError.message}`)
      }
    }
    termTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try { proc.kill('SIGTERM') } catch (error) {
          logToFile(`[WARN] gateway SIGTERM timeout kill failed: ${error.message}`)
        }
      }
    }, 2500)
    killTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try { proc.kill('SIGKILL') } catch (error) {
          logToFile(`[WARN] gateway SIGKILL failed: ${error.message}`)
        }
      }
    }, 3500)
    resolveTimer = setTimeout(finish, 4500)
    termTimer.unref?.()
    killTimer.unref?.()
    resolveTimer.unref?.()
  })
}

/**
 * ── 创建主窗口 ──
 * 功能说明: 创建无边框的 BrowserWindow，注册所有 IPC 处理器
 * 实现方式:
 *   1. frame: false + titleBarStyle: 'hidden' 实现自定义标题栏
 *   2. contextIsolation: true + nodeIntegration: false 安全隔离渲染进程
 *   3. preload 脚本通过 contextBridge 暴露安全 API
 *   4. IPC 通道：窗口最小化/最大化/关闭、gateway 重启、日志路径查询、目录选择
 *   5. 开发模式加载 Vite dev server URL，生产模式加载打包后的 dist/index.html
 * SIDE_EFFECT: 设置 mainWindow 全局变量；注册 IPC 处理器
 */
function createWindow() {
  if (isQuitting) return
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 960,
    minWidth: 1200,                               // 最小宽度限制，防止布局崩溃
    minHeight: 700,                               // 最小高度限制
    title: 'Claude Desktop Bridge',
    frame: false,                                 // 无系统边框，使用自定义标题栏
    titleBarStyle: 'hidden',                      // macOS 下隐藏原生标题栏
    backgroundColor: '#1A1D28',                   // 窗口加载前背景色，与暗色主题一致
    autoHideMenuBar: true,                        // 自动隐藏菜单栏
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), // 预加载脚本路径
      contextIsolation: true,                     // 开启上下文隔离（安全）
      nodeIntegration: false,                     // 禁止渲染进程直接使用 Node API
      sandbox: true,
    },
  })

  // 确保菜单栏完全不可见
  mainWindow.setMenuBarVisibility(false)

  // createWindow 可能在 macOS activate 后再次执行；先移除本应用拥有的 IPC，避免重复 handler/listener。
  for (const channel of [
    'window:minimize', 'window:maximize', 'window:close', 'window:show', 'app:quit',
    'update:install', 'gateway:restart',
  ]) ipcMain.removeAllListeners(channel)
  for (const channel of [
    'window:isMaximized', 'getAppVersion', 'update:check', 'update:download',
    'getGatewayLogPath', 'getBridgeToken', 'shell:openExternal', 'shell:openDirectory', 'dialog:selectDirectory',
  ]) ipcMain.removeHandler(channel)

  const isTrustedIpcEvent = (event) => {
    const contents = mainWindow?.webContents
    return !!contents
      && event?.sender === contents
      && event?.senderFrame === contents.mainFrame
  }
  const trustedOn = (channel, handler) => {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedIpcEvent(event)) {
        logToFile(`[WARN] rejected IPC event: ${channel}`)
        return
      }
      handler(...args)
    })
  }
  const trustedHandle = (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcEvent(event)) throw new Error('untrusted IPC sender')
      return handler(...args)
    })
  }

  // ── IPC: 窗口控制（单向通信，无返回值） ──
  // 功能说明: 渲染进程通过 ipcRenderer.send 触发，主进程执行对应窗口操作
  trustedOn('window:minimize', () => mainWindow?.minimize())
  trustedOn('window:maximize', () => {
    // 切换最大化/还原状态
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  trustedOn('window:close', () => {
    // 关闭窗口 → 隐藏到托盘（不退出应用）
    mainWindow?.hide()
  })

  // ── IPC: 显示主窗口（托盘用）──
  trustedOn('window:show', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // ── IPC: 真退出应用 ──
  trustedOn('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  // ── IPC: 检查窗口是否最大化 ──
  trustedHandle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // ── IPC: 更新相关 ──
  trustedHandle('getAppVersion', () => app.getVersion())
  trustedHandle('update:check', async () => {
    try {
      const au = require('./updater.cjs').autoUpdater
      if (!au) return { ok: false, blocked: true, error: require('./updater.cjs').unavailableReason }
      const result = await au.checkForUpdates()
      return { ok: true, version: result?.updateInfo?.version }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  trustedHandle('update:download', async () => {
    try {
      await downloadUpdate()
      return {ok: true}
    } catch (error) {
      console.log('[updater] 下载失败:', error.message)
      return {ok: false, error: error.message}
    }
  })
  trustedOn('update:install', () => {
    quitAndInstall()
  })

  // ── IPC: gateway 重启 ──
  // 功能说明: 先停止当前 gateway，重置重启计数器，延迟 500ms 后启动新实例
  trustedOn('gateway:restart', () => {
    gatewayRestarts = 0                           // 手动重启不计入自动重启计数
    void stopGateway().then(() => {
      if (!isQuitting) startGateway()
    })
  })

  // ── IPC: 获取 gateway 日志路径（双向通信，返回字符串） ──
  trustedHandle('getGatewayLogPath', () => GATEWAY_LOG)

  // ── IPC: 获取 Bridge Token（本地 API 认证） ──
  trustedHandle('getBridgeToken', () => {
    try {
      const tokenPath = path.join(BRIDGE_HOME, 'bridge-token')
      if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim()
    } catch (error) {
      logToFile(`[WARN] bridge token read failed: ${error.message}`)
    }
    return null
  })

  // ── IPC: 选择文件夹（双向通信，返回路径或 null） ──
  // 功能说明: 打开系统原生文件夹选择对话框，用于新增项目时选择工作目录
  // 取消时返回 null
  // ── IPC: 用系统默认浏览器打开 URL ──
  trustedHandle('shell:openExternal', async (url) => {
    const target = normalizeExternalUrl(url)
    if (!target) return false
    return shell.openExternal(target).then(() => true).catch(error => {
      logToFile(`[WARN] open external URL failed: ${error.message}`)
      return false
    })
  })

  // ── IPC: 在系统文件管理器中打开项目目录 ──
  trustedHandle('shell:openDirectory', async (directory) => {
    const result = await openDirectoryInShell(directory, target => shell.openPath(target))
    if (!result.ok) logToFile(`[WARN] open project directory failed: ${result.error}`)
    return result
  })

  trustedHandle('dialog:selectDirectory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目文件夹',
      properties: ['openDirectory']               // 仅允许选择目录
    })
    if (r.canceled || !r.filePaths?.length) return null
    return r.filePaths[0]
  })

  // ── 加载页面 ──
  // 开发模式: 加载 Vite 开发服务器 URL（支持 HMR 热更新）
  // 生产模式: 加载打包后的 index.html
  let trustedNavigation
  if (process.env.VITE_DEV_SERVER_URL) {
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL)
    trustedNavigation = (targetUrl) => {
      try { return new URL(targetUrl).origin === devUrl.origin } catch { return false }
    }
    void mainWindow.loadURL(devUrl.toString()).catch(error => {
      logToFile(`[ERROR] renderer loadURL failed: ${error.message}`)
    })
  } else {
    const entryPath = path.join(__dirname, '../dist/index.html')
    const entryUrl = pathToFileURL(entryPath).href
    trustedNavigation = (targetUrl) => targetUrl.split('#')[0] === entryUrl
    void mainWindow.loadFile(entryPath).catch(error => {
      logToFile(`[ERROR] renderer loadFile failed: ${error.message}`)
    })
  }

  const guardNavigation = (event, targetUrl) => {
    if (trustedNavigation(targetUrl)) return
    event.preventDefault()
    const externalUrl = normalizeExternalUrl(targetUrl)
    if (externalUrl) {
      void shell.openExternal(externalUrl).catch(error => {
        logToFile(`[WARN] open external URL failed: ${error.message}`)
      })
    }
  }
  mainWindow.webContents.on('will-navigate', guardNavigation)
  mainWindow.webContents.on('will-redirect', guardNavigation)

  // ── 外部链接处理 ──
  // 功能说明: 拦截 window.open 调用，改为在系统默认浏览器中打开
  // 实现方式: shell.openExternal 打开外部 URL，返回 { action: 'deny' } 阻止新窗口创建
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url)
    if (externalUrl) {
      void shell.openExternal(externalUrl).catch(error => {
        logToFile(`[WARN] open popup URL failed: ${error.message}`)
      })
    }
    return { action: 'deny' }
  })

  // ── 窗口关闭事件: 非退出 → 隐藏到托盘 ──
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  const thisWindow = mainWindow
  mainWindow.on('closed', () => {
    if (mainWindow === thisWindow) mainWindow = null
  })
}
/** 功能说明: 创建 Windows/macOS/Linux 通用的系统托盘图标
 *   右键菜单: 显示主窗口 / 退出
 *   左键双击: 显示主窗口
 *   托盘图标用 16x16 原生图像（程序化生成白色桥形图标）
 * SIDE_EFFECT: 设置 tray 全局变量
 */
function createTray() {
  // 托盘图标使用 logo.png
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  const logoPath = isDev
    ? path.join(__dirname, '..', 'public', 'logo.png')
    : path.join(__dirname, '..', 'dist', 'logo.png')
  const icon = nativeImage.createFromPath(logoPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Claude Desktop Bridge')

  // 右键菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)

  // 左键双击 → 显示主窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ═══════════════════════════════════════════
// ── 应用生命周期 ──
// ═══════════════════════════════════════════

/**
 * ── app.whenReady ──
 * 功能说明: Electron 初始化完成后执行
 * 实现方式:
 *   1. 在 exe 同级目录创建 gateway.log 作为日志文件
 *   2. 先启动 gateway，延迟 1.5 秒后创建窗口
 *   3. 延迟是为了给 gateway 启动 buffer 时间，减少窗口加载时 backend 未就绪的概率
 * SIDE_EFFECT: 初始化 GATEWAY_LOG 路径；启动 gateway 子进程；创建主窗口
 */
app.whenReady().then(() => {
  if (!ownsAppInstance) return
  // userData 在各平台均可写: Windows %APPDATA%, macOS ~/Library/Application Support, Linux ~/.config
  GATEWAY_LOG = path.join(app.getPath('userData'), 'gateway.log')
  try {
    fs.mkdirSync(path.dirname(GATEWAY_LOG), { recursive: true })
  } catch (error) {
    console.error('[main] gateway 日志目录创建失败:', error.message)
  }
  createTray()                                      // 创建托盘图标
  startGateway()
  setTimeout(createWindow, 1500)                    // 等 gateway 先启动
  // 启动后 5 秒检查更新（给窗口和网络缓冲时间）
  setTimeout(checkForUpdates, 5000)
})

/**
 * ── window-all-closed ──
 * 功能说明: 所有窗口关闭时不退出应用（因为有托盘）
 *   仅在需要真退出（isQuitting=true）时才执行清理
 */
app.on('window-all-closed', () => {
  // 不退出 —— 托盘模式下窗口关闭 = 隐藏到托盘
  // isQuitting 为 true 时才走到 before-quit 清理
})

/**
 * ── before-quit ──
 * 功能说明: 应用即将退出前做清理
 * 实现方式: 确保 gateway 子进程被终止，防止孤儿进程；清理托盘图标
 */
app.on('before-quit', (event) => {
  isQuitting = true
  if (!quitCleanupStarted && gatewayProcess) {
    event.preventDefault()
    quitCleanupStarted = true
    void stopGateway().finally(() => app.quit())
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
})

/**
 * ── activate ──
 * 功能说明: macOS 点击 Dock 图标时触发（当没有窗口存在时）
 * 实现方式: 重新创建窗口
 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
