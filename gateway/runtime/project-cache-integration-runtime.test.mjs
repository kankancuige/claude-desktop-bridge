import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectCacheIntegrationRuntime} from './project-cache-integration-runtime.mjs'

test('project cache runtime injects exploration context once', () => {
    const pushed = []
    const session = {workDir: 'D:/p', pushStream: {push: value => pushed.push(value)}}
    const runtime = createProjectCacheIntegrationRuntime({
        loadProjectCache: () => ({files: 1}), buildCacheInjectionText: () => 'cached', isExplorationAttempt: () => true,
        currentFileScan: () => ({files: {}}), diffSnapshotVsCurrent: () => new Map(), buildProjectCache: async () => null,
        saveProjectCache() {}, updateProjectCache: async () => ({updated: 0}), markInternalInput() {},
    })
    runtime.maybeInjectProjectCache('s', session, {tool_name: 'Glob', input: {}})
    runtime.maybeInjectProjectCache('s', session, {tool_name: 'Glob', input: {}})
    assert.equal(pushed.length, 1)
})
