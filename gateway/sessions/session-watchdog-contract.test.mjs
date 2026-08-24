import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const streamSource = readFileSync(new URL('../runtime/session-input-runtime.mjs', import.meta.url), 'utf8')

test('stream watchdog 覆盖首个 SDK 事件前的活跃 turn/rebuild，不只依赖 generating', () => {
    const start = streamSource.indexOf('function armStreamWatchdog')
    const end = streamSource.indexOf('return {acceptSessionInput', start)
    assert.ok(start >= 0 && end > start)
    const section = streamSource.slice(start, end)
    assert.match(section, /session\.activeTurnId/)
    assert.match(section, /session\._rebuildPromise/)
    assert.match(section, /session\._pendingInputs\?\.length/)
    assert.match(section, /sessionCoordinator\.isTimeoutCurrent\(session, query\)/)
})
