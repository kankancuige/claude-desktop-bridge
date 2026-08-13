// ─── Code Review (项目级覆盖) ───
// 风险加权评分: 文件路径 × 改动行数 × 改动类型 → 四档审查深度
// 调用方应先做 pre-check (Bash git diff --stat) 并通过 args.files 传入文件列表，
// 避免 workflow 内重复跑 diff。未传 args.files 时回退到 agent 跑 diff。
export const meta = {
  name: 'code-review',
  description: '风险加权分档审查 — 接收 pre-check 文件列表，只做分类不重复 diff',
  phases: [
    { title: 'Size', detail: '风险加权评分 (无 git diff)' },
    { title: 'Review', detail: '按档执行审查' },
  ],
}

const target = args.target || '.'

phase('Size')

// 优先用调用方传入的 pre-check 文件列表，避免重复跑 git diff
const preCheckFiles = args.files  // [{path: "gateway/index.mjs", lines: 15}, ...]

let sizing
if (preCheckFiles && preCheckFiles.length > 0) {
  // 只做风险分类，不跑 git diff
  const fileList = preCheckFiles.map(f => `  ${f.path} (${f.lines} lines)`).join('\n')
  sizing = await agent(
    `Classify each changed file below by risk level and change type. Do NOT run git diff — file list already provided.

## Risk bucket rules (this project only)

**Critical (weight=3):**
- gateway/*-proxy.mjs (API proxy, directly affects AI request forwarding)
- gateway/workflow-runner.mjs, gateway/workflow-child.mjs (process management/signals)
- gateway/index.mjs (main routing/WS/HTTP entrypoint)
- Any file touching: child_process, fork, spawn, exec

**High (weight=2):**
- gateway/*.mjs (general gateway logic)
- desktop-ui/src/views/*.vue (page-level components with business logic)
- desktop-ui/src/composables/*.ts (reactive/state management)
- desktop-ui/src/components/*.ts (component logic)

**Medium (weight=1.5):**
- desktop-ui/src/components/*.vue (UI components with some logic)
- Any .ts file with logic (not pure types)

**Low (weight=1):**
- desktop-ui/src/i18n.ts (pure translations)
- *.css, style files
- *.md, *.json config
- Type definition files (*.d.ts)

## Change type multiplier
- new_logic (×1.5): new algorithm/function/control flow/error handling/state machine
- modify (×1.0): change existing logic/params/conditions
- refactor (×1.0): rename/extract function/structure adjustment
- strings_only (×0.3): only strings/translations/copy/log text
- config (×0.5): config values/env vars/constants
- delete (×0.8): delete code

## Files to classify:
${fileList}

Return JSON:
{
  "filesChanged": N,
  "totalLines": N,
  "files": [
    {"path": "...", "lines": N, "risk": N, "changeType": "...", "reason": "..."}
  ],
  "riskScore": N,
  "maxFileRisk": N,
  "hasCriticalPath": bool
}
riskScore = sum(file.risk × file.lines × changeTypeMultiplier)`,
    {
      label: 'risk-classify',
      phase: 'Size',
      modelTier: 'light',
      schema: {
        type: 'object',
        properties: {
          filesChanged: { type: 'number' },
          totalLines: { type: 'number' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                lines: { type: 'number' },
                risk: { type: 'number' },
                changeType: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['path', 'lines', 'risk', 'changeType'],
            },
          },
          riskScore: { type: 'number' },
          maxFileRisk: { type: 'number' },
          hasCriticalPath: { type: 'boolean' },
        },
        required: ['filesChanged', 'totalLines', 'riskScore', 'maxFileRisk', 'hasCriticalPath'],
      },
    }
  )
} else {
  // 回退: 无 pre-check 数据时，agent 同时跑 diff + 分类
  sizing = await agent(
    `Run: git diff --stat --cached 2>/dev/null || git diff --stat 2>/dev/null

Then for EACH changed file, classify by:
1. Path pattern risk — which bucket the file falls into
2. Change type — inferred from file extension + what the diff lines suggest

## Risk bucket rules (this project only)

**Critical (weight=3):**
- gateway/*-proxy.mjs (API proxy, directly affects AI request forwarding)
- gateway/workflow-runner.mjs, gateway/workflow-child.mjs (process management/signals)
- gateway/index.mjs (main routing/WS/HTTP entrypoint)
- Any file touching: child_process, fork, spawn, exec

**High (weight=2):**
- gateway/*.mjs (general gateway logic)
- desktop-ui/src/views/*.vue (page-level components with business logic)
- desktop-ui/src/composables/*.ts (reactive/state management)
- desktop-ui/src/components/*.ts (component logic)

**Medium (weight=1.5):**
- desktop-ui/src/components/*.vue (UI components with some logic)
- Any .ts file with logic (not pure types)

**Low (weight=1):**
- desktop-ui/src/i18n.ts (pure translations)
- *.css, style files
- *.md, *.json config
- Type definition files (*.d.ts)

## Change type multiplier
- **new_logic (×1.5)**: new algorithm/function/control flow/error handling/state machine
- **modify (×1.0)**: change existing logic/params/conditions
- **refactor (×1.0)**: rename/extract function/structure adjustment
- **strings_only (×0.3)**: only strings/translations/copy/log text
- **config (×0.5)**: config values/env vars/constants
- **delete (×0.8)**: delete code

## Output

Return JSON:
{
  "filesChanged": 6,
  "totalLines": 120,
  "files": [
    {"path": "gateway/deepseek-proxy.mjs", "lines": 15, "risk": 3, "changeType": "modify", "reason": "API proxy logic change"},
    {"path": "desktop-ui/src/i18n.ts", "lines": 40, "risk": 1, "changeType": "strings_only", "reason": "translation text only"}
  ],
  "riskScore": 129.5,
  "maxFileRisk": 3,
  "hasCriticalPath": true
}

riskScore = sum(file.risk * file.lines * file.changeTypeMultiplier)
maxFileRisk = max(file.risk)
hasCriticalPath = any file.risk >= 3`,

    {
      label: 'risk-classify',
      phase: 'Size',
      modelTier: 'light',
      schema: {
        type: 'object',
        properties: {
          filesChanged: { type: 'number' },
          totalLines: { type: 'number' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                lines: { type: 'number' },
                risk: { type: 'number' },
                changeType: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['path', 'lines', 'risk', 'changeType'],
            },
          },
          riskScore: { type: 'number' },
          maxFileRisk: { type: 'number' },
          hasCriticalPath: { type: 'boolean' },
        },
        required: ['filesChanged', 'totalLines', 'riskScore', 'maxFileRisk', 'hasCriticalPath'],
      },
    }
  )
}

