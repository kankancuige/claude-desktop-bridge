import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCompletionEffectsRuntime} from './task-completion-effects-runtime.mjs'

test('完成副作用运行时接收显式依赖并处理空效果', async () => {
    const runtime = createTaskCompletionEffectsRuntime({
        sessions: new Map(),
        updateTaskCompletion() {},
    })
    assert.deepEqual(await runtime.applyTaskCompletionEffects('missing', []), undefined)
})

test('完成副作用运行时缺少会话和状态转换出口时立即失败', () => {
    assert.throws(() => createTaskCompletionEffectsRuntime(), /dependencies are required/)
})
