const path = require('path')

/**
 * Gateway 是否使用 extraResources 只取决于应用是否已被打包。
 * Vite 地址描述的是 Renderer 加载来源，源码冷启动时可以不存在，不能作为进程路径依据。
 */
function resolveGatewayRuntimePath({isPackaged, electronDir, resourcesPath}) {
  return isPackaged
    ? path.join(resourcesPath, 'gateway')
    : path.join(electronDir, '../../gateway')
}

module.exports = {resolveGatewayRuntimePath}