const s = sizing || {}
const { filesChanged = 0, totalLines = 0, riskScore = 0, maxFileRisk = 1, hasCriticalPath = false, files = [] } = s

// 分档: 风险评分 + 关键路径强制升级
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

// 关键路径少量改动: 至少 medium
if (hasCriticalPath && tier === 'small') tier = 'medium'

log(`变更: ${filesChanged} 文件, ${totalLines} 行 → 风险评分 ${riskScore}`)
log(`最高风险等级: ${maxFileRisk}, 关键路径: ${hasCriticalPath ? '是' : '否'}`)
log(`审查深度: ${tier.toUpperCase()}`)

// 打印每个文件的分类结果
for (const f of files) {
  log(`  ${f.path}: risk=${f.risk} × ${f.lines}lines × ${f.changeType} → "${f.reason}"`)
}

phase('Review')

if (tier === 'trivial') {
  log('Trivial 改动，跳过审查')
  return { tier, riskScore, findings: [], report: 'Trivial 改动 (风险评分 <30, 无关键路径)，跳过审查' }
}

if (tier === 'small') {
  // 动态 checklist: 只列出涉及风险域的项目
  const items = []
  if (files.some(f => f.path.includes('gateway/'))) {
    items.push('Gateway stream error/close 事件已处理')
    items.push('proxy 错误响应格式一致')
  }
  if (files.some(f => f.path.endsWith('.vue'))) {
    items.push('Vue 响应式: ref/reactive 变更在渲染前完成')
    items.push('v-if 切换组件生命周期无泄漏')
  }
  if (files.some(f => f.path.includes('i18n'))) {
    items.push('i18n key 不重复，已全部注册')
  }
  items.push('catch 块无空吞异常')
  items.push('无硬编码 IP/端口/API key')

  const report = `## Small 改动自查\n\n变更: ${filesChanged} 文件, ${totalLines} 行, 风险评分 ${riskScore}\n\n${items.map((c, i) => `- [ ] ${c}`).join('\n')}`

  log(report)
  return { tier, riskScore, findings: [], report }
}

