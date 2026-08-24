import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAgentDispatcher} from '../agents/agent-dispatcher.mjs'
import {createAgentRegistry} from '../agents/agent-registry.mjs'
import {createPitfallService} from '../context/pitfall-service.mjs'
import {createImProgressPolicy} from '../im/im-progress-policy.mjs'
import {buildProjectContext} from '../projects/project-context.mjs'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {mapVerificationToCoordinator} from '../tasks/coordinator-compatibility.mjs'
import {createRepairLoop} from '../tasks/repair-loop.mjs'
import {createTaskCoordinator} from '../tasks/task-coordinator.mjs'
import {decideTask} from '../tasks/task-decision.mjs'
import {createTaskExecutionReport} from '../tasks/task-execution-report.mjs'
import {resolveTaskPhases} from '../tasks/task-phase.mjs'
import {createTaskPlan} from '../tasks/task-plan.mjs'
import {createCommandVerificationAdapter} from '../validation/command-adapter.mjs'
import {createVerificationAdapterRegistry} from '../validation/verification-adapter.mjs'
import {createVerificationCampaignService} from '../validation/verification-campaign.mjs'

function applyEvents(coordinator, taskId, events) {
    let snapshot = coordinator.getTaskSnapshot(taskId)
    for (const event of events) snapshot = coordinator.transition(taskId, event)
    return snapshot
}

function finishSteps(coordinator, taskId, phases) {
    let snapshot = coordinator.getTaskSnapshot(taskId)
    for (const phase of phases) {
        const step = snapshot.plan.steps.find(item => item.phase === phase && item.status === 'pending')
        if (!step) continue
        snapshot = coordinator.transition(taskId, {type: 'phase/started', phase, stepId: step.stepId, role: step.role})
        snapshot = coordinator.transition(taskId, {type: 'phase/completed', phase, stepId: step.stepId, role: step.role})
    }
    return snapshot
}

