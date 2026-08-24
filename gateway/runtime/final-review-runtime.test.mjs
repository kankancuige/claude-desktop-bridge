import test from 'node:test'
import assert from 'node:assert/strict'
import {createFinalReviewRuntime} from './final-review-runtime.mjs'

test('Final Review Runtime 缺少 Workflow 运行边界时立即失败', () => {
    assert.throws(() => createFinalReviewRuntime(), /dependencies are required/)
})

test('Final Review Runtime 对不存在会话安全返回', async () => {
    const runtime = createFinalReviewRuntime({
        sessions: new Map(), loadWfConfig: () => ({enabled: false}), updateTaskCompletion() {}, runWfScript: async () => null,
    })
    assert.equal(await runtime.autoTriggerFinalReview('missing', null, null), undefined)
})
