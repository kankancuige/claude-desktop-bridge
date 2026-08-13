import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyTranscriptLines} from './transcript-classifier.mjs'

test('main transcript stays main after using Agent tools', () => {
    const lines = [
        JSON.stringify({type: 'queue-operation', sessionId: 'main-1'}),
        JSON.stringify({type: 'user', sessionId: 'main-1', isSidechain: false, agentId: 'agent-used-in-turn', parentUuid: null}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'main')
})

test('explicit sidechain transcript is classified as agent', () => {
    const lines = [
        JSON.stringify({type: 'system', sessionId: 'agent-1'}),
        JSON.stringify({type: 'assistant', sessionId: 'agent-1', isSidechain: true, agentId: 'agent-1', parentUuid: 'parent-1'}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'agent')
})

test('legacy transcript without sidechain marker is preserved as unknown', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'legacy-1'}),
        JSON.stringify({type: 'assistant', sessionId: 'legacy-1', message: {content: 'ok'}}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'unknown')
})

test('invalid or truncated lines do not turn a transcript into an agent', () => {
    assert.equal(classifyTranscriptLines(['{"type":"user"', '', 'not-json']), 'unknown')
})
