import test from 'node:test'
import assert from 'node:assert/strict'
import {createCoordinatorRcaRuntime} from './coordinator-rca-runtime.mjs'

test('coordinator RCA runtime handles unavailable workflow', async () => {
    const runtime = createCoordinatorRcaRuntime({taskWorkbench: {recordRcaResult: (id, value) => ({id, value})}, taskCoordinator: {}, listWorkflows: () => [], runWorkflow() {}})
    assert.equal((await runtime.runCoordinatorRootCauseAnalysis('s', {coordinatorTaskId: 't'}, {}, {})).value.summary, 'Root Cause Workflow 不可用')
})
