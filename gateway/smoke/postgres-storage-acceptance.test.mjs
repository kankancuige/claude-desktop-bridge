import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

test('PostgreSQL 验收脚本不输出密码或完整内容', () => {
    const source = readFileSync(new URL('./postgres-storage-acceptance.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /123456|PGPASSWORD|ANTHROPIC_API_KEY/)
    assert.match(source, /intentional-rollback/)
})
