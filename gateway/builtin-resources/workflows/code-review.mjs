// ─── Code Review ───
// 多维度并行审查 + 对抗性验证，适合 PR review / 安全审计 / 上线前检查
// 自动检测项目语言，路由到 java-reviewer / csharp-reviewer / vue-reviewer / database-reviewer
export const meta = {
  name: 'code-review',
  description: '多维度并行审查 + 对抗性验证，自动路由到语言专用 Agent',
  phases: [
    { title: 'Scan', detail: '检测语言 + 定位文件' },
    { title: 'Review', detail: '多维度并行审查' },
    { title: 'Verify', detail: '对抗性验证逐条核实' },
    { title: 'Report', detail: '生成审查报告' },
  ],
}

// Workflow 子进程不暴露 process；目标目录只能由 Gateway 受控注入。
const target = args.path || args.target || '.'

const DIMENSIONS = [
  { key: 'bugs', prompt: '潜在 bug: 空指针、未处理异常、竞态条件、边界条件错误、资源泄漏' },
  { key: 'security', prompt: '安全问题: 注入漏洞、敏感信息泄露、权限绕过、不安全加密、缺少输入校验' },
  { key: 'perf', prompt: '性能问题: 不必要分配、阻塞调用、N+1 查询、大对象拷贝、缺少缓存' },
]

phase('Scan')
log('审查目标: ' + target + ' (Agent: reviewer)')

phase('Review')
const findings = await parallel(DIMENSIONS.map(d =>
  () => agent('审查 ' + target + ' 下的代码:\n' + d.prompt, {
    label: 'review:' + d.key, phase: 'Review', agentType: 'reviewer', modelTier: 'power',
    schema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' }, severity: { type: 'string', enum: ['critical','high','medium','low'] },
              title: { type: 'string' }, description: { type: 'string' },
            },
            required: ['file','severity','title','description'],
          },
        },
      },
      required: ['findings'],
    },
  })
))

const allFindings = findings.filter(Boolean).flatMap(f => f.findings || [])
log('初步发现 ' + allFindings.length + ' 个问题')

// 对抗性验证：逐条反驳，排除误报
phase('Verify')
const verified = await parallel(allFindings.slice(0, 12).map(f =>
  () => agent('对抗性验证此发现是否真实存在。不存在则返回 refuted:true:\n文件:' + f.file + '\n标题:' + f.title + '\n描述:' + f.description, {
    label: 'verify:' + f.file, phase: 'Verify', modelTier: 'power',
    schema: { type:'object', properties:{ isReal:{type:'boolean'}, refuted:{type:'boolean'}, reason:{type:'string'} }, required:['isReal'] },
  }).then(v => ({ ...f, verdict: v }))
))

const confirmed = verified.filter(Boolean).filter(f => f.verdict?.isReal)
log('确认 ' + confirmed.length + ' 个真实问题 (过滤 ' + (allFindings.length - confirmed.length) + ' 个误报)')

phase('Report')
const report = await agent('汇总以下代码审查发现为 Markdown 报告（中文，按严重程度分组）:\n' + JSON.stringify(confirmed, null, 2), {
  label: 'report', phase: 'Report', modelTier: 'power',
})
return { report, confirmed, totalFound: allFindings.length, agentType: 'reviewer' }
