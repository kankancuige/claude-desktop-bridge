import test from 'node:test'
import assert from 'node:assert/strict'
import {createScheduledTaskStore} from './scheduled-task-store.mjs'

const task = {cron: '* * * * *', prompt: 'run', workDir: 'D:/project', enabled: true}

test('Scheduled Task Store 校验、复制和持久化回滚', () => {
    let disk = {}
    const store = createScheduledTaskStore({readJSON: () => disk, writeJSON: (_path, value) => { disk = value }, path: 'tasks.json'})
    store.upsert('daily', task)
    const listed = store.list()
    listed.daily.prompt = 'mutated'
    assert.equal(store.get('daily').prompt, 'run')
    assert.throws(() => store.upsert('bad id', task), /id invalid/)
    assert.equal(store.remove('daily'), true)
    assert.equal(store.remove('daily'), false)
})

test('Scheduled Task Store 写入失败恢复旧值', () => {
    let shouldFail = false
    const store = createScheduledTaskStore({readJSON: () => ({daily: task}), writeJSON: () => { if (shouldFail) throw new Error('disk') }, path: 'tasks.json'})
    shouldFail = true
    assert.throws(() => store.upsert('daily', {...task, prompt: 'new'}), /disk/)
    assert.equal(store.get('daily').prompt, 'run')
})
