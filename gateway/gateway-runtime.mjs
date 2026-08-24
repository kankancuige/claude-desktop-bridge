/**
 * Gateway 运行时组合根。
 *
 * 具体生命周期实现位于 gateway-runtime-impl.mjs；本边界只负责把实现
 * 暴露为稳定的启动契约，供 Node 入口和 Electron 主进程复用。
 */
import {startGateway as startGatewayImplementation} from './gateway-runtime-impl.mjs'

export async function startGateway(options = {}) {
    return startGatewayImplementation(options)
}
