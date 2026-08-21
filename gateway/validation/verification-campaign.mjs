import {createHash, randomUUID} from 'node:crypto'

const STATUSES = new Set(['not_started', 'baseline_running', 'candidate_running', 'passed', 'failed', 'inconclusive', 'regression_detected', 'blocked_environment', 'cancelled'])
const EVIDENCE_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'])

function fingerprint(result = {}) {
    const value = `${result.exitCode ?? ''}|${String(result.errorCode || '')}|${String(result.stderr || result.error || '').replace(/\b\d+\b/g, '#').slice(0, 1000)}`
    return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

export function compareVerificationRuns(baseline = [], candidate = []) {
    const baselineFailures = new Set(baseline.filter(item => !item.passed).map(fingerprint))
    const candidateFailures = candidate.filter(item => !item.passed)
    const newFailures = candidateFailures.filter(item => !baselineFailures.has(fingerprint(item)))
    return {
        baselineSuccessRate: baseline.length ? baseline.filter(item => item.passed).length / baseline.length : null,
        candidateSuccessRate: candidate.length ? candidate.filter(item => item.passed).length / candidate.length : null,
        failureFingerprints: [...new Set(candidateFailures.map(fingerprint))],
        newFailures,
        regressionDetected: newFailures.length > 0,
    }
}

export function createVerificationCampaign(input = {}) {
    const rounds = Math.max(1, Math.min(1000, Math.trunc(Number(input.rounds) || 1)))
    return {
        version: 1,
        campaignId: String(input.campaignId || randomUUID()),
        taskId: String(input.taskId || ''),
        adapterId: String(input.adapterId || ''),
        scenarios: (Array.isArray(input.scenarios) ? input.scenarios : []).slice(0, 100),
        rounds,
        evidenceLevel: EVIDENCE_LEVELS.has(input.evidenceLevel) ? input.evidenceLevel : rounds > 1 ? 'L4' : 'L2',
        status: 'not_started',
        baseline: [],
        candidate: [],
        createdAt: Number(input.createdAt ?? Date.now()),
    }
}

function timeoutSignal(parentSignal, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('verification timeout')), timeoutMs)
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort, {once: true})
    return {signal: controller.signal, dispose: () => { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort) }}
}

function runStage(operation, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || Object.assign(new Error('验证已取消'), {code: 'VERIFICATION_CANCELLED'}))
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason || Object.assign(new Error('验证已取消'), {code: 'VERIFICATION_CANCELLED'}))
        signal?.addEventListener('abort', onAbort, {once: true})
        Promise.resolve().then(operation).then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort))
    })
}

function normalizeRestoredCampaign(value) {
    if (!value?.campaignId || !value?.taskId || !value?.adapterId || !Array.isArray(value.scenarios)) return null
    const campaign = structuredClone(value)
    if (['baseline_running', 'candidate_running'].includes(campaign.status)) {
        campaign.status = 'inconclusive'
        campaign.errorCode = 'VERIFICATION_INTERRUPTED'
        campaign.updatedAt = Date.now()
    }
    return campaign
}

export function createVerificationCampaignService({registry, persist = () => {}, publish = () => {}} = {}) {
    const campaigns = new Map()
    if (!registry?.get) throw new TypeError('Verification Campaign 需要 adapter registry')
    return {
        create(input) {
            const campaign = createVerificationCampaign(input)
            campaigns.set(campaign.campaignId, campaign)
            persist(structuredClone(campaign))
            return structuredClone(campaign)
        },
        get(campaignId) {
            return structuredClone(campaigns.get(campaignId) || null)
        },
        list({taskId = null} = {}) {
            return [...campaigns.values()].filter(item => !taskId || item.taskId === taskId).map(item => structuredClone(item))
        },
        restore(value) {
            const campaign = normalizeRestoredCampaign(value)
            if (!campaign) return null
            campaigns.set(campaign.campaignId, campaign)
            persist(structuredClone(campaign))
            return structuredClone(campaign)
        },
        async runVerificationCampaign(campaignId, {mode = 'candidate', signal} = {}) {
            const campaign = campaigns.get(campaignId)
            if (!campaign) throw new Error('Verification Campaign 不存在')
            const adapter = registry.get(campaign.adapterId)
            if (!adapter) throw Object.assign(new Error('验证适配器不可用'), {code: 'VERIFICATION_ADAPTER_UNAVAILABLE'})
            const key = mode === 'baseline' ? 'baseline' : 'candidate'
            campaign.status = mode === 'baseline' ? 'baseline_running' : 'candidate_running'
            campaign[key] = []
            campaign.updatedAt = Date.now()
            persist(structuredClone(campaign))
            publish({type: 'verification/started', campaignId, mode})
            const results = []
            try {
                for (let round = 1; round <= campaign.rounds; round++) {
                    for (const scenario of campaign.scenarios) {
                        if (signal?.aborted) throw Object.assign(new Error('验证已取消'), {code: 'VERIFICATION_CANCELLED'})
                        const timed = timeoutSignal(signal, adapter.timeoutMs)
                        let prepared
                        try {
                            prepared = await runStage(() => adapter.prepare(scenario, {signal: timed.signal, round}), timed.signal)
                            const raw = await runStage(() => adapter.execute({...scenario, prepared}, {signal: timed.signal, round}), timed.signal)
                            const evidence = await runStage(() => adapter.collectEvidence(raw, {signal: timed.signal, round}), timed.signal)
                            results.push({...raw, scenarioId: scenario.id || String(results.length + 1), kind: scenario.kind || adapter.type, round, passed: adapter.evaluate(raw, evidence) === true, evidence})
                            campaign[key] = structuredClone(results)
                            campaign.updatedAt = Date.now()
                            persist(structuredClone(campaign))
                        } finally {
                            timed.dispose()
                            const cleanupTimed = timeoutSignal(signal, adapter.timeoutMs)
                            await runStage(() => adapter.cleanup(prepared, {signal: cleanupTimed.signal, round}), cleanupTimed.signal)
                                .catch(error => publish({type: 'verification/cleanup-failed', campaignId, detail: error?.message || String(error)}))
                                .finally(cleanupTimed.dispose)
                        }
                    }
                }
                campaign[key] = results
                const comparison = compareVerificationRuns(campaign.baseline, campaign.candidate)
                if (mode === 'candidate' && campaign.baseline.length && comparison.regressionDetected) campaign.status = 'regression_detected'
                else campaign.status = results.length && results.every(item => item.passed) ? 'passed' : 'failed'
                campaign.comparison = comparison
            } catch (error) {
                campaign.status = signal?.aborted || error?.code === 'VERIFICATION_CANCELLED' ? 'cancelled'
                    : /ENOENT|not found|environment/i.test(String(error?.message || '')) ? 'blocked_environment' : 'inconclusive'
                campaign.errorCode = error?.code || 'VERIFICATION_FAILED'
            }
            campaign.updatedAt = Date.now()
            persist(structuredClone(campaign))
            publish({type: 'verification/completed', campaignId, status: campaign.status, evidenceLevel: campaign.evidenceLevel})
            return structuredClone(campaign)
        },
    }
}

export async function runVerificationCampaign(campaignId, dependencies, options) {
    return dependencies.service.runVerificationCampaign(campaignId, options)
}

export {STATUSES as VERIFICATION_STATUSES}
