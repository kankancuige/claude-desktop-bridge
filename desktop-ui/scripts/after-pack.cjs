/**
 * electron-builder afterPack hook
 * ── 功能说明 ──
 * Electron 打包完成后，将 gateway/node_modules 复制到打包输出目录的 resources/gateway/ 下，
 * 确保生产环境中 gateway 子进程能正常加载依赖（ws、pino、@anthropic-ai/claude-agent-sdk 等）。
 *
 * ── 调用时机 ──
 * electron-builder 在把所有文件写入 appOutDir 后、签名/归档前调用此脚本。
 *
 * ── 为什么需要 ──
 * gateway 使用 ELECTRON_RUN_AS_NODE 模式由 Electron 主进程 spawn 执行，
 * 其 node_modules 不会被 electron-builder 自动打包（electron-builder 只打包 desktop-ui 的依赖）。
 * 因此需要手动复制 gateway/node_modules 到 resources 目录。
 *
 * repo: https://github.com/kankancuige/claude-desktop-bridge
 */
const fs = require('fs')
const path = require('path')

/**
 * copyDir — 递归复制目录
 * ── 功能说明 ──
 * 将 src 目录下的所有文件和子目录完整复制到 dest。
 * 先创建目标目录（如不存在），再遍历源目录条目逐项处理：
 *   目录 → 递归调用自身
 *   文件 → fs.copyFileSync 直接复制
 * 注意: 同步 API（Sync），因为在打包 hook 中执行，不阻塞 UI。
 *
 * @param {string} src  - 源目录绝对路径
 * @param {string} dest - 目标目录绝对路径
 * SIDE_EFFECT: 在磁盘上创建目录和文件
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * afterPack hook 入口
 * ── 功能说明 ──
 * electron-builder 调用的默认导出函数，接收打包上下文，执行 node_modules 复制。
 *
 * ── 路径计算 ──
 *   源: <项目根>/gateway/node_modules
 *   目标: <appOutDir>/resources/gateway/node_modules
 *   appOutDir 由 electron-builder 传入，通常是 dist-electron/ 或类似目录。
 *
 * ── 容错 ──
 *   如果 gateway/node_modules 不存在（例如未执行 npm install），打印警告并跳过，
 *   不抛异常——打包仍可完成，只是 gateway 在运行时可能加载失败。
 *
 * @param {object} context - electron-builder 提供的打包上下文对象
 *   context.appOutDir: 打包输出目录
 * SIDE_EFFECT: 在 appOutDir/resources/gateway/ 下创建大量文件和目录
 */
exports.default = async function (context) {
  const src = path.join(__dirname, '../../gateway/node_modules')
  const dest = path.join(context.appOutDir, 'resources', 'gateway', 'node_modules')

  // 源目录不存在 → 跳过（可能未安装依赖）
  if (!fs.existsSync(src)) {
    console.warn('[afterPack] gateway/node_modules not found — 跳过复制，gateway 可能无法运行')
    return
  }

  // 执行复制并计时
  console.log('[afterPack] 开始复制 gateway/node_modules ...')
  const t0 = Date.now()
  copyDir(src, dest)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[afterPack] 复制完成，耗时 ${elapsed}s`)
}
