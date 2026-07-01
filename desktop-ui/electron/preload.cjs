/**
 * Electron 预加载脚本 (preload.cjs)
 * source: https://github.com/kankancuige/claude-desktop-bridge
 * wmk: aHR0cHM6Ly9naXRodWIuY29tL2thbmthbmN1aWdlL2NsYXVkZS1kZXNrdG9wLWJyaWRnZQ==
 * ── 功能说明 ──
 * 通过 contextBridge 在渲染进程的 window 对象上暴露安全的 electronAPI，
 * 作为渲染进程（Vue）与主进程（Electron）之间的安全通信桥梁。
 * ── 安全模型 ──
 * 使用 contextBridge.exposeInMainWorld 而非直接挂载，
 * contextIsolation: true 确保渲染进程无法直接访问 Node.js API。
 * 所有 IPC 调用通过白名单方式暴露，精确控制渲染进程能调用的主进程功能。
 */

const { contextBridge, ipcRenderer } = require('electron')

/**
 * ── electronAPI 定义 ──
 * 功能说明: 向渲染进程暴露的安全 API 集合
 * 实现方式:
 *   - 只读属性（如 platform）直接暴露值
 *   - 窗口控制（minimize/maximize/close）使用 ipcRenderer.send 单向通知主进程
 *   - gateway 重启同理使用 send 单向通信
 *   - 需要返回值的方法（getGatewayLogPath/selectDirectory）使用 ipcRenderer.invoke，
 *     主进程通过 ipcMain.handle 响应，返回 Promise
 * 注意: 不要在此处添加任意 IPC 通道，每个新增 API 都应有明确的安全理由
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Bridge Token（本地 API 认证）──
  getBridgeToken: () => ipcRenderer.invoke('getBridgeToken'),

  // ── 平台标识 ──
  // 渲染进程可据此判断当前操作系统（win32/darwin/linux），用于条件渲染
  platform: process.platform,

  // ── 窗口控制（单向 IPC） ──
  // 这些操作不需要返回值，使用 send 而非 invoke 以减少 IPC 开销
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // ── gateway 重启（单向 IPC） ──
  // 用户手动触发 gateway 重启，主进程执行 stop + start 流程
  restartGateway: () => ipcRenderer.send('gateway:restart'),

  // ── 获取 gateway 日志文件路径（双向 IPC） ──
  // 返回 Promise<string>，主进程返回 GATEWAY_LOG 完整路径
  getGatewayLogPath: () => ipcRenderer.invoke('getGatewayLogPath'),

  // ── 系统原生目录选择对话框（双向 IPC） ──
  // 返回 Promise<string | null>，用户选择目录返回路径，取消返回 null
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // ── 用系统默认浏览器打开外部链接 ──
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── 窗口状态控制（托盘模式）──
  showWindow: () => ipcRenderer.send('window:show'),
  quitApp: () => ipcRenderer.send('app:quit'),

  // ── 主进程通知发送 IPC ──
  onTrayNotification: (callback) => {
    ipcRenderer.on('tray:notification', (_e, data) => callback(data))
  },

  // ── 检查当前是否最大化 ──
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // ── 应用版本 ──
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),

  // ── 自动更新 ──
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.send('update:download'),
  installUpdate: () => ipcRenderer.send('update:install'),
  // 监听主进程推送的更新事件
  onUpdateAvailable: (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateDownloadProgress: (cb) => {
    const handler = (_e, progress) => cb(progress)
    ipcRenderer.on('update:download-progress', handler)
    return () => ipcRenderer.removeListener('update:download-progress', handler)
  },
  onUpdateDownloaded: (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
  onUpdateError: (cb) => {
    const handler = (_e, err) => cb(err)
    ipcRenderer.on('update:error', handler)
    return () => ipcRenderer.removeListener('update:error', handler)
  },

})
