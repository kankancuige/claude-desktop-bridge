/**
 * WebSocket Session 生命周期运行时。
 * Upgrade 认证由 websocket-gateway 负责；本模块只拥有连接绑定、快照、消息分派、心跳和清理。
 */
export function createWebSocketSessionRuntime(deps = {}) {
    const {
        wss, controlClients, sessions, IM_SOURCES, safeDecodeURIComponent,
        adapterOwnsSession, getFocusedSessionId, setFocusedSessionId,
        getSessionRuntimeState, taskStateForSessionClient, getTaskLifecycleSnapshot,
        userPreferences, getSessionWorkflowState, taskCommands, VALID_PERMISSION_MODES,
        updateTaskState, persistSessionCatalogSettings, settlePending, decisionToResult,
        broadcastDesktop, log,
    } = deps
    if (!wss || !controlClients || !sessions || !IM_SOURCES) throw new TypeError('websocket session dependencies are required')

    wss.on('connection', (ws, req) => {
    const wsAuth = req.bridgeWsAuth
    if (!wsAuth) {
        ws.close(4003, JSON.stringify({error: 'forbidden: missing or invalid bridge token'}))
        return
    }
    const urlStr = req.url || '';
    const qi = urlStr.indexOf('?')
    const pathPart = qi >= 0 ? urlStr.slice(0, qi) : urlStr;
    const qPart = qi >= 0 ? urlStr.slice(qi + 1) : ''
    const sessionId = pathPart.split('/').pop()
    const params = {};
    for (const p of qPart.split('&')) {
        const [k, v] = p.split('=');
        if (k) params[safeDecodeURIComponent(k)] = safeDecodeURIComponent(v || '')
    }
    if (wsAuth.kind === 'adapter' && params.source !== wsAuth.platform) {
        ws.close(4003, JSON.stringify({error: 'adapter source mismatch'}))
        return
    }
    // 控制通道：不绑定 session，桌面端启动即连，用于接收 nudge 事件
    if (pathPart === '/ws/control' || pathPart === '/ws/control/') {
        if (wsAuth.kind !== 'desktop') {
            ws.close(4003, JSON.stringify({error: 'adapter control channel not allowed'}))
            return
        }
        ws._source = 'desktop'
        controlClients.add(ws)
        ws._lastPong = Date.now()
        ws.on('pong', () => { ws._lastPong = Date.now() })
        ws.send(JSON.stringify({type: 'control_connected'}))
        ws.on('close', () => { controlClients.delete(ws) })
        return
    }
    if (!sessionId || !sessions.has(sessionId)) {
        ws.close(4000, JSON.stringify({error: 'unknown session'}));
        return
    }
    const source = params.source || 'desktop'
    if (IM_SOURCES.has(source)) {
        const userId = req.headers['x-bridge-user-id']
        if (wsAuth.kind !== 'adapter' || typeof userId !== 'string' || !adapterOwnsSession(source, userId, sessionId)) {
            ws.close(4003, JSON.stringify({error: 'session ownership mismatch'}))
            return
        }
        ws._adapterUserId = userId
    }
    const s = sessions.get(sessionId);
    s.clients.add(ws)
    ws._source = source
    if (params.source === 'desktop') setFocusedSessionId(sessionId)
    ws.send(JSON.stringify({
        type: 'connected',
        sessionId,
        mirrorEnabled: IM_SOURCES.has(source) ? !!s.mirrors?.[source] : false,
        mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false},
    }))
    if (params.source === 'desktop') {
        ws.send(JSON.stringify({type: 'session_state_snapshot', ...getSessionRuntimeState(s), taskState: taskStateForSessionClient(s)}))
        const lifecycleSnapshot = getTaskLifecycleSnapshot(sessionId, s)
        if (lifecycleSnapshot) ws.send(JSON.stringify({type: 'session_lifecycle_snapshot', ...lifecycleSnapshot}))
        for (const suggestion of userPreferences.pending(s.workDir)) {
            ws.send(JSON.stringify({type: 'preference_suggestion', suggestion}))
        }
    }
    // 切换 tab 重连时发送当前 workflow/agent 运行态快照，供前端恢复 agent 面板
    if (params.source === 'desktop') {
        try {
            const wfState = getSessionWorkflowState(sessionId)
            if (wfState) {
                ws.send(JSON.stringify({type: 'workflow_state_snapshot', ...wfState}))
            }
        } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '发送工作流状态快照失败')
        }
    }
    log.info({
        sessionId: sessionId?.slice(0, 8),
        source: params.source || 'desktop',
        clients: s.clients.size
    }, 'WS 已连接')

    ws.on('message', (raw) => {
        void (async () => {
        let msg;
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            return
        }
        if (msg.type === 'stop_generation') {
            await taskCommands.cancelTask(sessionId, {source: ws._source, userId: ws._adapterUserId || null})
            return
        }
        if (msg.type === 'preference_response') {
            if (IM_SOURCES.has(ws._source)) return
            try {
                const result = userPreferences.respond({
                    projectDir: s.workDir,
                    suggestionId: msg.suggestionId,
                    action: msg.action,
                })
                broadcastDesktop(sessionId, {type: 'preference_suggestion_resolved', ...result})
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'preference_error',
                    suggestionId: msg.suggestionId,
                    code: error.code || 'PREFERENCE_RESPONSE_FAILED',
                    message: '偏好保存失败，请稍后重试',
                }))
            }
            return
        }
        // 即时权限切换: 更新 session 并自动通过所有 pending 权限请求
        if (msg.type === 'setting_change') {
            if (IM_SOURCES.has(ws._source)) return
            const newPerm = msg.permissionMode
            if (!VALID_PERMISSION_MODES.has(newPerm)) {
                ws.send(JSON.stringify({type: 'setting_rejected', code: 'invalid_permission_mode'}))
                return
            }
            if (newPerm && newPerm !== s.permissionMode) {
                s.permissionMode = newPerm
                updateTaskState(s, sessionId, {...(s.taskState || {}), permissionMode: newPerm})
                persistSessionCatalogSettings(s, sessionId, {permissionMode: newPerm})
                log.info({sessionId: sessionId?.slice(0,8), permissionMode: newPerm}, 'permissionMode 变更 (即时)')
                if (newPerm === 'bypassPermissions' && s.pending) {
                    for (const [rid, entry] of s.pending) {
                        if (entry.type === 'permission') {
                            settlePending(sessionId, rid, {behavior: 'allow', updatedInput: entry.input}, 'auto')
                        }
                    }
                }
            }
            return
        }
        // 桌面端权限/方案选择响应
        if (msg.type === 'permission_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, msg.decision), 'desktop')
            return
        }
        if (msg.type === 'choice_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, null, msg.optionIndex, msg.questionIndex, msg.customText), 'desktop')
            return
        }
        if (msg.type === 'user_message') {
            const result = await taskCommands.submitTask({
                sessionId,
                source: ws._source,
                userId: ws._adapterUserId || null,
                messageId: msg.messageId,
                content: msg.content,
                taskText: msg.taskText,
                permissionMode: msg.permissionMode,
                thinkingLevel: msg.thinkingLevel,
                modelMode: msg.modelMode,
                model: msg.model,
                modelMeta: msg.modelMeta,
                contextSwitchMode: msg.contextSwitchMode,
                hasAttachments: msg.hasAttachments,
                noWorkflow: msg._noWorkflow,
            })
            if (ws.readyState === 1) ws.send(JSON.stringify(result))
        }
        })().catch(error => {
            log.error({err: error, sessionId: sessionId?.slice(0, 8), source: ws._source}, 'WebSocket 消息处理异常')
            if (ws.readyState === 1) {
                try {
                    ws.send(JSON.stringify({type: 'error', code: 'message_handler_failed', message: '消息处理失败，请稍后重试'}))
                } catch (sendError) {
                    log.debug({err: sendError, sessionId: sessionId?.slice(0, 8)}, 'WebSocket 错误响应发送失败')
                }
            }
        })
    })

    // 注册 pong 处理器更新心跳时间戳（仅 session 连接）
    ws._lastPong = Date.now()
    ws.on('pong', () => { ws._lastPong = Date.now() })

    ws.on('close', () => {
        s.clients.delete(ws);
        if (s.clients.size === 0 && getFocusedSessionId() === sessionId) setFocusedSessionId(null)
    })
    })
    return {controlClients}
}
