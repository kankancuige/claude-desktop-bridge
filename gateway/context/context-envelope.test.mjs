import test from 'node:test'
import assert from 'node:assert/strict'
import {buildContextEnvelope, compareContextEnvelopes} from './context-envelope.mjs'

function createInput(overrides = {}) {
    return {
        providerIdentity: 'https://relay.example.test/api/anthropic',
        model: 'model-balanced',
        protocolFamily: 'claude-agent-sdk',
        resumeSessionId: 'sdk-session-1',
        permissionMode: 'default',
        thinkingLevel: 'medium',
        contextProfile: 'full',
        skillRoute: [{name: 'bridge-memory', version: '1'}],
        agentRoute: [{name: 'developer', version: '1'}],
        toolsetRevision: 'toolset-v1',
        ruleRevision: 'rules-v1',
        projectContextRevision: 'project-v1',
        ...overrides,
    }
}

test('上下文 envelope 仅使用稳定白名单维度并生成可重复的匿名指纹', () => {
    const first = buildContextEnvelope(createInput({
        prompt: '不应进入 fingerprint 输入',
        apiKey: 'secret-token',
        rawPath: 'D:\\private\\project',
    }))
    const second = buildContextEnvelope(createInput({
        prompt: '另一条用户消息不应影响稳定 envelope',
        apiKey: 'another-secret',
        rawPath: 'C:\\another\\path',
    }))

    assert.equal(first.version, 1)
    assert.equal(first.fingerprint, second.fingerprint)
    assert.match(first.providerKey, /^sha256:[a-f0-9]{16}$/)
    assert.equal(first.resumeMode, 'available')
    const serialized = JSON.stringify(first)
    assert.doesNotMatch(serialized, /secret|private|prompt|rawPath|D:\\|C:\\/i)
})

test('稳定维度变化可定位，模型和 Provider 必须分区', () => {
    const previous = buildContextEnvelope(createInput())
    const modelChanged = buildContextEnvelope(createInput({model: 'model-power'}))
    const providerChanged = buildContextEnvelope(createInput({providerIdentity: 'https://other.example.test'}))
    const rulesChanged = buildContextEnvelope(createInput({ruleRevision: 'rules-v2'}))

    assert.deepEqual(compareContextEnvelopes(previous, modelChanged).changedDimensions, ['model'])
    assert.equal(compareContextEnvelopes(previous, modelChanged).sameCachePartition, false)
    assert.deepEqual(compareContextEnvelopes(previous, providerChanged).changedDimensions, ['provider'])
    assert.equal(compareContextEnvelopes(previous, providerChanged).sameCachePartition, false)
    assert.deepEqual(compareContextEnvelopes(previous, rulesChanged).changedDimensions, ['rules'])
    assert.equal(compareContextEnvelopes(previous, rulesChanged).sameCachePartition, false)
})

test('空 resume ID 只标示不能复用会话，不将其混同为缓存结果', () => {
    const envelope = buildContextEnvelope(createInput({resumeSessionId: ''}))
    assert.equal(envelope.resumeMode, 'unavailable')
    assert.equal(envelope.resumeAvailable, false)
})
