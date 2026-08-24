import test from 'node:test'
import assert from 'node:assert/strict'
import {
    decideTask,
    isAutomaticModelMode,
    resolveTierModel,
} from './task-decision.mjs'

test('简单问答和项目结构探索区分上下文能力', () => {
    const question = decideTask({text: '什么是依赖注入？'})
    assert.equal(question.action, 'query')
    assert.equal(question.modelTier, 'light')
    assert.equal(question.contextProfile, 'light')
    assert.equal(question.finalReview, 'none')

    const inspect = decideTask({text: '查询当前项目的代码结构和关键入口'})
    assert.equal(inspect.action, 'inspect')
    assert.equal(inspect.modelTier, 'light')
    assert.equal(inspect.contextProfile, 'focused')
    assert.equal(inspect.risk, 'low')
})

test('仅回复且明确禁止副作用的补充指令不能被否定词中的修改误判为执行任务', () => {
    const decision = decideTask({
        text: '补充指令验收：请仅回复“补充指令已按顺序处理”。不要调用工具、执行命令、读取或修改文件。',
    })
    assert.equal(decision.action, 'query')
    assert.equal(decision.complexity, 'light')
    assert.equal(decision.modelTier, 'light')
    assert.equal(decision.contextProfile, 'light')
    assert.equal(decision.finalReview, 'none')
    assert.ok(decision.reasons.includes('explicit_read_only'))
    assert.equal(decision.reasons.includes('explicit_execution_request'), false)
})

test('限定概括格式且禁止副作用时不能被否定词中的修改误判为执行任务', () => {
    const decision = decideTask({
        text: '请仅用两句话概括当前项目的核心模块职责，不要调用工具或修改文件。',
    })
    assert.equal(decision.action, 'query')
    assert.equal(decision.complexity, 'light')
    assert.equal(decision.modelTier, 'light')
    assert.equal(decision.contextProfile, 'light')
    assert.equal(decision.finalReview, 'none')
    assert.ok(decision.reasons.includes('explicit_read_only'))
    assert.equal(decision.reasons.includes('explicit_execution_request'), false)
})

test('说明格式且禁止副作用时不能被否定词中的修改误判为执行任务', () => {
    const decision = decideTask({
        text: '请用一句话说明当前项目由哪些主要模块组成，不要调用工具或修改文件。',
    })
    assert.equal(decision.action, 'query')
    assert.equal(decision.complexity, 'light')
    assert.equal(decision.modelTier, 'light')
    assert.equal(decision.contextProfile, 'light')
    assert.equal(decision.finalReview, 'none')
    assert.ok(decision.reasons.includes('explicit_read_only'))
    assert.equal(decision.reasons.includes('explicit_execution_request'), false)
})

test('补充注明格式且禁止副作用时仍保持只读任务', () => {
    const decision = decideTask({
        text: '补充：最后一行注明这些模块通过 Gateway 协作，不要调用工具或修改文件。',
    })
    assert.equal(decision.action, 'query')
    assert.equal(decision.complexity, 'light')
    assert.equal(decision.modelTier, 'light')
    assert.equal(decision.contextProfile, 'light')
    assert.equal(decision.finalReview, 'none')
    assert.ok(decision.reasons.includes('explicit_read_only'))
    assert.equal(decision.reasons.includes('explicit_execution_request'), false)
})

test('仅回复即使提及持久化或会话也不能升级为高风险审查任务', () => {
    const decision = decideTask({
        text: '模型 A 持久化验收：请仅回复“模型 A 已持久化”。不要调用工具、执行命令、读取或修改文件。',
    })
    assert.equal(decision.action, 'query')
    assert.equal(decision.risk, 'low')
    assert.equal(decision.modelTier, 'light')
    assert.equal(decision.finalReview, 'none')
    assert.deepEqual(decision.hardTriggers, [])
})

test('附件只作为存在性证据，不读取附件正文做风险判断', () => {
    const decision = decideTask({text: '看看这个', attachmentEvidence: true})
    assert.equal(decision.action, 'inspect')
    assert.equal(decision.contextProfile, 'focused')
    assert.equal(decision.risk, 'low')
    assert.ok(decision.reasons.includes('attachment_metadata_evidence'))
})

test('普通实现使用 Balanced 并只做本次修改的定向验证', () => {
    const decision = decideTask({text: '给设置页增加一个自动模式开关'})
    assert.equal(decision.action, 'implement')
    assert.equal(decision.complexity, 'balanced')
    assert.equal(decision.modelTier, 'balanced')
    assert.equal(decision.contextProfile, 'full')
    assert.equal(decision.risk, 'medium')
    assert.equal(decision.workflow, 'none')
    assert.equal(decision.finalReview, 'none')
})

test('执行到最后一个任务使用 workflow，普通会话保持 session', () => {
    assert.equal(decideTask({text: '按计划执行到最后一个task'}).executionMode, 'workflow')
    assert.equal(decideTask({text: '自主推进直到目标达成'}).executionMode, 'mission')
    assert.equal(decideTask({text: '修复这个问题'}).executionMode, 'session')
})

