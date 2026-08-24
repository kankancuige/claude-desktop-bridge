function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'TRANSCRIPT_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

function sourceKey(value) {
    const sessionId = required(value, 'sessionId')
    return sessionId.startsWith('session/') ? sessionId : `session/${sessionId}`
}

export class TranscriptRepository {
    constructor({contentStore} = {}) {
        if (!contentStore?.get || !contentStore?.put) throw new TypeError('Transcript content store is required')
        this.contentStore = contentStore
    }

    async get({projectKey, sessionId} = {}) {
        const project = required(projectKey, 'projectKey')
        const normalized = sourceKey(sessionId)
        const current = await this.contentStore.get({projectKey: project, kind: 'transcript', sourceKey: normalized})
        if (current) return current
        // 兼容迁移前直接使用 SDK session ID 的旧记录，后续保存统一写入带命名空间的 key。
        const legacy = required(sessionId, 'sessionId')
        return legacy === normalized ? null : this.contentStore.get({projectKey: project, kind: 'transcript', sourceKey: legacy})
    }

    async save({projectKey, sessionId, body, bodyHash, metadata = {}, updatedAt = Date.now()} = {}) {
        return this.contentStore.put({projectKey: required(projectKey, 'projectKey'), kind: 'transcript', sourceKey: sourceKey(sessionId), body: String(body || ''), bodyHash, metadata, updatedAt})
    }
}

export function createTranscriptRepository(options = {}) { return new TranscriptRepository(options) }
