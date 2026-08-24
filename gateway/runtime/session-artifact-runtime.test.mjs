import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionArtifactRuntime} from './session-artifact-runtime.mjs'

test('Session Artifact Runtime 显式接收扫描和会话端口', () => {
    const runtime = createSessionArtifactRuntime({
        BRIDGE_HOME: 'D:/bridge', encodeProjectName: value => value,
        readJSON: () => null, writeJSON() {}, log: {info() {}, warn() {}},
        sessions: new Map(), buildFileSnapshot() { return {files: new Map()} },
        currentFileScan() { return {files: new Map(), missing: false} },
        diffSnapshotVsCurrent() { return new Map() }, resolveSafe: () => null,
        existsSync: () => false, unlinkSync() {}, dirname: value => value,
        join: (...parts) => parts.join('/'),
        mkdirSync() {}, writeFileSync() {},
    })
    assert.equal(typeof runtime.beginTurn, 'function')
    assert.equal(typeof runtime.finalizeCheckpoint, 'function')
    assert.equal(typeof runtime.rewindToCheckpoint, 'function')
})

test('Session Artifact Runtime 缺少扫描边界时立即失败', () => {
    assert.throws(() => createSessionArtifactRuntime(), /dependencies are required/)
})
