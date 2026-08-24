import test from 'node:test'
import assert from 'node:assert/strict'
import {createConfirmationRuntime} from './confirmation-runtime.mjs'

test('confirmation runtime settles pending entries idempotently', async () => {
    const sessions = new Map([['s', {pending: new Map(), clients: new Set(), mirrors: {}}]])
    const sent = []
    const hooks = []
    const runtime = createConfirmationRuntime({
        sessions,
        getConfirmHooks: () => hooks,
        broadcastTurn: (...args) => sent.push(args),
        broadcast: () => {},
        shouldRouteMirror: () => true,
    })
    let resolved = 0
    sessions.get('s').pending.set('r', {type: 'permission', toolName: 'Edit', resolve: () => { resolved++ }, settled: false})
    runtime.settlePending('s', 'r', {behavior: 'allow'}, 'desktop')
    runtime.settlePending('s', 'r', {behavior: 'deny'}, 'timeout')
    assert.equal(resolved, 1)
    assert.equal(sent[0][1].type, 'confirmation_resolved')
})

test('confirmation runtime maps choice and permission decisions', () => {
    const runtime = createConfirmationRuntime({sessions: new Map(), broadcastTurn: () => {}, broadcast: () => {}, shouldRouteMirror: () => true})
    const choice = {type: 'choice', questions: [{options: [{label: '继续'}]}]}
    assert.equal(runtime.decisionToResult(choice, null, 0, 0).message, '用户选择了: 继续')
    assert.deepEqual(runtime.decisionToResult({type: 'permission', input: {path: 'a'}}, 'allow'), {behavior: 'allow', updatedInput: {path: 'a'}})
})
