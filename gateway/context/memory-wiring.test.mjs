import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

test('Gateway 将 Memory 管理 API 接入统一服务', () => {
    assert.match(source, /listProjectMemory\(\{/)
    assert.match(source, /rebuildProjectMemory\(\{/)
    assert.match(source, /setProjectMemoryEnabled\(\{/)
    assert.match(source, /saveProjectMemory\(\{/)
    assert.match(source, /deleteProjectMemory\(\{/)
})

test('Gateway 停止适配器后仍从 SQLite 汇总通知并清理平台状态', () => {
    assert.match(source, /bridgeStateDb\?\.clearEntries\?\.\('inbox', platform\)/)
    assert.match(source, /bridgeStateDb\?\.clearEntries\?\.\('outbox', platform\)/)
    assert.match(source, /bridgeStateDb\.summarizeEntries\('outbox', p\)/)
})

test('Gateway 暴露 SQLite 降级原因和隔离计数', () => {
    assert.match(source, /stateStoreDegradedReason:/)
    assert.match(source, /stateStoreQuarantined:/)
})
