// ─── Audit Sweep ───
// 多模块并行扫描 + completeness critic，适合项目审计/技术债梳理/依赖检查
// 质量/技术债维度路由到语言专用 Agent
export const meta = {
  name: 'audit-sweep',
  description: '多模块并行扫描 + 完整性检查，适合项目审计/技术债梳理/依赖健康检查',
  phases: [
    { title: 'Scan', detail: '检测语言 + 多维度并行扫描' },
    { title: 'DeepDive', detail: '深度分析关键问题' },
    { title: 'Completeness', detail: '完整性检查确保无遗漏' },
    { title: 'Report', detail: '审计报告' },
  ],
}

const target = args.path || args.target || process.cwd()

const DIMENSIONS = [
  { key: 'techdebt', prompt: '技术债: TODO/FIXME/HACK 标记、重复代码、过时 API、缺少测试' },
  { key: 'deps', prompt: '依赖健康: 过期版本、未使用依赖、已知 CVE、许可证冲突' },
  { key: 'structure', prompt: '结构问题: 循环依赖、过大模块、层级泄漏、命名混乱' },
  { key: 'quality', prompt: '代码质量: 过长函数、过深嵌套、过多参数、magic number' },
]

// quality/techdebt 用语言专用 reviewer，deps/structure 用通用 Agent
function agentTypeForDimension(key) {
  return (key === 'quality' || key === 'techdebt') ? 'reviewer' : undefined
}

phase('Scan')
log('审计目标: ' + target + ' (quality/techdebt: reviewer, deps/structure: general)')

phase('Scan')
const results = await parallel(DIMENSIONS.map(d =>
  () => agent('扫描 ' + target + ' 下的 ' + d.prompt + '\n返回结构化发现列表', {
    label: 'scan:' + d.key, phase: 'Scan', agentType: agentTypeForDimension(d.key), modelTier: 'balanced',
    schema: { type:'object', properties:{ findings:{type:'array',items:{type:'object',properties:{ area:{type:'string'},severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},file:{type:'string'},suggestion:{type:'string'} },required:['area','severity','title']} } }, required:['findings'] },
  })
))

const allIssues = results.filter(Boolean).flatMap(r => r.findings || [])
log('扫描发现 ' + allIssues.length + ' 个问题')

// 深度分析 TOP 高危项
phase('DeepDive')
const critical = allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 5)
let deepAnalysis = []
if (critical.length > 0) {
  deepAnalysis = await parallel(critical.map((c, i) =>
    () => agent('深度分析此问题的影响范围和修复方案:\n' + JSON.stringify(c), {
      label: 'deep:' + i, phase: 'DeepDive', modelTier: 'power',
      schema: { type:'object', properties:{ impact:{type:'string'}, effort:{type:'string',enum:['small','medium','large']}, recommendation:{type:'string'} }, required:['impact','recommendation'] },
    }).then(a => ({ issue: c, analysis: a }))
  ))
  deepAnalysis = deepAnalysis.filter(Boolean)
}

// 完整性检查
phase('Completeness')
const critic = await agent(
  '以下是对 ' + target + ' 的多维度审计结果。你是一个完整性审查者——还有哪些维度没覆盖？哪些文件/模块被遗漏？\n\n## 已有发现\n' +
  JSON.stringify({ dimensions: DIMENSIONS.map(d => d.key), issueCount: allIssues.length, issues: allIssues.slice(0, 20) }, null, 2),
  { label: 'completeness', phase: 'Completeness', modelTier: 'power',
    schema: { type:'object', properties:{ missedDimensions:{type:'array',items:{type:'string'}}, missedAreas:{type:'array',items:{type:'string'}}, completeness:{type:'number'} }, required:['completeness'] },
  }
)

log('完整性评估: ' + ((critic?.completeness || 0) * 100).toFixed(0) + '%')

phase('Report')
const report = await agent(
  '生成项目审计报告（中文 Markdown，含评分、TOP 问题、改进路线图）:\n' +
  JSON.stringify({ target, totalIssues: allIssues.length, bySeverity: { critical: allIssues.filter(i => i.severity==='critical').length, high: allIssues.filter(i => i.severity==='high').length, medium: allIssues.filter(i => i.severity==='medium').length, low: allIssues.filter(i => i.severity==='low').length }, deepAnalysis: deepAnalysis.map(d => ({ issue: d.issue.title, impact: d.analysis?.impact, recommendation: d.analysis?.recommendation })), completeness: critic }, null, 2),
  { label: 'report', phase: 'Report', modelTier: 'power' }
)
return { report, totalIssues: allIssues.length, completeness: critic?.completeness || 0, agentType: 'reviewer' }
