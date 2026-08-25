import assert from 'node:assert/strict'
import test from 'node:test'
import {createMemoryAutoCaptureRuntime} from './memory-auto-capture-runtime.mjs'

test('自动捕获适配器只负责组合纯捕获器和 candidate port', async () => {
    const calls = []
    const runtime = createMemoryAutoCaptureRuntime({
        getCandidateStore: () => ({extractMemoryCandidates: async input => { calls.push(input); return [{candidateId: 'c1'}] }}),
        extractFacts: input => [{summary: input.session.taskRequestText, verified: true, evidence: ['request:t1']}],
        encodeProjectName: value => `encoded:${value}`,
    })
    const result = await runtime.captureAutomaticMemory({session: {workDir: 'D:/work', taskCompletionTaskId: 't1', taskRequestText: '约定'}})
    assert.deepEqual(result, [{candidateId: 'c1'}])
    assert.equal(calls[0].projectKey, 'encoded:D:/work')
})

test('没有 candidate port 时自动捕获适配器为空操作', async () => {
    const runtime = createMemoryAutoCaptureRuntime({getCandidateStore: () => null, extractFacts: () => [{summary: 'x'}]})
    assert.deepEqual(await runtime.captureAutomaticMemory({session: {}}), [])
})
