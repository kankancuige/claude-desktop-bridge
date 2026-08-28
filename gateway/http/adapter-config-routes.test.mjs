import assert from 'node:assert/strict'
import test from 'node:test'
import {createAdapterConfigRoutes} from './adapter-config-routes.mjs'

function response() {
    return {
        statusCode: 0,
        body: '',
        writeHead(statusCode) { this.statusCode = statusCode },
        end(body = '') { this.body = body },
    }
}

function scheduledRoutes({executeScheduledTask = async () => ({started: true})} = {}) {
    const tasks = new Map()
    const handle = createAdapterConfigRoutes({
        scheduledTaskStore: {
            list: () => Object.fromEntries(tasks), get: id => tasks.get(id),
            upsert: (id, task) => { tasks.set(id, {...task}) }, remove: id => tasks.delete(id),
        },
        scheduledRuns: new Map(), cronJobs: new Map(), cron: {validate: () => true},
        crypto: {randomUUID: () => 'generated'}, MODEL: 'model', isDirectoryPath: () => true,
        readBody: async req => req.body || {}, registerScheduledJob() {}, destroyScheduledJob() {}, executeScheduledTask,
        log: {info() {}, warn() {}, error() {}, debug() {}}, ADAPTER_PLATFORMS: [], confirmHooks: [],
    })
    return {tasks, handle}
}

test('创建和读取定时任务默认使用 bypassPermissions', async () => {
    const {tasks, handle} = scheduledRoutes()
    const createRes = response()
    await handle({
        req: {method: 'POST', body: {id: 'task-1', cron: '* * * * *', prompt: '执行', workDir: 'D:/work'}},
        res: createRes, url: new URL('http://local/api/config/scheduled-tasks'),
    })
    assert.equal(createRes.statusCode, 200)
    assert.equal(tasks.get('task-1').permissionMode, 'bypassPermissions')

    const getRes = response()
    await handle({req: {method: 'GET'}, res: getRes, url: new URL('http://local/api/config/scheduled-tasks')})
    assert.equal(JSON.parse(getRes.body).tasks[0].permissionMode, 'bypassPermissions')
})

test('立即执行冲突保留具体 reason', async () => {
    const {tasks, handle} = scheduledRoutes({executeScheduledTask: async () => ({started: false, reason: 'already_running'})})
    tasks.set('task-1', {enabled: true})
    const res = response()
    await handle({
        req: {method: 'POST'}, res,
        url: new URL('http://local/api/config/scheduled-tasks/task-1/run'),
    })
    assert.equal(res.statusCode, 409)
    assert.deepEqual(JSON.parse(res.body), {ok: false, started: false, reason: 'already_running'})
})

test('通知重试等待适配器完成本轮发送后再返回最新状态', async () => {
    let finishRetry
    const retryFinished = new Promise(resolve => { finishRetry = resolve })
    const handle = createAdapterConfigRoutes({
        ADAPTER_PLATFORMS: ['wechat'],
        getAdapterHook: () => ({
            retryNotifications: async () => {
                await retryFinished
                return {reset: 8, pending: 0, failed: 8, dead: 0, sent: 0}
            },
        }),
    })
    const res = response()
    const request = handle({
        req: {method: 'POST'}, res,
        url: new URL('http://local/api/config/adapters/wechat/notifications/retry'),
    })

    await Promise.resolve()
    assert.equal(res.statusCode, 0)
    finishRetry()
    await request

    assert.equal(res.statusCode, 202)
    assert.deepEqual(JSON.parse(res.body), {
        ok: true, reset: 8, pending: 0, failed: 8, dead: 0, sent: 0,
    })
})
