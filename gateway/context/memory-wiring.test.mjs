import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = [
    readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/im-runtime.mjs', import.meta.url), 'utf8'),
].join('\n')
const memoryRoutes = readFileSync(new URL('../http/memory-routes.mjs', import.meta.url), 'utf8')
const adapterRoutes = readFileSync(new URL('../http/adapter-config-routes.mjs', import.meta.url), 'utf8')

test('Gateway 将 Memory 管理 API 接入统一服务', () => {
    assert.match(memoryRoutes, /listProjectMemoryAsync\(\{/)
    assert.match(memoryRoutes, /rebuildProjectMemoryAsync\(\{/)
    assert.match(memoryRoutes, /setProjectMemoryEnabledAsync\(\{/)
    assert.match(memoryRoutes, /saveProjectMemory\(\{/)
    assert.match(memoryRoutes, /deleteProjectMemoryAsync\(\{/)
    assert.match(adapterRoutes, /memoryService\.listAsync\(\{encodedDir: ed, limit: 500\}\)/)
    assert.match(adapterRoutes, /mode: 'postgres', projects: rs/)
})

test('Gateway 停止适配器后仍从 PostgreSQL 汇总通知并清理平台状态', () => {
    assert.match(source, /getNotificationRepository: \(\) => stateRepositories\(\)\?\.notification/)
    assert.match(source, /notificationRepository\(\)\?\.clearPlatform\?\.\(platform\)/)
    assert.match(adapterRoutes, /getNotificationRepository\(\)\?\.summarize\?\.\(\{platform: p\}\)/)
})

test('Gateway 暴露 PostgreSQL 降级原因', () => {
    assert.match(source, /stateStoreDegradedReason:/)
})
