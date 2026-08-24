import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionContextRuntime} from './session-context-runtime.mjs'

function createRuntime(overrides = {}) {
    const calls = []
    const runtime = createSessionContextRuntime({
        bridgeHome: 'D:/bridge',
        listProjectTranscriptCandidates: args => {
            calls.push(['transcripts', args])
            return [{id: 'source-session', mtime: 2}]
        },
        buildProjectContinuationContext: args => {
            calls.push(['context', args])
            return args.prompt === '继续' ? {sourceSessionId: 'source-session', text: '上一轮已确认的结果'} : null
        },
        composeContinuationPrompt: (prompt, context) => `${context.text}\n${prompt}`,
        userPreferences: {inject: (workDir, content) => `${content}\n偏好:${workDir}`},
        memoryService: {retrieveAsync: async () => ({text: 'Memory 摘要', items: [{id: 'm1'}], reason: 'matched'})},
        encodeProjectName: value => `encoded:${value}`,
        sessionRepository: {list() { return [] }},
        logger: {info: (...args) => calls.push(['info', args]), warn: (...args) => calls.push(['warn', args])},
        ...overrides,
    })
    return {runtime, calls}
}

test('空白会话的引用性输入注入项目接力上下文、偏好和 Memory', async () => {
    const {runtime, calls} = createRuntime()
    const session = {workDir: 'D:/project', lastSessionId: 'current', hasUserTurns: false}
    const result = await runtime.resolveSdkInputContent('current-id', session, '继续')
    assert.equal(result, 'Memory 摘要\n\n上一轮已确认的结果\n继续\n偏好:D:/project')
    assert.equal(session._continuationResolved, true)
    assert.equal(calls.find(item => item[0] === 'transcripts')[1].encodedDir, 'encoded:D:/project')
    assert.equal(calls.filter(item => item[0] === 'context').length, 1)
})

test('light 会话不读取 Memory，避免简单问题产生额外上下文成本', async () => {
    let memoryCalls = 0
    const runtime = createSessionContextRuntime({
        bridgeHome: 'D:/bridge', listProjectTranscriptCandidates: () => [], buildProjectContinuationContext: () => null,
        composeContinuationPrompt: value => value, encodeProjectName: value => value,
        memoryService: {retrieveAsync: async () => { memoryCalls++; return {text: '不应注入'} }},
    })
    const result = await runtime.resolveSdkInputContent('s1', {workDir: 'D:/work', contextProfile: 'light', hasUserTurns: true}, '你好')
    assert.equal(result, '你好')
    assert.equal(memoryCalls, 0)
})

test('同一 Session 只解析一次接力上下文，但每次仍按当前输入尝试 Memory', async () => {
    const {runtime, calls} = createRuntime()
    const session = {workDir: 'D:/project', hasUserTurns: false}
    await runtime.resolveSdkInputContent('s1', session, '继续')
    await runtime.resolveSdkInputContent('s1', session, '补充一个细节')
    assert.equal(calls.filter(item => item[0] === 'transcripts').length, 1)
    assert.equal(calls.filter(item => item[0] === 'context').length, 1)
})

test('依赖失败时保留原输入并继续返回可用内容', async () => {
    const {runtime, calls} = createRuntime({
        listProjectTranscriptCandidates: () => { throw new Error('db down') },
        userPreferences: {inject: () => { throw new Error('preference read failed') }},
        memoryService: {retrieveAsync: async () => { throw new Error('memory unavailable') }},
    })
    const session = {workDir: 'D:/project', hasUserTurns: false}
    assert.equal(await runtime.resolveSdkInputContent('s1', session, '继续'), '继续')
    assert.equal(calls.filter(item => item[0] === 'warn').length, 3)
})

test('无 Session 时保持原始输入且不访问任何上下文依赖', async () => {
    const {runtime, calls} = createRuntime()
    assert.equal(await runtime.resolveSdkInputContent('s1', null, 'hello'), 'hello')
    assert.equal(calls.length, 0)
})
