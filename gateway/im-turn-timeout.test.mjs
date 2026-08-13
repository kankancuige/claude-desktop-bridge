import assert from 'node:assert/strict'
import test from 'node:test'
import {createImTurnTimeout} from './im-turn-timeout.mjs'

test('IM 长任务收到进度时续期，但不超过最大时长', () => {
    let current = 0
    let callback = null
    let delay = 0
    let timedOut = 0
    const timeout = createImTurnTimeout({
        onTimeout: () => { timedOut++ }, idleMs: 100, maxMs: 250,
        now: () => current,
        setTimer: (fn, ms) => { callback = fn; delay = ms; return {unref() {}} },
        clearTimer: () => {},
    })
    assert.equal(delay, 100)
    current = 80
    timeout.touch()
    assert.equal(delay, 100)
    current = 220
    timeout.touch()
    assert.equal(delay, 30)
    callback()
    assert.equal(timedOut, 1)
})

test('IM 回合完成后停止 timeout', () => {
    let callback = null
    let timedOut = 0
    const timeout = createImTurnTimeout({
        onTimeout: () => { timedOut++ },
        setTimer: fn => { callback = fn; return {unref() {}} },
        clearTimer: () => {},
    })
    timeout.stop()
    callback()
    assert.equal(timedOut, 0)
})
