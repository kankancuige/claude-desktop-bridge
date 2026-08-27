import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/SettingsView.vue', import.meta.url), 'utf8')

function section(start, end) {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from + start.length)
    assert.ok(from >= 0 && to > from, `无法定位代码段 ${start}`)
    return source.slice(from, to)
}

test('Scheduler 表单默认无人值守执行', () => {
    assert.match(source, /schedForm = ref\([^\n]*permissionMode: 'bypassPermissions'/)
    assert.match(section('function openNewSched()', 'function editSched'), /permissionMode: 'bypassPermissions'/)
})

test('Scheduler 加载、启停、运行和删除都检查 HTTP 结果并显示原因', () => {
    for (const [start, end] of [
        ['async function loadScheduledTasks()', 'function openNewSched'],
        ['async function toggleSched(t: any)', 'async function runSchedNow'],
        ['async function runSchedNow(t: any)', 'async function deleteSched'],
        ['async function deleteSched(id: string)', '// ── IM 连接'],
    ]) {
        const body = section(start, end)
        assert.match(body, /apiFetch\(/)
        assert.match(body, /showAlert\(/)
        assert.match(body, /\.ok/)
    }
    const run = section('async function runSchedNow(t: any)', 'async function deleteSched')
    assert.ok(run.indexOf("d.reason === 'already_running'") < run.indexOf('if (!r.ok)'))
})
