import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/WorkspaceView.vue', import.meta.url), 'utf8')

test('重连快照恢复 waiting_user 提示并交给统一活动状态处理', () => {
    const start = source.indexOf("case 'session_lifecycle_snapshot'")
    const end = source.indexOf("case 'session_state_snapshot'", start)
    assert.ok(start >= 0 && end > start)
    const handler = source.slice(start, end)
    assert.match(handler, /msg\.coordinator\?\.status === 'waiting_user'/)
    assert.match(handler, /type: 'task_coordinator_event'/)
    assert.match(handler, /applyTaskActivityEvent\(/)
})
