import test from 'node:test'
import assert from 'node:assert/strict'
import {isMemoryIndexReady, memoryModeLabelKey} from './memory-mode.mjs'

test('PostgreSQL Memory 索引显示为正常', () => {
  assert.equal(isMemoryIndexReady('postgres'), true)
  assert.equal(memoryModeLabelKey('postgres'), 'mem.indexReady')
})

test('旧 SQLite、缺失和未知模式显示为降级', () => {
  for (const mode of ['sqlite', null, undefined, 'unknown']) {
    assert.equal(isMemoryIndexReady(mode), false)
    assert.equal(memoryModeLabelKey(mode), 'mem.fileMode')
  }
})
