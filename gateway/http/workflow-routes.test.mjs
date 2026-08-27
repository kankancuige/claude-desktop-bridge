import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkflowRoutes} from './workflow-routes.mjs'

test('Runner 已广播错误时 HTTP 后台 catcher 不重复广播', async () => {
    const broadcasts = []
    const workflowRuntime = {
        getWorkflow: () => ({name: 'review'}), presetRunState() {},
        runWorkflow: async () => { throw new Error('failed') },
        getRunState: () => ({status: 'error'}),
    }
    const route = createWorkflowRoutes({
        workflowRuntime, safeDecodeURIComponent: value => value, readBody: async () => ({sessionId: 's'}),
        sessions: new Map([['s', {}]]), loadWfConfig: () => ({enabled: true}),
        broadcast: (...args) => broadcasts.push(args), broadcastTaskLifecycle() {},
        log: {warn() {}},
    })
    const res = {statusCode: 0, writeHead(code) { this.statusCode = code }, end() {}}
    await route({req: {method: 'POST'}, res, url: new URL('http://local/api/workflows/review/run')})
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(res.statusCode, 202)
    assert.equal(broadcasts.length, 0)
})
