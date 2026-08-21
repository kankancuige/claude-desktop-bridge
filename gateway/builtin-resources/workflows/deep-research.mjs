// ─── Deep Research ───
// 多角度检索 + 交叉核实 + 综合报告，适合陌生代码库调研、技术选型研究
export const meta = {
  name: 'deep-research',
  description: '多角度检索 + 交叉核实 + 综合报告，适合代码库调研/技术选型研究',
  phases: [
    { title: 'Search', detail: '多角度并行检索' },
    { title: 'Verify', detail: '交叉核实关键发现' },
    { title: 'Synthesize', detail: '综合报告' },
  ],
}

const topic = args.topic || args.task || '分析当前项目的架构和关键技术选型'
const ANGLES = [
  { key: 'structure', prompt: '分析目录结构和模块划分: ' + topic },
  { key: 'deps', prompt: '分析依赖关系和外部库: ' + topic },
  { key: 'patterns', prompt: '分析设计模式和编码约定: ' + topic },
  { key: 'risks', prompt: '识别技术风险和潜在问题: ' + topic },
]

phase('Search')
const results = await parallel(ANGLES.map(a =>
  () => agent(a.prompt, { label: 'search:' + a.key, phase: 'Search', agentType: 'Explore' })
))

const validResults = results.filter(Boolean)
log('检索完成: ' + validResults.length + '/' + ANGLES.length + ' 个角度')

// 交叉核实
phase('Verify')
const claims = validResults.join('\n').substring(0, 4000)
const verification = await agent('交叉核实以下多角度分析的矛盾点和关键结论，找出不一致之处:\n' + claims, {
  label: 'verify', phase: 'Verify',
  schema: { type:'object', properties:{ consistent:{type:'boolean'}, conflicts:{type:'array',items:{type:'string'}}, keyFindings:{type:'array',items:{type:'string'}} }, required:['consistent','keyFindings'] },
})

phase('Synthesize')
const report = await agent(
  '基于以下研究结果生成综合报告（中文 Markdown，含架构概览、关键发现、风险建议）:\n\n## 各角度分析\n' +
  validResults.map((r, i) => '### ' + ANGLES[i].key + '\n' + r.substring(0, 2000)).join('\n\n') +
  '\n\n## 交叉核实\n' + JSON.stringify(verification, null, 2),
  { label: 'synthesize', phase: 'Synthesize' }
)
return { report, keyFindings: verification?.keyFindings || [] }
