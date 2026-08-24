import assert from 'node:assert/strict'
import test from 'node:test'
import {createCoordinatorPersistence} from './coordinator-persistence.mjs'

test('Coordinator 每个 revision 同时写 PostgreSQL 与 Session Event Journal', () => {
    const dbWrites = []
    const journalWrites = []
    const persist = createCoordinatorPersistence({
        repository: {available: true, upsertTask: value => { dbWrites.push(value); return true }},
        projectKeyForWorkDir: value => `key:${value}`,
        resolveJournal: sessionId => ({append: (type, payload, options) => journalWrites.push({sessionId, type, payload, options})}),
    })
    const snapshot = {
        taskId: 'task-1', sessionId: 'session-1', status: 'running', phase: 'implement',
        revision: 3, sequence: 2, startedAt: 1, completedAt: 0, updatedAt: 2,
        plan: {workDir: 'D:\\work', decision: {modelTier: 'balanced'}, steps: []},
    }
    assert.equal(persist(snapshot, {type: 'phase/started', stepId: 'step-1'}), true)
    assert.equal(dbWrites.length, 1)
    assert.equal(dbWrites[0].taskKey, 'task-1:coordinator')
    assert.equal(journalWrites.length, 1)
    assert.equal(journalWrites[0].type, 'task/coordinator-transition')
    assert.equal(journalWrites[0].payload.revision, 3)
    assert.equal(journalWrites[0].options.critical, true)
})

test('Coordinator 可串行影子写入 PostgreSQL，并只保存脱敏投影', async () => {
    const shadowWrites = []
    const persist = createCoordinatorPersistence({
        repository: {available: false},
        shadowRepository: {available: true, upsertTask: async record => { shadowWrites.push(record); return true }},
        projectKeyForWorkDir: () => 'D--demo',
        resolveJournal: () => ({append() {}}),
    })
    const snapshot = {
        taskId: 'task-1', turnId: 'turn-1', sessionId: 'session-1', status: 'running', phase: 'implement', revision: 2, sequence: 1,
        plan: {workDir: 'D:\\demo', decision: {modelTier: 'balanced'}},
        verification: {status: 'not_started'}, blockers: [], findings: [], agents: {}, workflows: {}, notificationIntentPersisted: false,
        startedAt: 1, completedAt: 0, updatedAt: 2,
    }
    assert.equal(persist(snapshot, {type: 'phase/started'}), true)
    await persist.drain()
    assert.equal(shadowWrites.length, 1)
    assert.equal(shadowWrites[0].state.coordinator, true)
    assert.equal(shadowWrites[0].state.plan, undefined)
    assert.equal(shadowWrites[0].state.taskId, 'task-1')
})
