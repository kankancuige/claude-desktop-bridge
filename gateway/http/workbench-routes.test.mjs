import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkbenchRoutes} from './workbench-routes.mjs'

function response() {
    return {headers: {}, setHeader(name, value) { this.headers[name] = value }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body }}
}

test('健康和 Workbench 路由通过注入 port 返回既有 JSON 契约', async () => {
    const state = {available: true, degraded: false, mode: 'postgres', schemaVersion: 2, listTaskStates: () => [{taskId: 't'}], listExecutionReports: () => [], listWorkbenchProjectKeys: () => ['p'], listRecentPitfalls: () => [], listPitfalls: () => [], getExecutionReport: () => null}
    const repositories = {workbench: {listTasks: () => [{taskId: 't'}], listReports: () => [], listProjectKeys: () => [], getReport: () => null}, pitfall: {findRelevant: () => [], listRecent: () => []}}
    const handler = createWorkbenchRoutes({version: '1.5.0', getState: () => state, getRepositories: () => repositories, getStorageHealth: async () => ({mode: 'postgres', healthy: true}), getAiHealth: () => ({healthy: true}), getDriftCandidates: () => []})
    const health = response()
    assert.equal(await handler({req: {method: 'GET'}, res: health, url: new URL('http://127.0.0.1/api/health')}), true)
    assert.equal(health.status, 200)
    assert.equal(JSON.parse(health.body).storage.healthy, true)
    const tasks = response()
    await handler({req: {method: 'GET'}, res: tasks, url: new URL('http://127.0.0.1/api/workbench/tasks?limit=5')})
    assert.deepEqual(JSON.parse(tasks.body).tasks, [{taskId: 't'}])
    const other = response()
    assert.equal(await handler({req: {method: 'GET'}, res: other, url: new URL('http://127.0.0.1/api/other')}), false)
})

test('任务详情、事件分页和会话链接只通过仓储与 Resolver 回调', async () => {
    const task = {taskId: 't:turn', taskKey: 't:turn', title: '可读任务', summary: '摘要', projectKey: 'p', sessionId: 'gw', turnId: 'turn', status: 'succeeded', updatedAt: 2, state: {apiKey: 'do-not-leak', requestText: '原始 prompt', workDir: 'D:\\private', coordinator: {agents: {}, workflows: {}}}}
    const repositories = {workbench: {
        getTask: () => task,
        getTaskDetail: () => ({task, events: [{revision: 1, eventType: 'task/created', payload: {requestText: '原始问题', summary: '摘要'}}], questions: [{questionId: 't:turn#1', taskId: 't:turn', turnId: 'turn', text: '问题'}], agents: {}, workflows: {}, verification: null, report: null}),
        listTaskEvents: options => [{revision: 1, projectKey: options.projectKey}],
        listTasks: () => [], listReports: () => [], listProjectKeys: () => [], getReport: () => null,
    }, pitfall: {findRelevant: () => [], listRecent: () => []}}
    const handler = createWorkbenchRoutes({version: '1.5.0', getState: () => ({available: true, degraded: false}), getRepositories: () => repositories, resolveSessionLink: ({task: current}) => ({projectKey: current.projectKey, encodedDir: 'P', sessionId: current.sessionId, sdkSessionId: 'sdk', historySessionId: 'sdk', turnId: current.turnId, available: true})})
    const detail = response()
    await handler({req: {method: 'GET'}, res: detail, url: new URL('http://127.0.0.1/api/workbench/tasks/t%3Aturn?projectKey=p')})
    assert.equal(JSON.parse(detail.body).task.title, '可读任务')
    assert.equal(JSON.parse(detail.body).sessionLink.available, true)
    assert.equal(JSON.parse(detail.body).questions[0].text, '问题')
    assert.equal(JSON.parse(detail.body).task.state.apiKey, undefined)
    assert.equal(JSON.parse(detail.body).task.state.requestText, undefined)
    assert.equal(JSON.parse(detail.body).task.state.workDir, undefined)
    assert.equal(JSON.parse(detail.body).events[0].payload.requestText, undefined)
    const events = response()
    await handler({req: {method: 'GET'}, res: events, url: new URL('http://127.0.0.1/api/workbench/tasks/t%3Aturn/events?projectKey=p&after=0')})
    assert.equal(JSON.parse(events.body).events[0].revision, 1)
})

test('执行报告只输出结构化可读字段，不透传内部字段', async () => {
    const repositories = {workbench: {
        listReports: () => [{taskId: 'opaque-id', status: 'succeeded', plannedSteps: [{stepId: 's1', phase: 'implement', role: 'developer'}], unresolvedRisks: ['环境未验证'], internalPrompt: '不要输出'}],
        listTasks: () => [], listProjectKeys: () => [], listTaskEvents: () => [], getReport: () => null,
    }, pitfall: {findRelevant: () => [], listRecent: () => []}}
    const handler = createWorkbenchRoutes({getState: () => ({available: true, degraded: false}), getRepositories: () => repositories})
    const result = response()
    await handler({req: {method: 'GET'}, res: result, url: new URL('http://127.0.0.1/api/workbench/reports')})
    const report = JSON.parse(result.body).reports[0]
    assert.equal(report.taskId, 'opaque-id')
    assert.equal(report.plannedSteps[0].phase, 'implement')
    assert.equal(report.internalPrompt, undefined)
})

test('Workbench 路由明确区分任务不存在和 PostgreSQL 不可用', async () => {
    const response404 = response()
    const handler404 = createWorkbenchRoutes({getState: () => ({available: true, degraded: false}), getRepositories: () => ({workbench: {getTask: () => null}})})
    await handler404({req: {method: 'GET'}, res: response404, url: new URL('http://127.0.0.1/api/workbench/tasks/missing?projectKey=p')})
    assert.equal(response404.status, 404)
    const response503 = response()
    const handler503 = createWorkbenchRoutes({getState: () => ({available: false, degraded: true}), getRepositories: () => ({workbench: {}})})
    await handler503({req: {method: 'GET'}, res: response503, url: new URL('http://127.0.0.1/api/workbench/tasks/missing/events?projectKey=p')})
    assert.equal(response503.status, 503)
})
