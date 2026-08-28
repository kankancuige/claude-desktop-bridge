import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./session-create-mode.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {buildSessionCreateRequest, shouldReuseTabForSessionCreate} = await import(moduleUrl)

test('恢复和分支请求字段互不混用', () => {
    assert.deepEqual(buildSessionCreateRequest({workDir: 'D:/work', resume: 'sdk-a'}), {workDir: 'D:/work', resume: 'sdk-a'})
    assert.deepEqual(buildSessionCreateRequest({workDir: 'D:/work', forkFrom: 'sdk-a'}), {workDir: 'D:/work', forkFrom: 'sdk-a'})
    assert.deepEqual(buildSessionCreateRequest({workDir: 'D:/work', recoverSessionId: 'gw-a'}), {workDir: 'D:/work', recoverSessionId: 'gw-a'})
})

test('分支必须创建新 tab，恢复可以复用同一历史 tab', () => {
    assert.equal(shouldReuseTabForSessionCreate({mode: 'resume', requestedSessionId: 'sdk-a', tabHistorySessionId: 'sdk-a'}), true)
    assert.equal(shouldReuseTabForSessionCreate({mode: 'fork', requestedSessionId: 'sdk-a', tabHistorySessionId: 'sdk-a'}), false)
})

test('同时指定恢复和分支时拒绝构建请求', () => {
    assert.throws(() => buildSessionCreateRequest({workDir: 'D:/work', resume: 'sdk-a', forkFrom: 'sdk-b'}), /不能同时/)
    assert.throws(() => buildSessionCreateRequest({workDir: 'D:/work', resume: 'sdk-a', recoverSessionId: 'gw-a'}), /不能同时/)
})
