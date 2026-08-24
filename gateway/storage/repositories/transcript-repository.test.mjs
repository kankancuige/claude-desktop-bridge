import assert from 'node:assert/strict'
import test from 'node:test'
import {createTranscriptRepository} from './transcript-repository.mjs'

test('Transcript Repository 统一 session/ source key，并兼容旧无前缀记录', async () => {
    const calls = []
    const contentStore = {
        get: async args => { calls.push(['get', args]); return args.sourceKey === 'session/sdk-1' ? {body: 'jsonl'} : null },
        put: async args => { calls.push(['put', args]); return args },
    }
    const repository = createTranscriptRepository({contentStore})
    assert.equal((await repository.get({projectKey: 'p', sessionId: 'sdk-1'})).body, 'jsonl')
    await repository.save({projectKey: 'p', sessionId: 'sdk-1', body: 'next'})
    assert.equal(calls[0][1].sourceKey, 'session/sdk-1')
    assert.equal(calls.at(-1)[1].sourceKey, 'session/sdk-1')
})
