// ─── Bug Hunter (项目级覆盖) ───
// 风险加权评分决定搜索角度数，避免小改动触发全维度并行猎手
export const meta = {
  name: 'bug-hunter',
  description: '风险加权猎手 — Trivial 跳过 / Small 双角度 / Medium 三角度 / Large 全维度+验证',
  phases: [
    { title: 'Size', detail: 'git diff + 风险加权评分' },
    { title: 'Hunt', detail: '按档搜索潜在 bug' },
    { title: 'Verify', detail: '证伪者逐条验证 (仅 Large)' },
    { title: 'Report', detail: '输出确认的 bug 清单' },
  ],
}

const target = args.target || '.'

const ANGLES = [
  { key: 'logic', prompt: '逻辑错误: 条件判断错误、循环边界、状态机缺陷、死代码', minTier: 'small' },
  { key: 'edge', prompt: '边界/异常: null/undefined、除零、空集合、超长输入、特殊字符', minTier: 'small' },
  { key: 'async', prompt: '异步/并发问题: race condition、死锁、未处理的 Promise、回调时序', minTier: 'medium' },
  { key: 'memory', prompt: '内存问题: 泄漏、未释放资源、大对象常驻、循环引用', minTier: 'large' },
]

phase('Size')

// 复用与 code-review 相同的风险分类逻辑
const sizing = await agent(
  `Run: git diff --stat --cached 2>/dev/null || git diff --stat 2>/dev/null

For each changed file, classify by project path risk + change type. Same rules:

**Critical (weight=3):** gateway/*-proxy.mjs, workflow-runner.mjs, workflow-child.mjs, gateway/index.mjs, any file touching child_process/fork/spawn/exec
**High (weight=2):** gateway/*.mjs (general), desktop-ui/src/views/*.vue, desktop-ui/src/composables/*.ts, desktop-ui/src/components/*.ts
**Medium (weight=1.5):** desktop-ui/src/components/*.vue, .ts files with logic
**Low (weight=1):** i18n.ts, CSS, .md, .json, .d.ts

**Change type multipliers:** new_logic(×1.5), modify(×1.0), refactor(×1.0), delete(×0.8), config(×0.5), strings_only(×0.3)

Return JSON:
{"filesChanged":N,"totalLines":N,"files":[{"path":"...","lines":N,"risk":N,"changeType":"..."}],"riskScore":N,"maxFileRisk":N,"hasCriticalPath":bool}`,

  {
    label: 'risk-classify',
    phase: 'Size',
    schema: {
      type: 'object',
      properties: {
        filesChanged: { type: 'number' },
        totalLines: { type: 'number' },
        files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, lines: { type: 'number' }, risk: { type: 'number' }, changeType: { type: 'string' } }, required: ['path', 'lines', 'risk', 'changeType'] } },
        riskScore: { type: 'number' },
        maxFileRisk: { type: 'number' },
        hasCriticalPath: { type: 'boolean' },
      },
      required: ['filesChanged', 'totalLines', 'riskScore', 'maxFileRisk', 'hasCriticalPath'],
    },
  }
)

const s = sizing || {}
const { filesChanged = 0, totalLines = 0, riskScore = 0, maxFileRisk = 1, hasCriticalPath = false } = s

let tier
if (riskScore < 30 && !hasCriticalPath) {
  tier = 'trivial'
} else if (riskScore < 150 && maxFileRisk < 3) {
  tier = 'small'
} else if (riskScore < 500) {
  tier = 'medium'
} else {
  tier = 'large'
}
if (hasCriticalPath && tier === 'small') tier = 'medium'

log(`变更: ${filesChanged} 文件, ${totalLines} 行 → 风险评分 ${riskScore}`)
log(`猎手深度: ${tier.toUpperCase()}`)

if (tier === 'trivial') {
  log('Trivial 改动，跳过猎手')
  return { tier, riskScore, bugs: [], totalReported: 0, confirmedCount: 0 }
}

// 按 minTier 过滤角度
const enabledAngles = ANGLES.filter(a => {
  const order = ['trivial', 'small', 'medium', 'large']
  return order.indexOf(tier) >= order.indexOf(a.minTier)
})

log(`启用角度: ${enabledAngles.map(a => a.key).join(', ')}`)

phase('Hunt')
const bugs = await parallel(enabledAngles.map(a =>
  () => agent('在 ' + target + ' 中搜索:\n' + a.prompt + '\n只报告确信度高的真实 bug，返回 JSON', {
    label: 'hunt:' + a.key, phase: 'Hunt',
    schema: {
      type: 'object',
      properties: {
        bugs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              title: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium'] },
              description: { type: 'string' },
            },
            required: ['file', 'title', 'confidence', 'description'],
          },
        },
      },
      required: ['bugs'],
    },
  })
))

const allBugs = bugs.filter(Boolean).flatMap(b => b.bugs || [])
log('猎手发现 ' + allBugs.length + ' 个可疑 bug')

// 仅 Large 做证伪验证
if (tier !== 'large' || allBugs.length === 0) {
  log('Small/Medium 跳过验证，直接返回')
  return { tier, riskScore, bugs: allBugs, totalReported: allBugs.length, confirmedCount: allBugs.length }
}

phase('Verify')
const confirmed = await parallel(allBugs.slice(0, 10).map(b =>
  () => agent('尝试证伪以下 bug 报告。不存在则返回 refuted:true:\n文件:' + b.file + ':' + (b.line || '') + '\n' + b.title + '\n' + b.description, {
    label: 'verify:' + b.file, phase: 'Verify',
    schema: {
      type: 'object',
      properties: { confirmed: { type: 'boolean' }, refuted: { type: 'boolean' }, actualImpact: { type: 'string' }, fixSuggestion: { type: 'string' } },
      required: ['confirmed'],
    },
  }).then(v => ({ ...b, verdict: v }))
))

const realBugs = confirmed.filter(Boolean).filter(b => b.verdict?.confirmed)
log('确认 ' + realBugs.length + ' 个真实 bug (' + allBugs.length + ' 个原始报告)')

phase('Report')
return { bugs: realBugs, totalReported: allBugs.length, confirmedCount: realBugs.length, tier, riskScore }