// Medium: 单 Agent bugs 审查 (限定变更文件)
if (tier === 'medium') {
  const changedPaths = files.map(f => target + '/' + f.path)

  const finding = await agent(
    `只审查 bugs（空指针、未处理异常、竞态条件、状态不一致、资源泄漏）。不审查性能和安全。\n` +
    `变更文件:\n` + changedPaths.map((f, i) => `${i + 1}. ${f}`).join('\n'),
    {
      label: 'review:bugs',
      phase: 'Review',
      modelTier: 'balanced',
      schema: {
        type: 'object',
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                title: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['file', 'severity', 'title', 'description'],
            },
          },
        },
        required: ['findings'],
      },
    }
  )

  const findings = finding?.findings || []
  log(`Medium 审查完成: ${findings.length} 个问题`)
  return { tier, riskScore, findings, report: `Medium 审查: ${findings.length} 个问题` }
}

// Large: 完整 3 维度并行 + 对抗性验证
const DIMENSIONS = [
  { key: 'bugs', prompt: '潜在 bug: 空指针、未处理异常、竞态条件、边界条件错误、资源泄漏' },
  { key: 'security', prompt: '安全问题: 注入漏洞、敏感信息泄露、权限绕过、不安全加密、缺少输入校验' },
  { key: 'perf', prompt: '性能问题: 不必要分配、阻塞调用、N+1 查询、大对象拷贝、缺少缓存' },
]

const findings = await parallel(DIMENSIONS.map(d =>
  () => agent('审查 ' + target + ' 下的代码:\n' + d.prompt, {
    label: 'review:' + d.key, phase: 'Review',
    modelTier: 'power',
    schema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              title: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['file', 'severity', 'title', 'description'],
          },
        },
      },
      required: ['findings'],
    },
  })
))

const allFindings = findings.filter(Boolean).flatMap(f => f.findings || [])
log('初步发现 ' + allFindings.length + ' 个问题')

phase('Verify')
const verified = await parallel(allFindings.slice(0, 12).map(f =>
  () => agent('对抗性验证: 文件=' + f.file + ' 标题=' + f.title + ' 描述=' + f.description, {
    label: 'verify:' + f.file, phase: 'Verify',
    modelTier: 'power',
    schema: {
      type: 'object',
      properties: { isReal: { type: 'boolean' }, refuted: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['isReal'],
    },
  }).then(v => ({ ...f, verdict: v }))
))

const confirmed = verified.filter(Boolean).filter(f => f.verdict?.isReal)
log('确认 ' + confirmed.length + ' 个真实问题 (过滤 ' + (allFindings.length - confirmed.length) + ' 个误报)')

phase('Report')
const report = await agent('汇总审查发现为 Markdown 报告（中文，按严重程度分组）:\n' + JSON.stringify(confirmed, null, 2), {
  label: 'report', phase: 'Report',
  modelTier: 'power',
})

return { tier, riskScore, report, confirmed, totalFound: allFindings.length }
