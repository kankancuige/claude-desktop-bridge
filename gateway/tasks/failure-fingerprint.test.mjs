import assert from 'node:assert/strict'
import test from 'node:test'
import {createFailureFingerprint, normalizeFailureMessage} from './failure-fingerprint.mjs'

test('错误指纹脱敏路径和数字但保留模块阶段差异', () => {
    const first = createFailureFingerprint({projectKey: 'p', module: 'm', phase: 'test', errorCode: 'E1', message: 'C:/secret/a.mjs:123 token=abc'})
    const second = createFailureFingerprint({projectKey: 'p', module: 'm', phase: 'test', errorCode: 'E1', message: 'D:/other/b.mjs:456 token=def'})
    assert.equal(first, second)
    assert.notEqual(first, createFailureFingerprint({projectKey: 'p', module: 'm2', phase: 'test', errorCode: 'E1', message: 'x'}))
    assert.equal(normalizeFailureMessage('password=hello').includes('hello'), false)
})
