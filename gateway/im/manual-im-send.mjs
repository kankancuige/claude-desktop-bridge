function normalizeDelivery(result) {
    const parts = Number(result?.parts)
    return {
        sent: result?.sent === true,
        queued: result?.queued === true,
        parts: Number.isSafeInteger(parts) && parts > 0 ? parts : 0,
        error: typeof result?.error === 'string' && result.error
            ? result.error.slice(0, 120)
            : undefined,
    }
}

export async function sendManualImText({hook, platform, userId, text, notificationId}) {
    if (!hook || typeof hook.sendToUser !== 'function') {
        return {sent: false, queued: false, parts: 0, error: 'adapter_unavailable'}
    }
    if (!userId || !text) {
        return {sent: false, queued: false, parts: 0, error: 'missing_recipient_or_text'}
    }

    try {
        return normalizeDelivery(await hook.sendToUser(
            `manual-${platform}-delivery`,
            text,
            userId,
            notificationId,
        ))
    } catch {
        return {sent: false, queued: false, parts: 0, error: 'adapter_delivery_failed'}
    }
}
