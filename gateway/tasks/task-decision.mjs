const WRITE_SIGNALS = /(?:修改|修复|实现|新增|添加|增加|加上|加个|加一个|补上|补个|补一个|加入|移除|删除|重构|改代码|写代码|补代码|优化|完善|改成|改为|调整为|设为|设置为|显示成|显示为|处理(?:一下)?|解决(?:一下|掉)?|完成(?:这个)?(?:需求|功能)?|做出来|落地|应用补丁|执行命令|运行测试|构建项目|编译项目|提交代码|commit|push|部署|安装依赖|(?:当作|作为|就当)[\s\S]{0,40}(?:处理|保存|上传|显示|记录|使用|返回))/i
const READ_ONLY_SIGNALS = /(?:只(?:是)?分析|仅(?:仅)?分析|只(?:是)?查看|仅(?:仅)?查看|只(?:是)?看(?:一下)?|仅(?:仅)?看(?:一下)?|只审查|仅审查|只检查|仅检查|只读|只阅读|仅阅读|不要(?:修改|改|写入|写代码|创建|删除|执行)|无需(?:修改|改|写入|执行)|不用(?:修改|改|写入|执行)|不需要(?:修改|改|写入|执行))/i
const DIRECT_WRITE_OVERRIDE = /(?:不要|别)(?:只|光)(?:分析|看|给方案|停留在分析)[\s\S]{0,80}(?:修改|修复|实现|添加|增加|加上|加个|补|优化|完善|处理|解决|完成|做出来)/i
const CONTINUATION_SIGNALS = /^(?:好[的地]?[，,、 ]*)?(?:继续|接着来|继续吧|继续处理|继续执行|继续修改|继续修复|继续实现|继续测试|继续优化|继续完善|往下做|然后呢)[。！!，,？?\s]*$/i
const SIMPLE_QUESTION_SIGNALS = /^(?:继续[，, ]*)?(?:你好|您好|hi|hello|在吗|谢谢|你是谁|你是什么模型|当前是什么模型|什么是|是什么意思|解释(?:一下)?|说明(?:一下)?|介绍一下|简单解释|为什么|怎么理解|what is|who are you|which model)/i
const INSPECT_SIGNALS = /(?:查询|查找|搜索|定位|扫描|浏览|读取|目录结构|代码结构|项目结构|关键入口|调用关系|依赖关系|有哪些文件|有几个|在哪里|在哪个文件)/i
const REVIEW_SIGNALS = /(?:审查|审阅|review|检查代码|代码检查|找问题|安全审计|安全审查|漏洞扫描|全面检查)/i
const REFACTOR_SIGNALS = /(?:重构|架构调整|架构设计|迁移|模块拆分|重新设计|整体优化|完整优化)/i
const OPERATE_SIGNALS = /(?:部署|发布|安装依赖|提交代码|commit|push|启动服务|停止服务|运行测试|构建项目|编译项目)/i
const BUG_SIGNALS = /(?:bug|缺陷|报错|异常|错误|崩溃|卡住|失败|死锁|竞态|race condition|null pointer|内存泄漏)/i
const PLAN_SIGNALS = /(?:方案对比|比较优劣|权衡利弊|架构决策|技术选型|怎么选|选哪个)/i
const RESEARCH_SIGNALS = /(?:调研|research|竞品分析|对比市面|深入分析)/i

