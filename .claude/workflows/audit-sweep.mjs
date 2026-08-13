// ─── Audit Sweep (项目级覆盖) ───
// 根据扫描范围自动筛选维度：单文件不扫依赖/CVE，小目录不扫结构
export const meta = {
  name: 'audit-sweep',
  description: '自适应审计 — 按扫描范围筛选维度，单文件/小目录自动跳过不适用维度',
  phases: [
    { title: 'Scope', detail: '检测扫描范围 + 判定适用维度' },
    { title: 'Scan', detail: '按维度并行扫描' },
    { title: 'DeepDive', detail: '深度分析关键问题 (仅高危项)' },
    { title: 'Completeness', detail: '完整性检查' },
    { title: 'Report', detail: '审计报告' },
  ],
}

const target = args.target || '.'

const DIMENSIONS = [
  {
    key: 'deps',
    prompt: '依赖健康: 过期版本、未使用依赖、已知 CVE、许可证冲突',
    // 仅当目标含 package.json 或扫描整个项目时启用
    requirePackageJson: true,
    requireMinFiles: 0,
  },
  {
    key: 'structure',
    prompt: '结构问题: 循环依赖、过大模块、层级泄漏、命名混乱',
    // 仅当文件数 >= 5 时启用 (单文件无所谓结构)
    requireMinFiles: 5,
  },
  {
    key: 'techdebt',
    prompt: '技术债: TODO/FIXME/HACK 标记、重复代码、过时 API、缺少测试',
    requireMinFiles: 0,
  },
  {
    key: 'quality',
    prompt: '代码质量: 过长函数、过深嵌套、过多参数、magic number',
    requireMinFiles: 0,
  },
]

phase('Scope')

// 检测目标范围: 是文件还是目录，是否含 package.json
const scopeCheck = await agent(
  `Check the target "${target}":
1. Run: ls -la "${target}" 2>/dev/null || echo "IS_FILE"
2. Determine if it's a single file or a directory
3. Check if "${target}/package.json" exists (or any package.json in scope)
4. Count .mjs/.ts/.vue files in scope (find "${target}" -name "*.mjs" -o -name "*.ts" -o -name "*.vue" 2>/dev/null | wc -l)

Return JSON:
{"isFile":bool,"hasPackageJson":bool,"sourceFileCount":N}`,

  {
    label: 'scope-check',
    phase: 'Scope',
    modelTier: 'light',
    schema: {
      type: 'object',
      properties: {
        isFile: { type: 'boolean' },
        hasPackageJson: { type: 'boolean' },
        sourceFileCount: { type: 'number' },
      },
      required: ['isFile', 'hasPackageJson', 'sourceFileCount'],
    },
  }
)

const sc = scopeCheck || {}
const { isFile = false, hasPackageJson = false, sourceFileCount = 0 } = sc

// 筛选适用维度
const enabledDimensions = DIMENSIONS.filter(d => {
  if (d.requireMinFiles && sourceFileCount < d.requireMinFiles) return false
  if (d.requirePackageJson && !hasPackageJson) return false
  return true
})

const skippedDimensions = DIMENSIONS.filter(d => !enabledDimensions.includes(d))

log(`范围: ${isFile ? '单文件' : '目录'}, ${sourceFileCount} 源文件, package.json: ${hasPackageJson ? '有' : '无'}`)
log(`启用维度: ${enabledDimensions.map(d => d.key).join(', ')}`)
if (skippedDimensions.length > 0) {
  log(`跳过维度: ${skippedDimensions.map(d => d.key).join(', ')} (${skippedDimensions.map(d => d.requireMinFiles ? `文件数${sourceFileCount}<${d.requireMinFiles}` : `无package.json`).join(', ')})`)
}

phase('Scan')

if (enabledDimensions.length === 0) {
  log('范围过小，无适用维度，跳过审计')
  return { report: '范围过小，无适用维度', totalIssues: 0, skippedDimensions: skippedDimensions.map(d => d.key) }
}

const results = await parallel(enabledDimensions.map(d =>
  () => agent('扫描 ' + target + ' 下的 ' + d.prompt + '\n返回结构化发现列表', {
    label: 'scan:' + d.key, phase: 'Scan',
    modelTier: 'balanced',
    schema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              area: { type: 'string' },
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              title: { type: 'string' },
              file: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['area', 'severity', 'title'],
          },
        },
      },
      required: ['findings'],
    },
  })
))

const allIssues = results.filter(Boolean).flatMap(r => r.findings || [])
log('扫描发现 ' + allIssues.length + ' 个问题')

// 深度分析仅高危项 (最多 5 个)
phase('DeepDive')
const critical = allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 5)
let deepAnalysis = []
if (critical.length > 0) {
  deepAnalysis = await parallel(critical.map((c, i) =>
    () => agent('深度分析此问题的影响范围和修复方案:\n' + JSON.stringify(c), {
      label: 'deep:' + i, phase: 'DeepDive',
      modelTier: 'power',
      schema: {
        type: 'object',
        properties: { impact: { type: 'string' }, effort: { type: 'string', enum: ['small', 'medium', 'large'] }, recommendation: { type: 'string' } },
        required: ['impact', 'recommendation'],
      },
    }).then(a => ({ issue: c, analysis: a }))
  ))
  deepAnalysis = deepAnalysis.filter(Boolean)
}

// 完整性检查: 只在多维度时做
phase('Completeness')
let critic = null
if (enabledDimensions.length >= 2 && allIssues.length > 0) {
  critic = await agent(
    '以下是对 ' + target + ' 的审计结果。完整性审查 — 哪些维度/文件/模块遗漏了？\n\n## 已有发现\n' +
    JSON.stringify({ dimensions: enabledDimensions.map(d => d.key), skipped: skippedDimensions.map(d => d.key), issueCount: allIssues.length, issues: allIssues.slice(0, 20) }, null, 2),
    {
      label: 'completeness', phase: 'Completeness',
      modelTier: 'power',
      schema: {
        type: 'object',
        properties: {
          missedDimensions: { type: 'array', items: { type: 'string' } },
          missedAreas: { type: 'array', items: { type: 'string' } },
          completeness: { type: 'number' },
        },
        required: ['completeness'],
      },
    }
  )
  log('完整性评估: ' + ((critic?.completeness || 0) * 100).toFixed(0) + '%')
}

phase('Report')
const report = await agent(
  '生成项目审计报告（中文 Markdown，含评分、TOP 问题、改进路线图）:\n' +
  JSON.stringify({
    target,
    scope: { isFile, sourceFileCount, hasPackageJson },
    enabledDimensions: enabledDimensions.map(d => d.key),
    skippedDimensions: skippedDimensions.map(d => d.key),
    totalIssues: allIssues.length,
    bySeverity: {
      critical: allIssues.filter(i => i.severity === 'critical').length,
      high: allIssues.filter(i => i.severity === 'high').length,
      medium: allIssues.filter(i => i.severity === 'medium').length,
      low: allIssues.filter(i => i.severity === 'low').length,
    },
    deepAnalysis: deepAnalysis.map(d => ({ issue: d.issue.title, impact: d.analysis?.impact, recommendation: d.analysis?.recommendation })),
    completeness: critic,
  }, null, 2),
  { label: 'report', phase: 'Report', modelTier: 'power' }
)

return { report, totalIssues: allIssues.length, enabledDimensions: enabledDimensions.map(d => d.key), skippedDimensions: skippedDimensions.map(d => d.key), completeness: critic?.completeness || 0 }
