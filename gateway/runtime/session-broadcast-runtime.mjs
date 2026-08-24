/** Session/WebSocket 广播端口。 */
export function createSessionBroadcastRuntime({
    sessions,
    getTaskCommands,
    reportImProgressEvent,
    shouldDeliverTurnEvent,
    logger = {debug() {}},
} = {}) {
    if (!sessions || typeof getTaskCommands !== 'function' || typeof reportImProgressEvent !== 'function' || typeof shouldDeliverTurnEvent !== 'function') {
        throw new TypeError('session broadcast dependencies are required')
    }

    function broadcast(sessionId, message) {
        const session = sessions.get(sessionId)
        if (!session) return
        let raw
        try { raw = JSON.stringify(message) } catch (error) {
            logger.debug({err: error, sessionId: sessionId?.slice(0, 8), messageType: message?.type}, '序列化广播消息失败')
            return
        }
        for (const ws of [...session.clients]) {
            if (ws.readyState !== 1) continue
            try { ws.send(raw) } catch (error) {
                session.clients.delete(ws)
                logger.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '广播消息发送失败，已移除失效连接')
            }
        }
    }

    function broadcastTurn(sessionId, message, identity = null) {
        const session = sessions.get(sessionId)
        if (!session) return
        getTaskCommands()?.publish?.(sessionId, message, identity)
        reportImProgressEvent(sessionId, message, identity)
        let raw
        try { raw = JSON.stringify(message) } catch (error) {
            logger.debug({err: error, sessionId: sessionId?.slice(0, 8), messageType: message?.type}, '序列化回合消息失败')
            return
        }
        for (const ws of [...session.clients]) {
            if (ws.readyState !== 1 || !shouldDeliverTurnEvent(ws._source, ws._adapterUserId, identity)) continue
            try { ws.send(raw) } catch (error) { logger.debug({err: error, sessionId: sessionId?.slice(0, 8), source: ws._source}, '回合消息发送失败') }
        }
    }

    function broadcastDesktop(sessionId, message) {
        broadcastTurn(sessionId, message, null)
    }

    return {broadcast, broadcastTurn, broadcastDesktop}
}
