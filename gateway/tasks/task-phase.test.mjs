import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveTaskPhases} from './task-phase.mjs'

test('Light 不 Prime 或启动 Agent', () => {
    assert.deepEqual(resolveTaskPhases({complexity: 'light', action: 'query', finalReview: 'none'}), {
        version: 1, complexity: 'light', phases: ['report'], requiresProjectContext: false, maxAgents: 0,
    })
})

test('Focused 只 Prime 后报告', () => {
    assert.deepEqual(resolveTaskPhases({complexity: 'light', action: 'inspect', finalReview: 'none'}).phases, ['prime', 'report'])
})

test('Balanced 普通修改不自动全量审查', () => {
    assert.deepEqual(resolveTaskPhases({complexity: 'balanced', action: 'implement', finalReview: 'none'}).phases, ['implement', 'validate', 'report'])
})

test('Power 高风险修改进入完整 PIV', () => {
    assert.deepEqual(resolveTaskPhases({complexity: 'power', action: 'refactor', finalReview: 'power'}).phases, ['prime', 'plan', 'implement', 'validate', 'review', 'report'])
})
