/**
 * prebuild — 打包前杀掉正在运行的 Electron 进程，避免 dist-electron 目录被锁
 * SIDE_EFFECT: 强制终止本机所有 electron.exe / Claude Desktop Bridge.exe 进程
 */
const { execSync } = require('child_process')
let killed = false

if (process.platform === 'win32') {
  for (const name of ['Claude Desktop Bridge.exe', 'electron.exe']) {
    try {
      execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' })
      console.log(`[prebuild] 已终止: ${name}`)
      killed = true
    } catch {}
  }
} else {
  for (const name of ['Claude Desktop Bridge', 'electron', 'Electron']) {
    try {
      execSync(`pkill -f "${name}"`, { stdio: 'ignore' })
      console.log(`[prebuild] 已终止: ${name}`)
      killed = true
    } catch {}
  }
}

if (!killed) console.log('[prebuild] 未发现运行中的进程')