test('复杂代码修改使用 Power 并要求定向最终审查，纯调研不触发代码审查', () => {
    const refactor = decideTask({text: '重构当前模块的状态处理，保留现有接口'})
    assert.equal(refactor.action, 'refactor')
    assert.equal(refactor.complexity, 'power')
    assert.equal(refactor.modelTier, 'power')
    assert.equal(refactor.finalReview, 'power')

    const research = decideTask({text: '调研几种状态管理方案并比较优劣'})
    assert.equal(research.complexity, 'power')
    assert.equal(research.finalReview, 'none')
})

test('省略式修改要求不能被异常关键词误判为只读排障', () => {
    const decision = decideTask({text: '不用锁枪，就当普通不合格数据上传就行，只不过显示步骤异常'})
    assert.equal(decision.action, 'implement')
    assert.equal(decision.complexity, 'balanced')
    assert.equal(decision.modelTier, 'balanced')
    assert.equal(decision.risk, 'medium')
    assert.equal(decision.workflow, 'none')
    assert.equal(decision.finalReview, 'none')
    assert.ok(decision.reasons.includes('explicit_execution_request'))
})

test('明确审查请求仍进入审查 Workflow', () => {
    const decision = decideTask({text: '请审查这次按钮修改，只报告真实问题，不要修改代码'})
    assert.equal(decision.action, 'review')
    assert.equal(decision.workflow, 'code-review')
    assert.equal(decision.finalReview, 'balanced')
})

test('短文本命中认证和会话恢复硬风险时强制 Power', () => {
    for (const text of ['改一下认证逻辑', '修复 API Key 泄漏', '优化会话恢复', '修改 SSE 工具调用转换', '修复消息去重竞态']) {
        const decision = decideTask({text})
        assert.equal(decision.modelTier, 'power', text)
        assert.match(decision.risk, /high|critical/, text)
        assert.equal(decision.finalReview, 'power', text)
        assert.ok(decision.hardTriggers.length > 0, text)
    }
})

test('高风险只读审查仍用 Power 但不得获得写入上下文', () => {
    const decision = decideTask({text: '只审查认证、权限和 token 处理，不要修改代码'})
    assert.equal(decision.action, 'review')
    assert.equal(decision.modelTier, 'power')
    assert.equal(decision.contextProfile, 'focused')
    assert.equal(decision.finalReview, 'power')
    assert.equal(decision.workflow, 'code-review')
})

test('明确继续短句继承上一任务等级且不意外降级', () => {
    const previousDecision = decideTask({text: '重构会话恢复和消息通知链路'})
    const continued = decideTask({text: '继续', previousDecision})
    assert.equal(continued.action, previousDecision.action)
    assert.equal(continued.modelTier, 'power')
    assert.equal(continued.risk, previousDecision.risk)
    assert.ok(continued.reasons.includes('continuation_inherits_task'))
})

test('真实差异风险只能升级任务决定', () => {
    const decision = decideTask({
        text: '调整提示文字',
        diffRisk: {risk: 'high', hasCriticalPath: true},
    })
    assert.equal(decision.risk, 'high')
    assert.equal(decision.modelTier, 'power')
    assert.equal(decision.finalReview, 'power')
    assert.ok(decision.hardTriggers.includes('critical_code_path'))
})

test('自动与固定模式兼容旧客户端', () => {
    assert.equal(isAutomaticModelMode('auto', 'gpt-power'), true)
    assert.equal(isAutomaticModelMode('fixed', ''), false)
    assert.equal(isAutomaticModelMode(undefined, 'legacy-explicit-model'), false)
    assert.equal(isAutomaticModelMode(undefined, ''), true)
})

test('档位模型解析返回实际模型和明确回退原因', () => {
    const power = decideTask({text: '修改认证和权限逻辑'})
    assert.deepEqual(resolveTierModel(power, {
        power: 'gpt-power', balanced: 'gpt-balanced', light: 'gpt-light',
    }, 'gpt-default'), {
        tier: 'power', model: 'gpt-power', configured: true, fallbackReason: null,
    })

    assert.deepEqual(resolveTierModel(power, {
        power: null, balanced: 'gpt-balanced', light: 'gpt-light',
    }, 'gpt-default'), {
        tier: 'power', model: 'gpt-default', configured: false, fallbackReason: 'tier_model_unconfigured',
    })
})

test('决策输出有稳定版本并限制可见原因数量', () => {
    const decision = decideTask({text: '全面重构认证、会话恢复、SSE、并发重试和消息通知'})
    assert.equal(decision.version, 1)
    assert.ok(decision.reasons.length <= 8)
    assert.ok(decision.hardTriggers.length <= 8)
    assert.equal(Object.values(decision).some(value => typeof value === 'string' && value.includes('API_KEY=')), false)
})
