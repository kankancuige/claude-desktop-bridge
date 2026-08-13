import assert from 'node:assert/strict'
import {test} from 'node:test'
import {sanitizeWorktreeSegment} from './worktree-path.mjs'

test('worktree 路径片段拒绝分隔符和父目录标记', () => {
    assert.equal(sanitizeWorktreeSegment('..\\..\\outside'), '.._.._outside')
    assert.equal(sanitizeWorktreeSegment('///'), 'workflow')
    assert.equal(sanitizeWorktreeSegment('a/b:c'), 'a_b_c')
})
