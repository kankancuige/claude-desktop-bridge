const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const {resolveBridgeHome} = require('./bridge-home.cjs')

test('Electron 与 Gateway 使用相同的默认 Bridge 私有目录', () => {
  const homeDir = path.resolve('C:/Users/example')
  assert.equal(resolveBridgeHome({env: {}, homeDir}), path.join(homeDir, '.claude-desktop-bridge'))
})
test('Electron 拒绝相对 BRIDGE_HOME', () => {
  assert.throws(
    () => resolveBridgeHome({env: {BRIDGE_HOME: 'relative/path'}, homeDir: path.resolve('C:/Users/example')}),
    error => error?.code === 'BRIDGE_HOME_NOT_ABSOLUTE',
  )
})
