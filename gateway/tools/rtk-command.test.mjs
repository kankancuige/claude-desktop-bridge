import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveRtkCommandArgs} from './rtk-command.mjs'

test('Electron Node 模式下 RTK 将 node 映射为当前 Electron 可执行文件', () => {
    assert.deepEqual(resolveRtkCommandArgs(['node', '-e', 'console.log(1)'], {
        platform: 'win32',
        execPath: 'C:\\Program Files\\Bridge\\Bridge.exe',
        electronRunAsNode: '1',
    }), ['C:\\Program Files\\Bridge\\Bridge.exe', '-e', 'console.log(1)'])
})

test('普通 Node 环境不改写命令', () => {
    assert.deepEqual(resolveRtkCommandArgs(['node', '-p', 'process.version'], {
        platform: 'win32',
        execPath: 'D:\\nodejs\\node.exe',
        electronRunAsNode: undefined,
    }), ['node', '-p', 'process.version'])
})
