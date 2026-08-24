/**
 * Claude Desktop Bridge Gateway 启动入口。
 *
 * 运行时实现位于 gateway-runtime.mjs；本文件只负责保持 Electron/Node
 * 的既有入口路径，并把启动失败交给统一退出策略。
 */
import {startGateway} from './gateway-runtime.mjs'

startGateway().catch(error => {
    console.error('[gateway] 启动失败', error)
    process.exitCode = 1
})
