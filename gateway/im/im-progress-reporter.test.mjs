import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyImProgressEvent, createImProgressReporter} from './im-progress-reporter.mjs'

function fakeClock() {
    let current = 1
    let nextId = 1
    const timers = new Map()
    return {
        now: () => current,
        setTimer(callback, delay) {
            const id = nextId++
            timers.set(id, {at: current + delay, callback})
            return id
        },
        clearTimer(id) {
            timers.delete(id)
        },
        advance(milliseconds) {
            const target = current + milliseconds
            while (true) {
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
                if (!due) break
                timers.delete(due[0])
                current = due[1].at
                due[1].callback()
            }
            current = target
        },
        pending: () => timers.size,
    }
}

test('短任务在 30 秒内不发送进度，终态会清理 timer', () => {
    const clock = fakeClock()
    const sent = []
    const reporter = createImProgressReporter({send: text => sent.push(text), ...clock})
    reporter.observe({type: 'task_started'})
    clock.advance(29_000)
    assert.equal(sent.length, 0)
    reporter.observe({type: 'task_completed'})
    clock.advance(10_000)
    assert.equal(sent.length, 0)
    assert.equal(clock.pending(), 0)
})

test('长任务 30 秒发送首次进度，之后只在阶段变化且满 60 秒时发送', () => {
    const clock = fakeClock()
    const sent = []
    const reporter = createImProgressReporter({send: (text, meta) => sent.push({text, meta}), ...clock})
    reporter.observe({type: 'task_started'})
    reporter.observe({type: 'thinking_start'})
    clock.advance(30_000)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].meta.phase, 'thinking')

    reporter.observe({type: 'thinking_delta'})
    clock.advance(65_000)
    assert.equal(sent.length, 1)

    reporter.observe({type: 'tool_use_start', tool_name: 'Edit', input: {file_path: 'src/main.ts'}})
    assert.equal(sent.length, 2)
    assert.equal(sent[1].meta.phase, 'modify')
})

test('不同工具不会逐条通知，验证阶段会在节流窗口后汇报', () => {
    const clock = fakeClock()
    const sent = []
    const reporter = createImProgressReporter({send: (text, meta) => sent.push(meta), ...clock})
    reporter.observe({type: 'task_started'})
    reporter.observe({type: 'tool_use_start', tool_name: 'Read'})
    clock.advance(30_000)
    reporter.observe({type: 'tool_use_start', tool_name: 'Grep'})
    clock.advance(60_000)
    assert.equal(sent.length, 1)

    reporter.observe({type: 'tool_use_start', tool_name: 'Bash', input: {command: 'pnpm test'}})
    assert.equal(sent.length, 2)
    assert.equal(sent[1].phase, 'verify')
})

test('进度消息遵守数量上限', () => {
    const clock = fakeClock()
    const sent = []
    const reporter = createImProgressReporter({send: (text, meta) => sent.push(meta), maxMessages: 2, ...clock})
    reporter.observe({type: 'task_started'})
    clock.advance(30_000)
    reporter.observe({type: 'thinking_start'})
    clock.advance(60_000)
    reporter.observe({type: 'task_reviewing'})
    clock.advance(120_000)
    assert.equal(sent.length, 2)
    assert.equal(reporter.snapshot().scheduled, false)
})

test('自动续跑是长任务进度而不是终态', () => {
    assert.deepEqual(classifyImProgressEvent({type: 'task_auto_continuing', attempt: 2, maxAttempts: 3}), {
        key: 'auto-continue:2',
        title: '已达到单段轮数上限，正在自动续跑',
        detail: '第 2/3 次',
    })
})
