import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveSessionLink} from './session-link-resolver.mjs'

const task = {projectKey: 'p', sessionId: 'gw-1', sdkSessionId: 'sdk-1', historySessionId: 'sdk-1', turnId: 'turn-1'}

test('优先使用任务 Gateway Session', () => {
    const result = resolveSessionLink({task, projectKey: 'p', findTranscript: input => ({status: 'found', encodedDir: 'P', projectKey: input.projectKey})})
    assert.equal(result.available, true)
    assert.equal(result.sessionId, 'gw-1')
    assert.equal(result.turnId, 'turn-1')
})

test('只有 SDK Session 时通过映射恢复 Gateway Session', () => {
    const result = resolveSessionLink({task: {...task, sessionId: null}, projectKey: 'p', lookupGatewaySessionId: (project, id) => project === 'p' && id === 'sdk-1' ? 'gw-after-restart' : null, findTranscript: () => ({status: 'found', encodedDir: 'P'})})
    assert.equal(result.sessionId, 'gw-after-restart')
    assert.equal(result.sdkSessionId, 'sdk-1')
})

test('缺少 Transcript 或跨项目映射时返回不可用', () => {
    assert.equal(resolveSessionLink({task, projectKey: 'p', findTranscript: () => null}).available, false)
    assert.equal(resolveSessionLink({task, projectKey: 'other', findTranscript: () => ({status: 'found', encodedDir: 'P'})}).reason, 'project_mismatch')
    assert.equal(resolveSessionLink({task, projectKey: 'p', findTranscript: () => ({status: 'found', projectKey: 'other'})}).available, false)
})
