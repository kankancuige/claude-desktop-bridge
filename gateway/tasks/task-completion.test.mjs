import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {
    createTaskCompletionState,
    normalizeReviewOutcome,
    resolveFinalReviewPlan,
    transitionTaskCompletion,
} from './task-completion.mjs'

test('低风险或无真实差异时跳过 Agent 最终审查', () => {
    assert.deepEqual(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'low', finalReview: 'none'},
        checkpoint: {files: [{path: 'README.md', added: 1, removed: 0}]},
    }), {required: false, tier: 'none', mode: 'none', riskDomains: []})
    assert.equal(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'high', finalReview: 'power'},
        checkpoint: null,
    }).required, false)
    assert.equal(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'balanced'},
        checkpoint: {files: [{path: 'docs/readme.md', added: 12, removed: 2}]},
    }).required, false)
    assert.equal(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'none', hardTriggers: []},
        checkpoint: {files: [{path: 'desktop-ui/src/components/SmallButton.vue', added: 12, removed: 4}]},
    }).required, false)
})

test('普通实现即使差异较多也不追加独立审查，关键路径风险仍可升级门禁', () => {
    assert.deepEqual(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'none', hardTriggers: []},
        checkpoint: {files: [{path: 'desktop-ui/src/WorkspaceView.vue', added: 120, removed: 40}]},
    }), {required: false, tier: 'none', mode: 'none', riskDomains: []})

    const criticalPath = resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'high', finalReview: 'power', hardTriggers: ['critical_code_path']},
        checkpoint: {files: [{path: 'gateway/index.mjs', added: 5, removed: 2}]},
    })
    assert.equal(criticalPath.required, true)
    assert.equal(criticalPath.tier, 'power')

    const discoveredCriticalPath = resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'none', hardTriggers: []},
        checkpoint: {files: [{path: 'gateway/index.mjs', added: 5, removed: 2}]},
    })
    assert.equal(discoveredCriticalPath.required, true)
    assert.equal(discoveredCriticalPath.tier, 'power')
})

test('Power 复杂代码任务只要存在真实差异就执行定向审查', () => {
    const plan = resolveFinalReviewPlan({
        decision: {
            action: 'refactor', complexity: 'power', risk: 'medium',
            finalReview: 'power', hardTriggers: [],
        },
        checkpoint: {files: [{path: 'src/state-machine.mjs', added: 18, removed: 12}]},
    })
    assert.equal(plan.required, true)
    assert.equal(plan.tier, 'power')
    assert.equal(plan.mode, 'gate')
})

test('中风险只做一次 Balanced 定向审查，高风险才做 Power 门禁', () => {
    assert.deepEqual(resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'balanced'},
        checkpoint: {files: [{path: 'desktop-ui/src/a.ts', added: 35, removed: 8}]},
    }), {required: true, tier: 'balanced', mode: 'focused', riskDomains: ['correctness']})

    const high = resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'high', finalReview: 'power', hardTriggers: ['concurrency_or_lifecycle', 'im_delivery']},
        checkpoint: {files: [{path: 'gateway/index.mjs', added: 20, removed: 3}]},
    })
    assert.equal(high.required, true)
    assert.equal(high.tier, 'power')
    assert.equal(high.mode, 'gate')
    assert.deepEqual(high.riskDomains, ['correctness', 'concurrency', 'delivery'])

    const criticalDiff = resolveFinalReviewPlan({
        decision: {action: 'implement', risk: 'medium', finalReview: 'balanced', hardTriggers: []},
        checkpoint: {files: [{path: 'gateway/index.mjs', added: 4, removed: 2}]},
    })
    assert.equal(criticalDiff.tier, 'power')
    assert.equal(criticalDiff.mode, 'gate')
})

