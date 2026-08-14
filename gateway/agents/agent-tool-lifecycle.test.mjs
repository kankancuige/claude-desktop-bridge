import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAgentDescriptor, buildAgentToolLifecycleEvent, describeAgent} from './agent-tool-lifecycle.mjs'

test('Agent and legacy Task produce the same subagent lifecycle event', () => {
    for (const toolName of ['Agent', 'Task']) {
        const event = buildAgentToolLifecycleEvent(toolName, {
            subagent_type: 'Explore',
            description: 'inspect the project',
        }, 'req-1', 123)
        assert.deepEqual(event, {
            type: 'subagent_spawning',
            requestId: 'req-1',
            name: 'Explore',
            agentType: 'Explore',
            description: 'inspect the project',
            purpose: '项目探索：快速扫描目录、定位相关文件并总结代码结构。',
            task: 'inspect the project',
            scope: '',
            currentAction: '',
            descriptionSource: 'input',
            ts: 123,
        })
    }
})

test('Workflow remains a separate lifecycle event', () => {
    const event = buildAgentToolLifecycleEvent('Workflow', {name: 'review', phases: ['check']}, 'req-2', 456)
    assert.equal(event.type, 'workflow_started')
    assert.equal(event.workflowId, 'wf-review-co')
    assert.deepEqual(event.phases, ['check'])
})

test('ordinary tools do not emit a lifecycle event', () => {
    assert.equal(buildAgentToolLifecycleEvent('Read', {path: 'README.md'}, 'req-3', 789), null)
})

test('built-in and configured agents always expose a purpose description', () => {
    assert.match(describeAgent('Explore'), /项目探索/)
    assert.equal(describeAgent('custom', {}, {custom: {description: '数据库审查代理'}}), '数据库审查代理')
    assert.equal(buildAgentToolLifecycleEvent('Task', {subagent_type: 'Plan'}, 'req-4', 100).description, '方案规划：分析需求、拆分步骤并制定实现计划。')
})

test('specific task remains separate from the built-in purpose', () => {
    assert.deepEqual(buildAgentDescriptor('Explore', {description: '定位上下文百分比错误'}), {
        purpose: '项目探索：快速扫描目录、定位相关文件并总结代码结构。',
        task: '定位上下文百分比错误',
        scope: '',
        currentAction: '',
        descriptionSource: 'input',
    })
})

test('same-type parallel agents keep distinct tool use identities', () => {
    const first = buildAgentToolLifecycleEvent('Agent', {subagent_type: 'Explore', prompt: '检查 Gateway'}, 'req-a', 1, {}, {toolUseId: 'tool-a'})
    const second = buildAgentToolLifecycleEvent('Agent', {subagent_type: 'Explore', prompt: '检查 Vue'}, 'req-b', 2, {}, {toolUseId: 'tool-b'})
    assert.equal(first.toolUseId, 'tool-a')
    assert.equal(second.toolUseId, 'tool-b')
    assert.notEqual(first.toolUseId, second.toolUseId)
    assert.notEqual(first.task, second.task)
})
