/**
 * 构建前只检测已安装的本产品进程，避免自动终止用户正在运行的 Electron 应用。
 * 开发态 electron.exe 无法仅凭进程名区分归属，因此不做全局处理。
 */
const { execFileSync } = require('child_process')

try {
  execFileSync(process.execPath, [require('path').resolve(__dirname, '../../scripts/check-builtin-resources.mjs')], {
    stdio: 'inherit',
    windowsHide: true,
  })
} catch (error) {
  console.error('[prebuild] 内置资源校验失败。')
  process.exit(error?.status || 1)
}

if (process.platform === 'win32') {
  try {
    const output = execFileSync('tasklist.exe', [
      '/FI', 'IMAGENAME eq Claude Desktop Bridge.exe', '/FO', 'CSV', '/NH',
    ], { encoding: 'utf8', windowsHide: true })
    if (/"Claude Desktop Bridge\.exe"/i.test(output)) {
      console.error('[prebuild] Claude Desktop Bridge 正在运行，请退出应用后重新构建。')
      process.exit(1)
    }
  } catch (error) {
    if (error?.status === 1) process.exit(1)
    console.warn(`[prebuild] 无法检查应用进程，将继续构建: ${error?.message || error}`)
  }
}
