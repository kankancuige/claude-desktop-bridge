export function getSessionRuntimeState(session) {
    const pendingInputs = Array.isArray(session?._pendingInputs) ? session._pendingInputs.length : 0
    const pendingMessages = Array.isArray(session?._pendingMessages) ? session._pendingMessages.length : 0
    return {
        running: Boolean(session?.query && session?.pushStream),
        generating: Boolean(session?._generating || pendingInputs || pendingMessages || session?._rebuildPromise),
        pendingInputs,
    }
}