test('审查结果把 critical/high 和显式 blocking 视为阻断', () => {
    const outcome = normalizeReviewOutcome({
        findings: [
            {severity: 'high', title: '竞态', file: 'gateway/index.mjs'},
            {severity: 'medium', title: '提示可优化', file: 'desktop-ui/src/a.ts'},
            {severity: 'low', blocking: true, title: '项目规则要求阻断', file: 'a.mjs'},
        ],
        summary: '审查完成',
    }, {tier: 'power'})
    assert.equal(outcome.passed, false)
    assert.equal(outcome.blockingFindings.length, 2)
    assert.equal(outcome.advisoryFindings.length, 1)
})

test('定向审查只接受本次变更文件上的发现', () => {
    const outcome = normalizeReviewOutcome({
        passed: false,
        findings: [
            {severity: 'high', title: '变更代码问题', file: 'src/changed.mjs'},
            {severity: 'critical', title: '无关模块问题', file: 'src/unrelated.mjs'},
        ],
        summary: '发现两个问题',
    }, {tier: 'power'}, {
        files: [{path: 'src/changed.mjs'}],
    })
    assert.equal(outcome.passed, false)
    assert.equal(outcome.blockingFindings.length, 1)
    assert.equal(outcome.blockingFindings[0].file, 'src/changed.mjs')
    assert.equal(outcome.discardedOutOfScope, 1)

    const onlyUnrelated = normalizeReviewOutcome({
        passed: false,
        findings: [{severity: 'critical', title: '无关问题', file: 'src/unrelated.mjs'}],
    }, {tier: 'power'}, {
        files: [{path: 'src/changed.mjs'}],
    })
    assert.equal(onlyUnrelated.passed, true)
    assert.equal(onlyUnrelated.blockingFindings.length, 0)
})

test('Gateway 使用本次 checkpoint 文件约束审查结果范围', () => {
    const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
    assert.match(source, /normalizeReviewOutcome\(result,\s*plan,\s*\{files:\s*checkpoint\.files\}\)/)
})

test('主结果成功且审查必需时进入 reviewing，不能提前完成', () => {
    const initial = createTaskCompletionState()
    const plan = {required: true, tier: 'power', mode: 'gate', riskDomains: ['correctness']}
    const next = transitionTaskCompletion(initial, {
        type: 'primary_result',
        result: {outcome: 'succeeded', text: '已完成实现'},
        reviewPlan: plan,
    })
    assert.equal(next.state.phase, 'reviewing')
    assert.deepEqual(next.effects.map(effect => effect.type), ['start_review'])
    assert.equal(next.state.completionEmitted, false)
})

test('审查通过只完成一次，重复事件不重复完成或通知', () => {
    const reviewing = transitionTaskCompletion(createTaskCompletionState(), {
        type: 'primary_result', result: {outcome: 'succeeded'},
        reviewPlan: {required: true, tier: 'balanced', mode: 'focused', riskDomains: ['correctness']},
    }).state
    const completed = transitionTaskCompletion(reviewing, {
        type: 'review_result', outcome: {passed: true, blockingFindings: [], advisoryFindings: [], summary: '通过'},
    })
    assert.equal(completed.state.phase, 'succeeded')
    assert.deepEqual(completed.effects.map(effect => effect.type), ['complete'])

    const duplicate = transitionTaskCompletion(completed.state, {
        type: 'review_result', outcome: {passed: true, blockingFindings: [], advisoryFindings: [], summary: '重复'},
    })
    assert.deepEqual(duplicate.effects, [])
})

