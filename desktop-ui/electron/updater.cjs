/**
 * 自动更新模块 (electron-updater)
 * repo: https://github.com/kankancuige/claude-desktop-bridge
 *
 * GitHub repo 配置在 package.json → build.publish:
 *   改 owner/repo 为真实的 GitHub 仓库即可启用
 *
 * 安全: 仅签名更新有效 (electron-builder 构建时自动签名)
 */

// ── 开发模式标记 ──
const isDev = !!process.env.VITE_DEV_SERVER_URL

// 检查 app-update.yml 是否存在——portable 打包不生成此文件，无需加载 electron-updater
function hasUpdateConfig() {
  try {
    const fs = require('fs')
    const path = require('path')
    const yml = path.join(process.resourcesPath || '', 'app-update.yml')
    return fs.existsSync(yml)
  } catch { return false }
}

// 惰性加载 electron-updater —— yml 不存在或 dev 模式下不加载
/** @type {import('electron-updater').AppUpdater|null} */
let _autoUpdater = null
function getAutoUpdater() {
  if (!_autoUpdater && !isDev && hasUpdateConfig()) {
    try {
      _autoUpdater = require('electron-updater').autoUpdater
      _autoUpdater.autoDownload = false
      _autoUpdater.allowDowngrade = false
      _autoUpdater.fullChangelog = true

      _autoUpdater.on('update-available', (info) => {
        const win = require('electron').BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('update:available', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
          })
        }
      })

      _autoUpdater.on('download-progress', (progress) => {
        const win = require('electron').BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('update:download-progress', {
            percent: progress.percent,
            transferred: progress.transferred,
            total: progress.total,
          })
        }
      })

      _autoUpdater.on('update-downloaded', (info) => {
        const win = require('electron').BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('update:downloaded', { version: info.version })
        }
      })

      _autoUpdater.on('update-not-available', () => {
        // 静默
      })

      _autoUpdater.on('error', (err) => {
        console.log('[updater] 出错:', err.message)
        const win = require('electron').BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('update:error', { message: err.message })
        }
      })
    } catch (e) {
      console.log('[updater] 加载失败:', e.message)
    }
  }
  return _autoUpdater
}

/**
 * 启动时检查更新（开发环境跳过）
 */
function checkForUpdates() {
  if (isDev) {
    console.log('[updater] 开发模式，跳过更新检查')
    return
  }
  const au = getAutoUpdater()
  if (!au) return
  au.checkForUpdates().catch(err => {
    console.log('[updater] 检查更新失败:', err.message)
  })
}

/**
 * 每隔 intervalMs 毫秒检查一次更新
 */
function startUpdateCheckInterval(intervalMs = 4 * 60 * 60 * 1000) {
  if (isDev) return
  checkForUpdates()
  setInterval(checkForUpdates, intervalMs)
}

/**
 * 下载更新
 */
function downloadUpdate() {
  const au = getAutoUpdater()
  if (!au) return Promise.reject(new Error('autoUpdater 不可用'))
  return au.downloadUpdate()
}

/**
 * 退出并安装
 */
function quitAndInstall() {
  const au = getAutoUpdater()
  if (au) au.quitAndInstall()
}

module.exports = { checkForUpdates, startUpdateCheckInterval, downloadUpdate, quitAndInstall, get autoUpdater() { return getAutoUpdater() } }
