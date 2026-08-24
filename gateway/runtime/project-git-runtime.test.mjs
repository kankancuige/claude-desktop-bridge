import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectGitRuntime} from './project-git-runtime.mjs'

test('项目 Git Runtime 仅通过端口生成和注入上下文', () => {
    const calls = []
    const runtime = createProjectGitRuntime({
        execSync(command) { calls.push(command); return command.includes('abbrev-ref') ? 'main\n' : command.includes('short') ? 'abc123\n' : command.includes('log') ? 'abc commit\n' : '' },
        markInternalInput(session) { session.marked = true },
    })
    const context = runtime.buildGitContext('D:/project')
    assert.match(context, /Branch: main/)
    assert.equal(calls.length, 4)
    const pushed = []
    const session = {_gitContext: context, pushStream: {push: value => pushed.push(value)}}
    assert.equal(runtime.injectGitContext('s1', session), true)
    assert.equal(session.marked, true)
    assert.equal(pushed.length, 1)
    assert.equal(runtime.injectGitContext('s1', session), false)
})