const HARD_TRIGGER_RULES = [
    {code: 'authentication_or_secret', risk: 'critical', pattern: /(?:认证|鉴权|授权|权限|api\s*key|apikey|token|密码|密钥|secret|credential|oauth|签名验证)/i},
    {code: 'destructive_or_migration', risk: 'critical', pattern: /(?:数据迁移|数据库迁移|不可逆|批量删除|清空数据|删除历史|覆盖数据|回滚数据|force[- ]?push)/i},
    {code: 'session_identity_or_persistence', risk: 'high', pattern: /(?:会话恢复|会话身份|session\s*(?:id|resume|restore)|持久化|transcript|断点续接|跨会话|任务状态恢复)/i},
    {code: 'concurrency_or_lifecycle', risk: 'high', pattern: /(?:并发|竞态|race condition|死锁|重复回调|生命周期|取消|cancellation|超时|timeout|重试|retry|幂等)/i},
    {code: 'protocol_or_streaming', risk: 'high', pattern: /(?:协议|sse|websocket|流式|工具调用|tool[_ -]?call|tool[_ -]?use|消息格式|请求转换|响应转换)/i},
    {code: 'im_delivery', risk: 'high', pattern: /(?:微信|飞书|钉钉|消息通知|消息投递|通知链路|im\s*注入)/i},
    {code: 'public_contract', risk: 'high', pattern: /(?:公开接口|公共接口|api\s*契约|事件契约|兼容性|breaking change)/i},
    {code: 'gateway_critical_path', risk: 'high', pattern: /(?:gateway\/index\.mjs|workflow-runner|workflow-child|child_process|\bfork\b|\bspawn\b|\bexec\b|代理转发|中转协议)/i},
]

const RISK_ORDER = {low: 0, medium: 1, high: 2, critical: 3}

function maxRisk(left, right) {
    return RISK_ORDER[right] > RISK_ORDER[left] ? right : left
}

function uniqueBounded(values, max = 8) {
    return [...new Set(values.filter(Boolean))].slice(0, max)
}

