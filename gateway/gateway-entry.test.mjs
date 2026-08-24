import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

test('gateway index is a pure startup composition root', () => {
    const source = readFileSync(join(root, 'index.mjs'), 'utf8')
    assert.match(source, /import\s+\{startGateway\}\s+from\s+'\.\/gateway-runtime\.mjs'/)
    assert.doesNotMatch(source, /createServer|createStorageGateway|query\(|url\.pathname|PostgreSQL|SQLite/)
    assert.ok(source.length < 1000)
})

test('gateway runtime exports the startup boundary', () => {
    const source = readFileSync(join(root, 'gateway-runtime.mjs'), 'utf8')
    assert.match(source, /export\s+async\s+function\s+startGateway\s*\(/)
    assert.doesNotMatch(source, /bootGateway\(\)\.catch\(/)
})
