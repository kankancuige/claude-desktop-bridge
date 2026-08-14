import assert from 'node:assert/strict'
import test from 'node:test'

import {filterVisibleSessionIds, isUserSessionSource, markSessionVisible, migrateLegacySessionVisibility, removeSessionVisibility, sessionVisibilitySource, shouldShowSession, visibleSessionIds} from './session-visibility.mjs'

test('只有桌面或 IM 首次输入来源才能进入可见白名单', () => {
    const state = markSessionVisible({sessions: {}}, {gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1', source: 'desktop'})
    assert.equal(shouldShowSession(state, 'gw-1'), true)
    assert.equal(shouldShowSession(state, 'sdk-1'), true)
    assert.equal(shouldShowSession(markSessionVisible(state, {gatewaySessionId: 'agent-1', source: 'workflow'}), 'agent-1'), false)
})

test('可见白名单同时支持 Gateway ID 和 SDK ID', () => {
    const state = markSessionVisible({sessions: {}}, {gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1', source: 'wechat'})
    assert.deepEqual([...visibleSessionIds(state).gatewayIds], ['gw-1'])
    assert.deepEqual([...visibleSessionIds(state).sdkIds], ['sdk-1'])
})

test('删除会话时同时移除可见白名单', () => {
    const state = markSessionVisible({sessions: {}}, {gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1', source: 'desktop'})
    const next = removeSessionVisibility(state, {gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1'})
    assert.equal(shouldShowSession(next, 'gw-1'), false)
    assert.equal(shouldShowSession(next, 'sdk-1'), false)
})

test('首次真实输入来源不会被后续平台覆盖', () => {
    const desktop = markSessionVisible({sessions: {}}, {gatewaySessionId: 'gw-1', source: 'desktop'})
    const mirrored = markSessionVisible(desktop, {gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1', source: 'wechat'})
    assert.equal(sessionVisibilitySource(mirrored, 'gw-1', 'sdk-1'), 'desktop')
})

test('未知内部来源不能伪装成用户可见会话', () => {
    assert.equal(isUserSessionSource('desktop'), true)
    assert.equal(isUserSessionSource('dingtalk'), true)
    assert.equal(isUserSessionSource('workflow'), false)
    assert.equal(isUserSessionSource('scheduler'), false)
})

test('旧会话只有同时具备主 transcript 和真实用户回合状态才迁移', () => {
    const next = migrateLegacySessionVisibility({sessions: {}}, {
        sessionMap: {
            'gw-user': 'sdk-user',
            'gw-scheduled': 'sdk-scheduled',
            'wf-agent-1': 'sdk-agent',
        },
        transcriptKinds: {
            'sdk-user': 'main',
            'sdk-scheduled': 'main',
            'sdk-agent': 'agent',
        },
        taskStates: {
            'gw-user': {taskId: 'gw-user:turn-1', turnId: 'turn-1'},
            'gw-scheduled': {taskId: null, turnId: null},
        },
    })

    assert.equal(shouldShowSession(next, 'sdk-user'), true)
    assert.equal(shouldShowSession(next, 'sdk-scheduled'), false)
    assert.equal(shouldShowSession(next, 'sdk-agent'), false)
    assert.equal(next.legacyMigrationVersion, 1)
})

test('已有新会话白名单时仍增量迁移旧用户会话', () => {
    const current = markSessionVisible({sessions: {}}, {
        gatewaySessionId: 'gw-new', sdkSessionId: 'sdk-new', source: 'wechat',
    })
    const next = migrateLegacySessionVisibility(current, {
        sessionMap: {'gw-old': 'sdk-old'},
        transcriptKinds: {'sdk-old': 'main'},
        taskStates: {'gw-old': {taskId: 'gw-old:turn-old', turnId: 'turn-old'}},
    })

    assert.equal(shouldShowSession(next, 'sdk-new'), true)
    assert.equal(shouldShowSession(next, 'sdk-old'), true)
})

test('旧桌面会话停止后本轮 ID 被清空时仍按持久化 SDK 身份迁移', () => {
    const next = migrateLegacySessionVisibility({sessions: {}}, {
        sessionMap: {'gw-stopped': 'sdk-stopped'},
        transcriptKinds: {'sdk-stopped': 'main'},
        taskStates: {
            'gw-stopped': {
                status: 'stopped', taskId: null, turnId: null,
                sdkSessionId: 'sdk-stopped', historySessionId: 'sdk-stopped',
            },
        },
    })

    assert.equal(shouldShowSession(next, 'sdk-stopped'), true)
})

test('没有用户会话状态的定时任务即使有主 transcript 也不迁移', () => {
    const next = migrateLegacySessionVisibility({sessions: {}}, {
        sessionMap: {'scheduled-runtime': 'sdk-scheduled'},
        transcriptKinds: {'sdk-scheduled': 'main'},
        taskStates: {},
    })

    assert.equal(shouldShowSession(next, 'sdk-scheduled'), false)
})

test('项目列表只保留桌面输入和 IM 注入会话', () => {
    let state = {sessions: {}}
    state = markSessionVisible(state, {gatewaySessionId: 'gw-desktop', sdkSessionId: 'sdk-desktop', source: 'desktop'})
    state = markSessionVisible(state, {gatewaySessionId: 'gw-wechat', sdkSessionId: 'sdk-wechat', source: 'wechat'})
    state = markSessionVisible(state, {gatewaySessionId: 'gw-feishu', sdkSessionId: 'sdk-feishu', source: 'feishu'})
    state = markSessionVisible(state, {gatewaySessionId: 'gw-dingtalk', sdkSessionId: 'sdk-dingtalk', source: 'dingtalk'})

    assert.deepEqual(filterVisibleSessionIds(state, [
        'sdk-desktop',
        'sdk-wechat',
        'sdk-feishu',
        'sdk-dingtalk',
        'sdk-empty',
        'sdk-agent',
        'sdk-scheduled',
        'sdk-workflow',
    ]), ['sdk-desktop', 'sdk-wechat', 'sdk-feishu', 'sdk-dingtalk'])
})
