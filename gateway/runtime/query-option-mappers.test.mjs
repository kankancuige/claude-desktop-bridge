import test from 'node:test'
import assert from 'node:assert/strict'
import {mapThinkingLevel} from './query-option-mappers.mjs'

test('maps thinking levels to SDK budgets', () => {
    assert.deepEqual(mapThinkingLevel('off'), {type: 'disabled'})
    assert.equal(mapThinkingLevel('max').budgetTokens, 32000)
})
