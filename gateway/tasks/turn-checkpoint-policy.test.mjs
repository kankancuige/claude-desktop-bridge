import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {decideTask} from './task-decision.mjs'
import {shouldCaptureTurnCheckpoint} from './turn-checkpoint-policy.mjs'

test('轻量纯问答跳过文件 checkpoint', () => {
    assert.equal(shouldCaptureTurnCheckpoint({action: 'query', contextProfile: 'light'}), false)
})

test('普通实现、定向探索和附件任务保留文件 checkpoint', () => {
    assert.equal(shouldCaptureTurnCheckpoint({action: 'implement', contextProfile: 'full'}), true)
    assert.equal(shouldCaptureTurnCheckpoint({action: 'inspect', contextProfile: 'focused'}), true)
    assert.equal(shouldCaptureTurnCheckpoint({action: 'query', contextProfile: 'focused'}), true)
})

test('缺失或未知决策默认保留文件 checkpoint', () => {
    assert.equal(shouldCaptureTurnCheckpoint(null), true)
    assert.equal(shouldCaptureTurnCheckpoint(undefined), true)
    assert.equal(shouldCaptureTurnCheckpoint({action: 'query'}), true)
    assert.equal(shouldCaptureTurnCheckpoint({contextProfile: 'light'}), true)
})

test('真实任务决策和 Gateway 入口接线保持一致', () => {
    const query = decideTask({text: '你好'})
    const implementation = decideTask({text: '给设置页增加一个自动模式开关'})
    assert.equal(shouldCaptureTurnCheckpoint(query), false)
    assert.equal(shouldCaptureTurnCheckpoint(implementation), true)

    const source = [
        readFileSync(resolve(import.meta.dirname, '..', 'gateway-runtime-impl.mjs'), 'utf8'),
        readFileSync(resolve(import.meta.dirname, '..', 'runtime', 'task-command-runtime.mjs'), 'utf8'),
        readFileSync(resolve(import.meta.dirname, '..', 'runtime', 'session-artifact-runtime.mjs'), 'utf8'),
    ].join('\n')
    assert.match(source, /captureFiles:\s*shouldCaptureTurnCheckpoint\(taskDecision\)/)
    assert.match(source, /if \(s\.pendingTurn\.captureFiles === false\)/)
})
