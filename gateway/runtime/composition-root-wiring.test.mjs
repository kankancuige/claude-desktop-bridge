import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8')
const runtimeFiles = [
    'im-runtime.mjs', 'scheduled-runtime.mjs', 'session-context-runtime.mjs',
    'session-state-storage-runtime.mjs', 'task-state-storage-runtime.mjs',
    'project-session-runtime.mjs', 'coordinator-verification-runtime.mjs',
].map(name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')).join('\n')

test('业务 Runtime 不直接依赖 PostgresStateCompat 或 Workflow 全局 setDeps', () => {
    assert.doesNotMatch(runtimeFiles, /PostgresStateCompat|createPostgresStateCompat|\bsetDeps\s*\(/)
})

test('组合根通过领域 Repository 和 Workflow Runtime 接线', () => {
    assert.match(source, /getSessionRepository:\s*\(\)\s*=>\s*stateRepositories\(\)\?\.session/)
    assert.match(source, /getWorkbenchRepository:\s*\(\)\s*=>\s*stateRepositories\(\)\?\.workbench/)
    assert.match(source, /workflowRuntime\s*=\s*createWorkflowRuntime\(/)
})

test('Workflow 消费者使用统一 runWfScript 端口，避免组合根参数名漂移', () => {
    assert.match(source, /finalReviewRuntime\s*=\s*createFinalReviewRuntime\(\{[\s\S]*?runWfScript:\s*runWorkflowPort/)
    assert.match(source, /workflowAutoTriggerRuntime\s*=\s*createWorkflowAutoTriggerRuntime\(\{[\s\S]*?runWfScript:\s*runWorkflowPort/)
})

test('Startup Runtime 优先使用组合根 Coordinator 和 Pitfall Service', () => {
    const startup = readFileSync(new URL('./startup-runtime.mjs', import.meta.url), 'utf8')
    assert.match(startup, /stateStore\?\.taskCoordinator\s*\|\|\s*state\?\.taskCoordinator/)
    assert.match(startup, /stateStore\?\.pitfallService\s*\|\|\s*state\?\.pitfallService/)
})

test('gateway-runtime-impl 仅保留组合接线，不实现 HTTP、文件、SDK 消费或业务状态分支', () => {
    assert.doesNotMatch(source, /url\.pathname|req\.method\s*(?:===|!==)|for\s+await\s*\(|Symbol\.asyncIterator/)
    assert.doesNotMatch(source, /function\s+convertSdkToWs|class\s+PushStream/)
    assert.doesNotMatch(source, /(?:pool|client|db|connection)\.(?:query|execute)\s*\(/i)
    assert.doesNotMatch(source, /sessions\.(?:set|delete)\s*\(/)
    assert.match(source, /createHttpRuntime\(\{routeContext:\s*gatewayRouteContext\}\)/)
    assert.match(source, /createSdkStreamRuntime\(sdkStreamRuntimeDependencies\)/)
    assert.match(source, /sdkStreamAdapter\s*,/)
})