async function run() {
    const root = mkdtempSync(join(tmpdir(), 'bridge-workbench-smoke-'))
    const projectDir = join(root, 'target-project')
    const bridgeHome = join(root, 'bridge-home')
    const {store: stateStore} = createPostgresStateFixture()
    try {
        writeFileSync(join(root, '.keep'), '', 'utf8')
        mkdirSync(projectDir, {recursive: true})
        writeFileSync(join(projectDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8')
        writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
            name: 'workbench-smoke-target', private: true, type: 'module',
            scripts: {test: 'node --test sample.test.mjs'},
        }, null, 2) + '\n', 'utf8')
        writeFileSync(join(projectDir, 'value.mjs'), 'export const value = 2\n', 'utf8')
        writeFileSync(join(projectDir, 'sample.test.mjs'), [
            "import assert from 'node:assert/strict'",
            "import test from 'node:test'",
            "import {value} from './value.mjs'",
            "test('temporary target', () => assert.equal(value, 2))",
            '',
        ].join('\n'), 'utf8')

        const lightDecision = decideTask({text: '你好'})
        const lightPhases = resolveTaskPhases(lightDecision)
        assert.equal(lightPhases.complexity, 'light')
        assert.equal(lightPhases.requiresProjectContext, false)
        assert.equal(lightPhases.maxAgents, 0)

        const projectContext = await buildProjectContext(projectDir, {bridgeHome})
        const focusedDecision = decideTask({text: '只读查找这个项目的目录结构'})
        const focusedPhases = resolveTaskPhases(focusedDecision)
        assert.equal(focusedPhases.complexity, 'focused')
        assert.deepEqual(focusedPhases.phases, ['prime', 'report'])
        assert.equal(projectContext.languages.includes('JavaScript'), true)
        const testCommand = projectContext.commands.find(item => item.name === 'test')
        assert.ok(testCommand, '临时目标项目必须生成受信测试命令')

        const events = []
        const coordinator = createTaskCoordinator({
            persist: (snapshot, event) => stateStore.recordTaskTransition({
                projectKey: projectContext.projectKey,
                taskKey: `${snapshot.taskId}:coordinator`,
                sessionId: snapshot.sessionId,
                taskId: snapshot.taskId,
                status: snapshot.status,
                phase: snapshot.phase || snapshot.status,
                sequence: snapshot.sequence,
                revision: snapshot.revision,
                startedAt: snapshot.startedAt,
                completedAt: snapshot.completedAt,
                updatedAt: snapshot.updatedAt,
                state: snapshot,
                eventType: event.type,
            }),
            publish: (snapshot, event) => events.push({
                type: 'task_coordinator_event', taskId: snapshot.taskId, status: snapshot.status,
                phase: snapshot.phase, event: event.type, stepId: event.stepId || null,
                timestamp: snapshot.updatedAt, startedAt: snapshot.startedAt,
            }),
        })

        const balancedDecision = decideTask({text: '实现一个局部函数'})
        const balancedPhases = resolveTaskPhases(balancedDecision)
        assert.equal(balancedPhases.complexity, 'balanced')
        assert.equal(balancedPhases.phases.includes('review'), false)
        const balancedPlan = createTaskPlan({
            taskId: 'smoke-balanced', turnId: 'turn-balanced', sessionId: 'session-smoke',
            source: 'desktop', goal: '局部修改并验证', workDir: projectDir,
            decision: balancedDecision, projectContext, phases: balancedPhases.phases,
            acceptanceCriteria: ['临时目标项目测试通过'],
        })
        coordinator.accept(balancedPlan)
        await coordinator.dispatchTask(balancedPlan.taskId)
        const registry = createAgentRegistry()
        const routed = registry.resolveAgents(projectContext, balancedDecision)
        assert.deepEqual(routed.map(item => item.role), ['developer', 'test-engineer'])
        const dispatcher = createAgentDispatcher({
            registry,
            publish: event => coordinator.transition(event.taskId, event),
            execute: async input => ({
                status: 'completed', taskId: input.taskId, stepId: input.stepId,
                changedFiles: input.definition.writable && input.definition.role === 'developer' ? ['value.mjs'] : [],
                summary: `${input.definition.role} 已返回结构化结果`, tests: [],
            }),
        })
        const implementStep = balancedPlan.steps.find(item => item.phase === 'implement')
        await dispatcher.dispatchAgent({
            agentId: 'developer', taskId: balancedPlan.taskId, stepId: implementStep.stepId,
            role: 'developer', goal: balancedPlan.goal, workDir: projectDir,
            targetFiles: ['value.mjs'], modelTier: 'balanced', permissionMode: 'acceptEdits',
            acceptanceCriteria: implementStep.acceptanceCriteria,
        })
        coordinator.transition(balancedPlan.taskId, {type: 'phase/completed', phase: 'implement', stepId: implementStep.stepId, role: 'developer'})

        const adapterRegistry = createVerificationAdapterRegistry([
            createCommandVerificationAdapter({commands: [testCommand], timeoutMs: 30_000}),
        ])
        const campaignService = createVerificationCampaignService({registry: adapterRegistry})
        const campaign = campaignService.create({
            taskId: balancedPlan.taskId, adapterId: 'project-command', evidenceLevel: 'L2',
            scenarios: [{id: 'target-test', command: testCommand, workDir: projectDir}], rounds: 1,
        })
        const verification = await campaignService.runVerificationCampaign(campaign.campaignId)
        assert.equal(verification.status, 'passed', JSON.stringify(verification))
        let balancedSnapshot = coordinator.getTaskSnapshot(balancedPlan.taskId)
        balancedSnapshot = applyEvents(coordinator, balancedPlan.taskId, mapVerificationToCoordinator(balancedSnapshot, {
            status: verification.status, evidenceLevel: verification.evidenceLevel,
            testsExecuted: verification.candidate.length > 0, summary: '临时目标项目测试通过',
        }))
        balancedSnapshot = coordinator.transition(balancedPlan.taskId, {type: 'notification/intent-persisted', persisted: true})
        balancedSnapshot = coordinator.transition(balancedPlan.taskId, {type: 'task/complete-requested'})
        assert.equal(balancedSnapshot.status, 'completed')

        const powerDecision = decideTask({text: '跨模块重构会话持久化，并处理并发、超时和重试'})
        const powerPhases = resolveTaskPhases(powerDecision)
        assert.equal(powerPhases.complexity, 'power')
        assert.deepEqual(powerPhases.phases, ['prime', 'plan', 'implement', 'validate', 'review', 'report'])
        assert.ok(registry.resolveAgents(projectContext, powerDecision).length >= 3)
        const powerPlan = createTaskPlan({
            taskId: 'smoke-power', turnId: 'turn-power', sessionId: 'session-smoke',
            source: 'desktop', goal: '验证 Power 编排', workDir: projectDir,
            decision: powerDecision, projectContext, phases: powerPhases.phases, reviewRequired: true,
        })
        coordinator.accept(powerPlan)
        let powerSnapshot = coordinator.getTaskSnapshot(powerPlan.taskId)
        for (const [phase, agentId, permissionMode] of [
            ['prime', 'explorer', 'plan'], ['plan', 'planner', 'plan'], ['implement', 'developer', 'acceptEdits'],
        ]) {
            powerSnapshot = coordinator.dispatchTask(powerPlan.taskId)
            const step = powerSnapshot.plan.steps.find(item => item.phase === phase)
            await dispatcher.dispatchAgent({
                agentId, taskId: powerPlan.taskId, stepId: step.stepId, role: agentId,
                goal: `${phase} 阶段`, workDir: projectDir,
                targetFiles: agentId === 'developer' ? ['value.mjs'] : [],
                modelTier: 'power', permissionMode, acceptanceCriteria: step.acceptanceCriteria,
            })
            powerSnapshot = coordinator.transition(powerPlan.taskId, {type: 'phase/completed', phase, stepId: step.stepId, role: agentId})
        }
        powerSnapshot = coordinator.dispatchTask(powerPlan.taskId)
        const powerCampaign = campaignService.create({
            taskId: powerPlan.taskId, adapterId: 'project-command', evidenceLevel: 'L2',
            scenarios: [{id: 'power-target-test', kind: 'test', command: testCommand, workDir: projectDir}], rounds: 1,
        })
        const powerVerification = await campaignService.runVerificationCampaign(powerCampaign.campaignId)
        powerSnapshot = applyEvents(coordinator, powerPlan.taskId, mapVerificationToCoordinator(powerSnapshot, {
            status: powerVerification.status, evidenceLevel: powerVerification.evidenceLevel,
            testsExecuted: true, summary: 'Power 临时目标测试通过',
        }))
        const reviewStep = powerSnapshot.plan.steps.find(item => item.phase === 'review')
        await dispatcher.dispatchAgent({
            agentId: 'reviewer', taskId: powerPlan.taskId, stepId: reviewStep.stepId, role: 'reviewer',
            goal: '定向审查', workDir: projectDir, targetFiles: [], modelTier: 'power', permissionMode: 'plan',
            acceptanceCriteria: reviewStep.acceptanceCriteria,
        })
        powerSnapshot = coordinator.transition(powerPlan.taskId, {type: 'phase/completed', phase: 'review', stepId: reviewStep.stepId, role: 'reviewer'})
        powerSnapshot = coordinator.dispatchTask(powerPlan.taskId)
        const reportStep = powerSnapshot.plan.steps.find(item => item.phase === 'report')
        powerSnapshot = coordinator.transition(powerPlan.taskId, {type: 'phase/completed', phase: 'report', stepId: reportStep.stepId, role: reportStep.role})
        powerSnapshot = coordinator.transition(powerPlan.taskId, {type: 'notification/intent-persisted', persisted: true})
        powerSnapshot = coordinator.transition(powerPlan.taskId, {type: 'task/complete-requested'})
        assert.equal(powerSnapshot.status, 'completed')

        const repair = createRepairLoop()
        assert.equal(repair.recordFailure({fingerprint: 'same-failure', strategy: 'first-fix'}).action, 'retry')
        assert.equal(repair.recordFailure({fingerprint: 'same-failure', strategy: 'first-fix'}).status, 'diagnosis_required')

        const pitfalls = createPitfallService({stateStore, cooldownMs: 0})
        const firstPitfall = pitfalls.recordPitfallOccurrence({projectKey: projectContext.projectKey, taskId: 'p1', fingerprint: 'smoke-pitfall', title: 'Smoke failure', tags: ['node']})
        pitfalls.recordPitfallOccurrence({projectKey: projectContext.projectKey, taskId: 'p2', fingerprint: 'smoke-pitfall', title: 'Smoke failure', tags: ['node']})
        assert.equal(firstPitfall.status, 'observed')
        assert.equal(pitfalls.findRelevantPitfalls({projectKey: projectContext.projectKey, tags: ['node']})[0].status, 'candidate')

        const progressPolicy = createImProgressPolicy({longTaskThresholdMs: 0, cooldownMs: 0, maxMessages: 4})
        const phaseEvent = events.find(item => item.taskId === balancedPlan.taskId && item.event === 'phase/started')
        assert.ok(phaseEvent?.stepId, '桌面过程事件必须包含独立 stepId')
        assert.equal(progressPolicy.evaluate(phaseEvent, phaseEvent.timestamp + 1).send, true)
        const terminalEvent = events.findLast(item => item.taskId === balancedPlan.taskId && item.status === 'completed')
        assert.equal(progressPolicy.evaluate(terminalEvent).terminal, true)
        assert.equal(progressPolicy.evaluate(terminalEvent).reason, 'terminal_duplicate')

        const report = createTaskExecutionReport(balancedSnapshot, {
            changedFiles: ['value.mjs'], tests: [{name: 'npm test', status: 'passed', executed: true, evidence: 'exitCode=0'}],
        })
        assert.equal(report.verification.evidenceLevel, 'L2')
        assert.equal(stateStore.getCoordinatorTaskState(projectContext.projectKey, balancedPlan.taskId).status, 'completed')

        // 此 smoke 只覆盖进程内编排和临时目标项目；外部 Provider、桌面和 IM 必须由受控人工验收另行证明。
        const acceptance = {
            lifecycle: {active: false},
            task: {status: 'succeeded'},
            evidence: {level: 'L2'},
            external: {
                provider: 'not_verified',
                desktop: 'not_verified',
                im: 'not_verified',
                representativeProject: 'not_verified',
            },
        }
        assert.equal(acceptance.lifecycle.active, false)
        assert.equal(acceptance.task.status, 'succeeded')
        assert.equal(acceptance.evidence.level, 'L2')

        process.stdout.write(`${JSON.stringify({
            ok: true,
            acceptance,
            evidence: {
                light: 'no_project_scan_or_agent', focused: 'bounded_project_context',
                balanced: 'developer_and_host_test', power: 'full_phase_multi_agent_projection',
                verification: verification.evidenceLevel, repair: 'duplicate_strategy_to_rca',
                pitfall: 'candidate_after_distinct_tasks', desktopEvents: events.length,
                imFinal: 'outbox_owned_and_deduplicated', persistence: 'postgres_coordinator_projection',
            },
        }, null, 2)}\n`)
    } finally {
        await stateStore.close()
        rmSync(root, {recursive: true, force: true})
    }
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
