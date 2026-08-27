import assert from 'node:assert/strict'
import test from 'node:test'
import {createImRepository} from './im-repository.mjs'
import {createWorkflowRepository} from './workflow-repository.mjs'
import {createPitfallRepository} from './pitfall-repository.mjs'
import {createProjectRepository} from './project-repository.mjs'
import {createSessionRepository} from './session-repository.mjs'
import {createWorkbenchRepository} from './workbench-repository.mjs'

function adapter() {
    return {
        listSessionIndex: () => [], findSessionIndexById: () => [], getSessionCatalog: () => null, upsertSessionCatalog: value => value, upsertSessionCatalogBatch: () => true, removeSessionCatalog: () => true, updateSessionSettingsByIds: () => true,
        listWorkbenchProjectKeys: () => [], getTaskState: () => null, listTaskStates: () => [], recordTaskTransition: () => true, listExecutionReports: () => [], getExecutionReport: () => null, listPitfalls: () => [], listRecentPitfalls: () => [],
        recordPitfall: () => ({}), recordPitfallOccurrence: () => true, updatePitfallStatus: () => true, linkPitfall: () => true, getPitfall: () => null,
        loadEntries: () => new Map(), replaceEntries: () => true, clearEntries: () => 0, summarizeEntries: () => ({}),
    }
}

test('领域 repositories 只暴露 port 方法，不暴露兼容层内部对象', () => {
    const stateStore = adapter()
    const repositories = [createSessionRepository({stateStore}), createProjectRepository({stateStore}), createWorkbenchRepository({stateStore}), createPitfallRepository({stateStore}), createImRepository({stateStore})]
    for (const repository of repositories) {
        assert.equal(repository.query, undefined)
        assert.equal(repository.client, undefined)
        assert.equal(repository._store, undefined)
    }
})

test('Workflow Repository 只暴露状态投影和恢复 port', () => {
    const calls = []
    const stateStore = {
        available: true,
        upsertWorkflowState: record => { calls.push(['upsert', record]); return true },
        listWorkflowStates: (projectKey, options) => { calls.push(['list', projectKey, options]); return [] },
    }
    const repository = createWorkflowRepository({stateStore})
    assert.equal(repository.available, true)
    assert.equal(repository.upsert({projectKey: 'p', workflowId: 'w'}), true)
    assert.deepEqual(repository.list({projectKey: 'p', parentSessionId: 's', limit: 2}), [])
    assert.deepEqual(calls.map(call => call[0]), ['upsert', 'list'])
    assert.equal('query' in repository, false)
    assert.equal('client' in repository, false)
})
