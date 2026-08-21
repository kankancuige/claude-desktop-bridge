import {createHash, randomUUID} from 'node:crypto'
import {createFailureFingerprint, normalizeFailureMessage} from '../tasks/failure-fingerprint.mjs'

const STATUSES = new Set(['observed', 'candidate', 'confirmed', 'mitigated', 'retired'])
const SCOPES = new Set(['global', 'project', 'bridge'])
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000

function redact(value, max = 2000) {
    return normalizeFailureMessage(value).slice(0, max)
}

function occurrenceId(pitfallId, taskId) {
    return createHash('sha256').update(`${pitfallId}\0${taskId || randomUUID()}`).digest('hex').slice(0, 24)
}

function tags(input = {}) {
    return [...new Set([
        ...(Array.isArray(input.tags) ? input.tags : []),
        input.provider,
        input.scenario,
        ...(Array.isArray(input.targetFiles) ? input.targetFiles.map(file => String(file).replace(/\\/g, '/').split('/').slice(-2).join('/')) : []),
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))].slice(0, 30)
}

export function createPitfallService({stateStore, now = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS} = {}) {
    if (!stateStore?.available) throw new TypeError('Pitfall Service 需要可用 SQLite')
    return {
        recordPitfallOccurrence(input = {}) {
            const scope = SCOPES.has(input.scope) ? input.scope : 'project'
            const projectKey = scope === 'global' ? '*' : String(input.projectKey || '')
            if (!projectKey) throw new TypeError('Pitfall 缺少 projectKey')
            const fingerprint = String(input.fingerprint || createFailureFingerprint(input)).slice(0, 128)
            const existing = stateStore.getPitfall(projectKey, fingerprint, scope)
            const timestamp = now()
            const pitfall = stateStore.recordPitfall({
                id: existing?.id || `pitfall-${randomUUID()}`,
                projectKey,
                scope,
                fingerprint,
                status: existing?.status || 'observed',
                title: redact(input.title || input.errorCode || '未命名踩坑', 300),
                summary: redact(input.summary || input.message, 2000),
                rootCause: redact(input.rootCause, 2000) || null,
                prevention: redact(input.prevention, 2000) || null,
                tags: tags(input),
                observedAt: timestamp,
                expiresAt: input.expiresAt || null,
            })
            const inserted = stateStore.recordPitfallOccurrence({
                pitfallId: pitfall.id,
                occurrenceId: occurrenceId(pitfall.id, input.taskId),
                taskId: input.taskId || null,
                context: {phase: String(input.phase || '').slice(0, 80), provider: String(input.provider || '').slice(0, 120), scenario: String(input.scenario || '').slice(0, 120)},
                observedAt: timestamp,
            })
            const count = stateStore.countPitfallOccurrences(pitfall.id)
            if (inserted && count >= 2 && pitfall.status === 'observed') stateStore.updatePitfallStatus(pitfall.id, 'candidate', {now: timestamp})
            const withinCooldown = Boolean(existing && timestamp - Number(existing.lastSeenAt || 0) < cooldownMs)
            return {...stateStore.getPitfall(projectKey, fingerprint, scope), occurrenceRecorded: inserted, notify: inserted && !withinCooldown, occurrenceCount: count}
        },
        findRelevantPitfalls(context = {}) {
            const projectKey = String(context.projectKey || '')
            if (!projectKey) return []
            const wanted = new Set(tags(context))
            return stateStore.listPitfalls(projectKey, {statuses: ['candidate', 'confirmed', 'mitigated'], scopes: ['global', 'project', 'bridge'], limit: 100, now: now()})
                .map(item => ({...item, score: item.tags.reduce((score, tag) => score + (wanted.has(tag) ? 1 : 0), 0)}))
                .filter(item => item.scope === 'global' || item.scope === 'bridge' && context.bridgeTask === true || item.projectKey === projectKey)
                .filter(item => wanted.size === 0 ? item.status === 'confirmed' : item.score > 0)
                .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt)
                .slice(0, Math.max(1, Math.min(10, Number(context.limit) || 5)))
        },
        transitionPitfall(id, status, details = {}) {
            if (!STATUSES.has(status)) throw new TypeError('Pitfall 状态无效')
            return stateStore.updatePitfallStatus(id, status, {...details, now: now()})
        },
        verifyPitfallPrevention(id, evidence) {
            if (!String(evidence || '').trim()) throw new TypeError('Pitfall 缓解验证缺少证据')
            return stateStore.updatePitfallStatus(id, 'mitigated', {evidence: redact(evidence, 500), now: now()})
        },
        list(projectKey, options = {}) {
            return stateStore.listPitfalls(projectKey, options)
        },
    }
}
