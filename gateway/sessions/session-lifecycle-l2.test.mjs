import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveSessionResume} from './session-resume.mjs'
import {createSessionRuntime} from './session-runtime.mjs'
import {createSessionCoordinator} from './session-coordinator.mjs'
import {createTaskInputQueue} from './task-input-queue.mjs'
import {hasStoppablePrimaryWork} from './session-stop.mjs'
import {getSessionRuntimeState} from './session-runtime-state.mjs'
import {createTaskCompletionState, transitionTaskCompletion} from '../tasks/task-completion.mjs'
import {createTaskLifecycleSnapshot} from '../tasks/task-lifecycle.mjs'

test('补充指令、停止、恢复形成可解释的 L2 生命周期闭环', () => {
    const session = createSessionRuntime({workDir: 'D:/project'})
    const inputs = createTaskInputQueue({maxPending: 4})
    const coordinator = createSessionCoordinator()
    const firstInput = inputs.accept(session, {source: 'desktop', messageId: 'first'})
    const rebuild = coordinator.beginRebuild(session, '首次任务')

    assert.equal(firstInput.ok, true)
    assert.equal(inputs.accept(session, {source: 'desktop', messageId: 'follow-up'}).ok, true)
    assert.equal(coordinator.enqueue(session, '补充指令'), true)
    assert.equal(hasStoppablePrimaryWork(session), true)

    // 与 Gateway 停止路径同序：失效重建令牌、清空排队输入、进入 stopped 终态。
    coordinator.invalidate(session)
    const cancelled = inputs.drain(session)
    const stopped = transitionTaskCompletion(createTaskCompletionState({phase: 'running'}), {
        type: 'user_stopped', detail: '用户已暂停任务',
    }).state
    session.taskCompletion = stopped
    session._generating = false
    session.activeTurnId = null
    session._pendingTurns = []

    assert.deepEqual(cancelled.map(item => item.messageId), ['first', 'follow-up'])
    assert.equal(session._rebuildPromise, null)
    assert.equal(session._pendingMessages, null)
    assert.equal(stopped.phase, 'stopped')
    assert.equal(hasStoppablePrimaryWork(session), false)

    const snapshot = createTaskLifecycleSnapshot({
        sessionId: 'session-1',
        runtime: getSessionRuntimeState(session),
        task: {status: stopped.phase, resumable: true},
    })
    assert.deepEqual(snapshot.capabilities, {canSend: true, canStop: false, canContinue: true})
    assert.deepEqual(resolveSessionResume({requestedResume: 'missing'}), {
        mode: 'missing', gatewaySessionId: null, sdkSessionId: null,
    })
})
