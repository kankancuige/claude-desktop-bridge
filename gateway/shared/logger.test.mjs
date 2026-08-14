import test from 'node:test'
import assert from 'node:assert/strict'
import {logHttpRequest} from './logger.mjs'

test('HTTP 日志遇到畸形 Host 时降级记录而不抛异常', () => {
    let entry = null
    const log = {
        info(fields, message) {
            entry = {fields, message}
        },
    }
    const req = {
        method: 'GET',
        url: '/api/version',
        headers: {host: ':::'},
        socket: {remoteAddress: '127.0.0.1'},
    }

    assert.doesNotThrow(() => logHttpRequest(log, req, 200, Date.now()))
    assert.equal(entry.fields.path, '/invalid-url')
    assert.match(entry.fields.url_error, /invalid url/i)
})
