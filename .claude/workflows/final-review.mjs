// ─── Final Review Gate ───
// Gateway 已完成风险分级和变更文件收集，本 Workflow 只执行所需审查，不重复扫描整个项目。
export const meta = {
  name: 'final-review',
  description: '按父任务风险执行一次定向最终门禁审查',
  phases: [
    { title: 'Review', detail: '检查本轮真实变更' },
    { title: 'Verify', detail: '仅证伪高风险候选项' },
  ],
}

const target = args.target || '.'
const tier = args.reviewTier === 'power' ? 'power' : 'balanced'
const mode = args.reviewMode === 'gate' ? 'gate' : 'focused'
const files = Array.isArray(args.files) ? args.files.slice(0, 80) : []
const domains = Array.isArray(args.riskDomains) && args.riskDomains.length
  ? args.riskDomains.slice(0, 8)
  : ['correctness']

if (files.length === 0) {
  return { passed: true, findings: [], summary: '没有真实文件差异，跳过最终审查', tier }
}

const fileList = files.map((file, index) => `${index + 1}. ${file.path} (${file.lines || 1} lines)`).join('\n')
const domainPrompt = domains.map(domain => `- ${domain}`).join('\n')

phase('Review')
const review = await agent(
  `只审查本轮列出的变更文件，不扫描整个仓库，不修改文件。\n` +
  `目标目录: ${target}\n` +
  `审查模式: ${mode}\n` +
  `风险域:\n${domainPrompt}\n\n` +
  `变更文件:\n${fileList}\n\n` +
  `要求:\n` +
  `1. 只报告能用当前代码证据确认的真实问题。\n` +
  `2. correctness 必查：异常路径、状态一致性、边界、重复回调和资源释放。\n` +
  `3. 其他风险域仅在列表命中时检查。\n` +
  `4. critical/high 默认 blocking；medium/low 默认 advisory。\n` +
  `5. 返回结构化 findings，不输出泛化建议。`,
  {
    label: 'final-review',
    phase: 'Review',
    modelTier: tier,
    schema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              blocking: { type: 'boolean' },
              title: { type: 'string' },
              description: { type: 'string' },
              file: { type: 'string' },
              line: { type: 'number' },
              suggestion: { type: 'string' },
            },
            required: ['severity', 'title', 'description', 'file'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['findings', 'summary'],
    },
  }
)

let findings = review?.findings || []
const candidates = findings.filter(item => item.blocking === true || item.severity === 'critical' || item.severity === 'high').slice(0, 8)

if (tier === 'power' && candidates.length > 0) {
  phase('Verify')
  const verified = await parallel(candidates.map((finding, index) =>
    () => agent(
      `尝试证伪以下最终审查发现。只根据文件中的可定位证据判断，不能靠猜测。\n` +
      JSON.stringify(finding),
      {
        label: `verify:${index}`,
        phase: 'Verify',
        modelTier: 'power',
        schema: {
          type: 'object',
          properties: {
            isReal: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['isReal', 'reason'],
        },
      }
    ).then(verdict => ({ finding, verdict }))
  ))
  const realKeys = new Set(verified.filter(item => item?.verdict?.isReal).map(item => `${item.finding.file}\0${item.finding.title}`))
  findings = findings.filter(item => {
    if (!(item.blocking === true || item.severity === 'critical' || item.severity === 'high')) return true
    return realKeys.has(`${item.file}\0${item.title}`)
  })
}

const blocking = findings.filter(item => item.blocking === true || item.severity === 'critical' || item.severity === 'high')
return {
  passed: blocking.length === 0,
  findings,
  summary: blocking.length > 0 ? `最终审查发现 ${blocking.length} 个阻断问题` : (review?.summary || '最终审查通过'),
  tier,
}
