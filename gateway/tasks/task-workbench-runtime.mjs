import {normalizeAgentResult} from '../agents/agent-result.mjs'
import {createFailureFingerprint} from './failure-fingerprint.mjs'
import {classifyRcaOutcome, createRepairLoop} from './repair-loop.mjs'
import {createTaskExecutionReport} from './task-execution-report.mjs'

const PREPARED_PHASES = new Set(['prime', 'plan'])

function currentStep(snapshot) {
    return snapshot?.plan?.steps?.find(step => step.status === 'running') || null
}

function nextRevision(snapshot) {
    return Number(snapshot?.revision || 0) + 1
}

function normalizedPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function writeRequestResolved(request, changedFiles) {
    const changed = new Set((Array.isArray(changedFiles) ? changedFiles : []).map(normalizedPath).filter(Boolean))
    const requested = request?.writeRequest?.requestedFiles || []
    return requested.length > 0 && requested.every(file => changed.has(normalizedPath(file)))
}

export function createTaskWorkbenchRuntime({coordinator, pitfallService = null, persistReport = () => {}} = {}) {
    if (!coordinator?.accept || !coordinator?.transition || !coordinator?.dispatchTask) {
        throw new TypeError('Task Workbench Runtime 需要 Coordinator')
    }
    const tasks = new Map()
    const transition = (taskId, event) => coordinator.transition(taskId, event)
    const dispatch = taskId => coordinator.dispatchTask(taskId)

    const startPrimaryAgent = snapshot => {
        const step = currentStep(snapshot)
        if (!step?.agentRequired) return snapshot
        const existing = Object.values(snapshot.agents || {}).find(agent => agent.stepId === step.stepId)
        if (existing) return snapshot
        return transition(snapshot.taskId, {
            type: 'agent/started', stepId: step.stepId, agentRunId: `${snapshot.taskId}:primary`, role: step.role,
            agentType: step.agentType || step.role, name: step.agentName || step.role,
            purpose: step.purpose || `执行 ${step.role || 'Agent'} 专项任务。`, goal: snapshot.plan?.goal || '',
        })
    }

    const advancePreparedPhases = taskId => {
        let snapshot = coordinator.getTaskSnapshot(taskId)
        while (snapshot) {
            if (!currentStep(snapshot)) snapshot = dispatch(taskId)
            const step = currentStep(snapshot)
            if (!step || !PREPARED_PHASES.has(step.phase)) break
            snapshot = transition(taskId, {
                type: 'phase/completed', phase: step.phase, stepId: step.stepId, role: step.role,
                summary: step.phase === 'prime' ? '项目上下文已加载' : '执行计划已建立',
            })
        }
        if (!currentStep(snapshot)) snapshot = dispatch(taskId)
        return startPrimaryAgent(snapshot)
    }

    const generateReport = (taskId, snapshot, unresolvedRisks = []) => {
        const task = tasks.get(taskId) || {}
        const report = createTaskExecutionReport(snapshot, {
            changedFiles: task.changedFiles || [], tests: task.tests || [], retries: task.retries || [],
            regressions: task.regressions || [], pitfalls: task.pitfalls || [],
            requestedSkills: task.projectContext?.skills || [], matchedSkills: task.projectContext?.skills || [],
            unresolvedRisks,
        })
        task.report = report
        tasks.set(taskId, task)
        persistReport(report, snapshot)
        return transition(taskId, {type: 'report/generated', report, revision: nextRevision(snapshot)})
    }

    return {
        acceptTask({plan, projectContext = null, agentRoute = []} = {}) {
            let snapshot = coordinator.accept(plan)
            const pitfalls = pitfallService?.findRelevantPitfalls?.({
                projectKey: projectContext?.projectKey,
                tags: [...(projectContext?.languages || []), ...(projectContext?.frameworks || [])],
                limit: 5,
            }) || []
            tasks.set(plan.taskId, {
                projectContext, agentRoute: [...agentRoute], repairLoop: createRepairLoop(),
                agentResults: [], tests: [], changedFiles: [], retries: [], regressions: [], pitfalls, report: null,
            })
            snapshot = advancePreparedPhases(plan.taskId)
            return {snapshot, pitfalls}
        },
        restoreTask(snapshot, metadata = {}) {
            coordinator.restore(snapshot)
            tasks.set(snapshot.taskId, {
                projectContext: snapshot.plan?.projectContext || null, agentRoute: [], repairLoop: createRepairLoop(),
                agentResults: [], tests: [], changedFiles: [], retries: [], regressions: [], pitfalls: [], report: null,
                ...metadata,
            })
            return coordinator.getTaskSnapshot(snapshot.taskId)
        },
        recordPrimaryResult(taskId, rawResult = {}) {
            const snapshot = coordinator.getTaskSnapshot(taskId)
            const step = currentStep(snapshot)
            if (!snapshot || !step) return snapshot
            const result = normalizeAgentResult(rawResult, {
                taskId, stepId: step.stepId, agentRunId: `${taskId}:primary`, role: step.role,
            })
            let next = transition(taskId, {
                type: result.status === 'completed' ? 'agent/completed' : 'agent/failed',
                stepId: step.stepId, agentRunId: result.agentRunId, role: result.role,
                agentType: step.agentType || result.role, name: step.agentName || result.role,
                purpose: step.purpose || `执行 ${result.role || 'Agent'} 专项任务。`, goal: snapshot.plan?.goal || '', result,
            })
            const task = tasks.get(taskId)
            if (task) {
                task.agentResults.push(result)
                task.changedFiles.push(...result.changedFiles)
                task.tests.push(...result.tests)
                task.regressions.push(...result.regressions)
            }
            if (result.status === 'completed' && result.changedFiles.length) {
                for (const agent of Object.values(next.agents || {})) {
                    if (agent.status !== 'blocked' || !agent.writeRequest || !writeRequestResolved(agent, result.changedFiles)) continue
                    next = transition(taskId, {
                        type: 'agent/write-resolved', agentRunId: agent.agentRunId, stepId: agent.stepId,
                        role: agent.role, result: {...result, summary: '主任务已按委托完成写入'},
                    })
                }
            }
            for (const [index, finding] of result.findings.entries()) {
                next = transition(taskId, {
                    type: 'finding/recorded', findingId: `${result.agentRunId}:finding:${index + 1}`,
                    blocking: finding.blocking, summary: finding.summary,
                })
            }
            if (result.status !== 'completed') return next
            next = transition(taskId, {
                type: 'phase/completed', phase: step.phase, stepId: step.stepId, role: step.role, summary: result.summary,
            })
            if (!currentStep(next)) next = dispatch(taskId)
            return next
        },
        recordAgentEvent(taskId, event = {}) {
            let snapshot = transition(taskId, event)
            const result = event.result
            const task = tasks.get(taskId)
            if (result && task) {
                task.agentResults.push(result)
                task.changedFiles.push(...(result.changedFiles || []))
                task.tests.push(...(result.tests || []))
                task.regressions.push(...(result.regressions || []))
                for (const [index, finding] of (result.findings || []).entries()) snapshot = transition(taskId, {
                    type: 'finding/recorded', findingId: `${event.agentRunId}:finding:${index + 1}`,
                    blocking: finding.blocking, summary: finding.summary,
                })
            }
            return snapshot
        },
        recordVerification(taskId, verification = {}) {
            let snapshot = transition(taskId, {type: 'verification/result', ...verification})
            const task = tasks.get(taskId)
            if (task && Array.isArray(verification.tests)) task.tests.push(...verification.tests)
            const step = currentStep(snapshot)
            if (verification.status === 'passed' && step?.phase === 'validate') {
                snapshot = transition(taskId, {
                    type: 'phase/completed', phase: step.phase, stepId: step.stepId, role: step.role,
                    summary: verification.summary || '验证通过',
                })
                snapshot = dispatch(taskId)
            } else if (verification.status === 'blocked_environment') {
                snapshot = transition(taskId, {type: 'task/blocked', code: 'blocked_environment', detail: verification.summary || '验证环境阻塞'})
            } else if (verification.status === 'regression_detected') {
                snapshot = transition(taskId, {type: 'task/status', status: 'regression_detected'})
            } else if (['inconclusive', 'failed', 'cancelled'].includes(verification.status)) {
                snapshot = transition(taskId, {type: 'task/status', status: 'inconclusive'})
            }
            return snapshot
        },
        recordReviewResult(taskId, outcome = {}) {
            let snapshot = coordinator.getTaskSnapshot(taskId)
            const step = currentStep(snapshot)
            if (!step || step.phase !== 'review') return snapshot
            for (const [index, finding] of (outcome.findings || outcome.blockingFindings || []).entries()) snapshot = transition(taskId, {
                type: 'finding/recorded', findingId: `${taskId}:review:${index + 1}`,
                blocking: finding.blocking !== false, summary: finding.summary || finding.title || finding.description || '审查发现',
            })
            if (outcome.passed !== true) return snapshot
            for (const finding of snapshot.findings || []) {
                if (finding.blocking === true && finding.resolved !== true) snapshot = transition(taskId, {
                    type: 'finding/resolved', findingId: finding.id,
                })
            }
            snapshot = transition(taskId, {
                type: 'phase/completed', phase: step.phase, stepId: step.stepId, role: step.role,
                summary: outcome.summary || '最终审查通过',
            })
            return dispatch(taskId)
        },
        recordFailure(taskId, input = {}) {
            const task = tasks.get(taskId)
            if (!task) return {repair: {action: 'stop', status: 'diagnosis_required', reason: 'task_not_found'}, pitfall: null}
            const projectKey = task.projectContext?.projectKey || ''
            const fingerprint = input.fingerprint || createFailureFingerprint({...input, projectKey})
            const repair = task.repairLoop.recordFailure({...input, fingerprint})
            task.retries.push({fingerprint, strategy: input.strategy || '', ...repair})
            if (input.regression) task.regressions.push(fingerprint)
            const pitfall = pitfallService?.recordPitfallOccurrence?.({...input, projectKey, taskId, fingerprint}) || null
            if (repair.status !== 'running' && repair.action !== 'rca') transition(taskId, {type: 'task/status', status: repair.status})
            return {fingerprint, repair, pitfall}
        },
        recordRcaResult(taskId, result = {}) {
            const task = tasks.get(taskId)
            if (!task) return {action: 'stop', status: 'diagnosis_required', result: null}
            const normalized = {
                newRootCause: result.newRootCause === true,
                newStrategy: result.newStrategy === true,
                reproducible: result.reproducible !== false,
                externalBlocker: result.externalBlocker === true,
                architectureBoundary: result.architectureBoundary === true,
                summary: String(result.summary || '').slice(0, 4000),
                causalChain: result.causalChain && typeof result.causalChain === 'object' ? result.causalChain : {},
                nextStrategy: String(result.nextStrategy || '').slice(0, 2000),
            }
            task.rca = normalized
            const retry = normalized.newRootCause && normalized.newStrategy
            const status = retry ? 'reviewing' : classifyRcaOutcome(normalized)
            const snapshot = transition(taskId, {type: 'rca/completed', status, result: normalized})
            return {action: retry ? 'retry' : 'stop', status, result: normalized, snapshot}
        },
        recordTaskEvent(taskId, event = {}) {
            return transition(taskId, event)
        },
        requestCompletion(taskId, {notificationIntentPersisted = false, unresolvedRisks = []} = {}) {
            let snapshot = coordinator.getTaskSnapshot(taskId)
            const step = currentStep(snapshot)
            if (step?.phase === 'report') snapshot = transition(taskId, {
                type: 'phase/completed', phase: step.phase, stepId: step.stepId, role: step.role,
                summary: '执行报告已生成',
            })
            snapshot = transition(taskId, {type: 'notification/intent-persisted', persisted: notificationIntentPersisted})
            snapshot = transition(taskId, {type: 'task/complete-requested'})
            return generateReport(taskId, snapshot, unresolvedRisks)
        },
        finalizeReport(taskId, {unresolvedRisks = []} = {}) {
            const snapshot = coordinator.getTaskSnapshot(taskId)
            if (!snapshot) return null
            return generateReport(taskId, snapshot, unresolvedRisks)
        },
        getExecutionReport(taskId) {
            return tasks.get(taskId)?.report || null
        },
        getPitfallReminders(taskId) {
            return [...(tasks.get(taskId)?.pitfalls || [])]
        },
        getTaskSnapshot(taskId) {
            return coordinator.getTaskSnapshot(taskId)
        },
    }
}
