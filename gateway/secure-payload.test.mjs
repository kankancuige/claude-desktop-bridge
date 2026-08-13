import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SecurePayloadCodec} from './secure-payload.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-codec-'))
try {
    const keyPath = join(dir, 'key')
    const codec = new SecurePayloadCodec(keyPath)
    const encoded = codec.encode({userId: 'u1', text: 'hello'})
    assert.equal(encoded.includes('hello'), false)
    assert.deepEqual(codec.decode(encoded), {userId: 'u1', text: 'hello'})
    const restored = new SecurePayloadCodec(keyPath)
    assert.deepEqual(restored.decode(encoded), {userId: 'u1', text: 'hello'})
    assert.throws(() => restored.decode(encoded.slice(0, -2) + 'aa'))
    console.log('secure-payload tests passed')
} finally {
    rmSync(dir, {recursive: true, force: true})
}
