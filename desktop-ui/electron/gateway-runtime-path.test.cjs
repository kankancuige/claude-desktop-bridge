const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const {resolveGatewayRuntimePath} = require('./gateway-runtime-path.cjs')

test('源码冷启动不依赖 Vite 地址，始终从仓库 Gateway 启动', () => {
  const electronDir = path.resolve('D:/work/desktop-ui/electron')
  const resourcesPath = path.resolve('D:/runtime/resources')

  assert.equal(
    resolveGatewayRuntimePath({isPackaged: false, electronDir, resourcesPath}),
    path.join(electronDir, '../../gateway'),
  )
})

test('已打包应用从 extraResources 中的 Gateway 启动', () => {
  const electronDir = path.resolve('D:/work/desktop-ui/electron')
  const resourcesPath = path.resolve('D:/runtime/resources')

  assert.equal(
    resolveGatewayRuntimePath({isPackaged: true, electronDir, resourcesPath}),
    path.join(resourcesPath, 'gateway'),
  )
})