function hasCodeOrFileEvidence(text) {
    return text.includes('```')
        || (text.match(/\r?\n/g) || []).length >= 3
        || /(?:^|\s)[@#][^\s#@]+/.test(text)
        || /[A-Za-z]:[\\/]|(?:^|\s)(?:\.\.?[\\/]|[\w.-]+\.(?:js|mjs|cjs|ts|tsx|vue|py|java|cs|cpp|c|h|json|ya?ml|toml|md))(?:\s|$)/i.test(text)
}

function workflowFor(text, action) {
    if (REVIEW_SIGNALS.test(text)) return /(?:安全审计|安全审查|漏洞扫描|全面检查)/i.test(text) ? 'audit-sweep' : 'code-review'
    if (BUG_SIGNALS.test(text) && action === 'inspect') return 'bug-hunter'
    if (PLAN_SIGNALS.test(text)) return 'judge-panel'
    if (RESEARCH_SIGNALS.test(text)) return 'deep-research'
    return 'none'
}

export function decideTask(input = {}) {
    const normalized = String(input.text || '').trim()
    const previous = input.previousDecision && typeof input.previousDecision === 'object'
        ? input.previousDecision
        : null
    if (previous && CONTINUATION_SIGNALS.test(normalized)) {
        return {
            ...previous,
            version: 1,
            reasons: uniqueBounded([...(previous.reasons || []), 'continuation_inherits_task']),
            hardTriggers: uniqueBounded(previous.hardTriggers || []),
        }
    }

    const readOnly = READ_ONLY_SIGNALS.test(normalized) && !DIRECT_WRITE_OVERRIDE.test(normalized)
    const explicitWrite = WRITE_SIGNALS.test(normalized) || DIRECT_WRITE_OVERRIDE.test(normalized)
    const attachmentEvidence = input.attachmentEvidence === true
    const codeEvidence = hasCodeOrFileEvidence(normalized) || attachmentEvidence
    const reasons = []
    const hardTriggers = []
    let risk = 'low'

    for (const rule of HARD_TRIGGER_RULES) {
        if (!rule.pattern.test(normalized)) continue
        hardTriggers.push(rule.code)
        risk = maxRisk(risk, rule.risk)
    }

    if (input.diffRisk?.hasCriticalPath) {
        hardTriggers.push('critical_code_path')
        risk = maxRisk(risk, input.diffRisk.risk || 'high')
    } else if (input.diffRisk?.risk && RISK_ORDER[input.diffRisk.risk] !== undefined) {
        risk = maxRisk(risk, input.diffRisk.risk)
    }

    let action = 'query'
    if (OPERATE_SIGNALS.test(normalized)) action = 'operate'
    else if (REFACTOR_SIGNALS.test(normalized)) action = 'refactor'
    else if (REVIEW_SIGNALS.test(normalized) || readOnly && /(?:审查|检查|audit|review)/i.test(normalized)) action = 'review'
    else if (explicitWrite) action = 'implement'
    else if (INSPECT_SIGNALS.test(normalized) || codeEvidence) action = 'inspect'

    if (action === 'implement' || action === 'operate' || action === 'refactor') risk = maxRisk(risk, 'medium')
    if (action === 'review' && (codeEvidence || normalized.length > 80)) risk = maxRisk(risk, 'medium')
    if (action === 'refactor' && /(?:整体|完整|全面|跨模块|多个模块|系统级)/i.test(normalized)) risk = maxRisk(risk, 'high')

    const simpleQuestion = normalized.length <= 160 && SIMPLE_QUESTION_SIGNALS.test(normalized) && !codeEvidence
    let contextProfile = 'full'
    if (readOnly) contextProfile = simpleQuestion ? 'light' : 'focused'
    else if (action === 'query' && simpleQuestion) contextProfile = 'light'
    else if (action === 'inspect' && !explicitWrite) contextProfile = 'focused'

    let complexity = 'balanced'
    if (risk === 'high' || risk === 'critical' || action === 'refactor' || PLAN_SIGNALS.test(normalized) || RESEARCH_SIGNALS.test(normalized)) {
        complexity = 'power'
    } else if ((action === 'query' || action === 'inspect') && risk === 'low') {
        complexity = 'light'
    }

    let modelTier = complexity
    if (risk === 'high' || risk === 'critical') modelTier = 'power'

    const mutatesCode = action === 'implement' || action === 'operate' || action === 'refactor'
    let finalReview = 'none'
    if (risk === 'high' || risk === 'critical') finalReview = 'power'
    else if (complexity === 'power' && mutatesCode) finalReview = 'power'
    else if (action === 'review') finalReview = 'balanced'

    if (readOnly) reasons.push('explicit_read_only')
    if (explicitWrite) reasons.push('explicit_execution_request')
    if (codeEvidence) reasons.push('code_or_file_evidence')
    if (attachmentEvidence) reasons.push('attachment_metadata_evidence')
    if (hardTriggers.length) reasons.push('hard_risk_trigger')
    if (action === 'inspect') reasons.push('read_only_project_inspection')
    if (action === 'query' && simpleQuestion) reasons.push('independent_simple_question')
    if (risk === 'high' || risk === 'critical') reasons.push('power_required_by_risk')

    return {
        version: 1,
        action,
        complexity,
        risk,
        modelTier,
        contextProfile,
        workflow: workflowFor(normalized, action),
        finalReview,
        reasons: uniqueBounded(reasons.length ? reasons : ['default_balanced_task']),
        hardTriggers: uniqueBounded(hardTriggers),
    }
}

export function isAutomaticModelMode(mode, explicitModel) {
    if (mode === 'auto') return true
    if (mode === 'fixed') return false
    return !String(explicitModel || '').trim()
}

export function resolveTierModel(decision, modelTiers = {}, defaultModel = '') {
    const tier = decision?.modelTier === 'power' || decision?.modelTier === 'light'
        ? decision.modelTier
        : 'balanced'
    const configuredModel = String(modelTiers?.[tier] || '').trim()
    if (configuredModel) return {tier, model: configuredModel, configured: true, fallbackReason: null}
    return {
        tier,
        model: String(defaultModel || '').trim(),
        configured: false,
        fallbackReason: 'tier_model_unconfigured',
    }
}
