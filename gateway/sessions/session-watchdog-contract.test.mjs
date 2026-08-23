import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

test('stream watchdog 覆盖首个 SDK 事件前的活跃 turn/rebuild，不只依赖 generating', () => {
    const start = source.indexOf('function armStreamWatchdog')
    const end = source.indexOf('async function startStreamPump', start)
    assert.ok(start >= 0 && end > start)
    const section = source.slice(start, end)
    assert.match(section, /session\.activeTurnId/)
    assert.match(section, /session\._rebuildPromise/)
    assert.match(section, /session\._pendingInputs\?\.length/)
    assert.match(section, /sessionCoordinator\.isTimeoutCurrent\(session, query\)/)
})