test('第一次阻断只请求一次修复，复核仍阻断时停止自动循环', () => {
    const reviewing = transitionTaskCompletion(createTaskCompletionState(), {
        type: 'primary_result', result: {outcome: 'succeeded'},
        reviewPlan: {required: true, tier: 'power', mode: 'gate', riskDomains: ['correctness']},
    }).state
    const blocked = transitionTaskCompletion(reviewing, {
        type: 'review_result', outcome: {
            passed: false,
            blockingFindings: [{severity: 'high', title: '真实问题'}],
            advisoryFindings: [], summary: '需要修复',
        },
    })
    assert.equal(blocked.state.phase, 'changes_required')
    assert.deepEqual(blocked.effects.map(effect => effect.type), ['request_fix'])

    const fixing = transitionTaskCompletion(blocked.state, {type: 'fix_started'})
    assert.equal(fixing.state.phase, 'fixing')
    const rereview = transitionTaskCompletion(fixing.state, {
        type: 'primary_result', result: {outcome: 'succeeded'},
        reviewPlan: blocked.state.reviewPlan,
    })
    assert.equal(rereview.state.phase, 'reviewing')
    assert.equal(rereview.state.reviewRound, 2)

    const stillBlocked = transitionTaskCompletion(rereview.state, {
        type: 'review_result', outcome: {
            passed: false,
            blockingFindings: [{severity: 'high', title: '仍有问题'}],
            advisoryFindings: [], summary: '复核未通过',
        },
    })
    assert.equal(stillBlocked.state.phase, 'failed')
    assert.deepEqual(stillBlocked.effects.map(effect => effect.type), ['fail'])
})

test('审查暂停和执行失败都不能变成成功', () => {
    const reviewing = transitionTaskCompletion(createTaskCompletionState(), {
        type: 'primary_result', result: {outcome: 'succeeded'},
        reviewPlan: {required: true, tier: 'power', mode: 'gate', riskDomains: []},
    }).state
    const paused = transitionTaskCompletion(reviewing, {type: 'review_paused', detail: '预算不足'})
    assert.equal(paused.state.phase, 'review_paused')
    assert.deepEqual(paused.effects.map(effect => effect.type), ['pause'])

    const failed = transitionTaskCompletion(reviewing, {type: 'review_error', detail: '模型不可用'})
    assert.equal(failed.state.phase, 'failed')
    assert.deepEqual(failed.effects.map(effect => effect.type), ['fail'])
})

test('用户停止后迟到的审查事件不能覆盖 stopped', () => {
    const stopped = createTaskCompletionState({phase: 'stopped', reviewPlan: {required: true, tier: 'power'}})
    const late = transitionTaskCompletion(stopped, {
        type: 'review_result', outcome: {passed: true, blockingFindings: [], advisoryFindings: [], summary: '迟到结果'},
    })
    assert.equal(late.state.phase, 'stopped')
    assert.deepEqual(late.effects, [])
})

test('用户停止统一通过父任务状态转换进入 stopped', () => {
    const stopped = transitionTaskCompletion(createTaskCompletionState({phase: 'reviewing'}), {
        type: 'user_stopped', detail: '用户已暂停任务',
    })
    assert.equal(stopped.state.phase, 'stopped')
    assert.equal(stopped.state.detail, '用户已暂停任务')
})

test('停止和运行时错误不能覆盖已有父任务终态', () => {
    const succeeded = createTaskCompletionState({phase: 'succeeded'})
    assert.equal(transitionTaskCompletion(succeeded, {type: 'user_stopped'}).state.phase, 'succeeded')
    assert.equal(transitionTaskCompletion(succeeded, {type: 'runtime_failed'}).state.phase, 'succeeded')
    const interrupted = transitionTaskCompletion(createTaskCompletionState({phase: 'running'}), {
        type: 'runtime_failed', detail: 'relay disconnected',
    })
    assert.equal(interrupted.state.phase, 'interrupted')
    assert.deepEqual(interrupted.effects, [{type: 'fail', detail: 'relay disconnected'}])
})

test('reviewing 状态收到重复主结果时不重复启动审查', () => {
    const reviewing = createTaskCompletionState({
        phase: 'reviewing',
        primaryResult: {outcome: 'succeeded'},
        reviewPlan: {required: true, tier: 'power', mode: 'gate', riskDomains: ['correctness']},
        reviewRound: 1,
    })
    const duplicate = transitionTaskCompletion(reviewing, {
        type: 'primary_result',
        result: {outcome: 'succeeded'},
        reviewPlan: reviewing.reviewPlan,
    })
    assert.equal(duplicate.state.phase, 'reviewing')
    assert.deepEqual(duplicate.effects, [])
})
