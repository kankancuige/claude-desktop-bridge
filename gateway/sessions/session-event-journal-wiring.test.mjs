import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

function section(startMarker, endMarker) {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    assert.ok(start >= 0 && end > start, `无法定位接线区段: ${startMarker}`)
    return source.slice(start, end)
}

test('query 设置重建保留 Session Event Journal', () => {
    const rebuild = section("reason: 'runtime_settings_changed'", 's.modelMode = taskRoute.mode')
    assert.doesNotMatch(rebuild, /eventJournal\?\.close/)
})

test('单个和批量删除 Session 均关闭 Event Journal', () => {
    const singleDelete = section("reason: 'delete_session'", 'markSessionDeleted(delParam)')
    const batchDelete = section("reason: 'batch_delete_session'", 'sessions.delete(id)')
    assert.match(singleDelete, /eventJournal\?\.close/)
    assert.match(batchDelete, /eventJournal\?\.close/)
})
