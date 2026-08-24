import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {createPitfallRepository} from '../storage/repositories/pitfall-repository.mjs'
import {createPitfallService} from './pitfall-service.mjs'

test('首次观察、重复指纹、项目隔离和冷却期', t => {
    let timestamp = 1000
    const {store} = createPostgresStateFixture()
    t.after(() => store.close())
    const service = createPitfallService({repository: createPitfallRepository({stateStore: store}), now: () => timestamp, cooldownMs: 100})
    const first = service.recordPitfallOccurrence({projectKey: 'a', taskId: 't1', module: 'gateway', message: 'error 1', tags: ['gateway']})
    assert.equal(first.status, 'observed')
    assert.equal(first.notify, true)
    timestamp += 50
    const duplicate = service.recordPitfallOccurrence({projectKey: 'a', taskId: 't1', module: 'gateway', message: 'error 2', tags: ['gateway']})
    assert.equal(duplicate.occurrenceRecorded, false)
    assert.equal(duplicate.notify, false)
    timestamp += 200
    const repeated = service.recordPitfallOccurrence({projectKey: 'a', taskId: 't2', module: 'gateway', message: 'error 3', tags: ['gateway']})
    assert.equal(repeated.status, 'candidate')
    assert.deepEqual(service.list('b'), [])
})

test('确认、缓解、过期和相关性过滤', t => {
    let timestamp = 1000
    const {store} = createPostgresStateFixture()
    t.after(() => store.close())
    const service = createPitfallService({repository: createPitfallRepository({stateStore: store}), now: () => timestamp})
    const item = service.recordPitfallOccurrence({projectKey: 'p', taskId: 't', fingerprint: 'f', title: 'Provider', tags: ['provider'], expiresAt: 2000})
    service.transitionPitfall(item.id, 'confirmed', {rootCause: '配置漂移', prevention: '固定配置'})
    assert.equal(service.findRelevantPitfalls({projectKey: 'p', tags: ['provider']})[0].status, 'confirmed')
    assert.equal(service.verifyPitfallPrevention(item.id, '测试通过'), true)
    timestamp = 3000
    assert.deepEqual(service.findRelevantPitfalls({projectKey: 'p', tags: ['provider']}), [])
})
