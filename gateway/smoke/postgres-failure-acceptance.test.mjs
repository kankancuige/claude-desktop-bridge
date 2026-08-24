import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

test('PostgreSQL failure acceptance 使用事务回滚和关闭 flush，不写入凭据', () => {
    const source = readFileSync(new URL('./postgres-failure-acceptance.mjs', import.meta.url), 'utf8')
    assert.match(source, /intentional-rollback/)
    assert.match(source, /STORAGE_POSTGRES_DISCONNECTED/)
    assert.match(source, /evidence\.reconnect = .*healthy/)
    assert.match(source, /await gateway\.close\(\)/)
    assert.doesNotMatch(source, /123456|PGPASSWORD|ANTHROPIC_API_KEY/)
})
