import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = [
    readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/task-command-runtime.mjs', import.meta.url), 'utf8'),
].join('\n')
const sessionMutationRoutes = readFileSync(new URL('../http/session-mutation-routes.mjs', import.meta.url), 'utf8')

function section(text, startMarker, endMarker) {
    const start = text.indexOf(startMarker)
    const end = text.indexOf(endMarker, start)
    assert.ok(start >= 0 && end > start, `无法定位接线区段: ${startMarker}`)
    return text.slice(start, end)
}

test('query 设置重建保留 Session Event Journal', () => {
    const rebuild = section(source, "reason: 'runtime_settings_changed'", 's.modelMode = taskRoute.mode')
    assert.doesNotMatch(rebuild, /eventJournal\?\.close/)
})

test('单个和批量删除 Session 均关闭 Event Journal', () => {
    const singleDelete = section(sessionMutationRoutes, "reason: 'delete_session'", 'markSessionDeleted(delParam)')
    const batchDelete = section(sessionMutationRoutes, "reason: 'batch_delete_session'", 'sessions.delete(id)')
    assert.match(singleDelete, /eventJournal\?\.close/)
    assert.match(batchDelete, /eventJournal\?\.close/)
})
