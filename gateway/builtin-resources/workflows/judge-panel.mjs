// ─── Judge Panel ───
// Explore(单 agent 读代码) → Draft(三路并行出方案，共享同一份分析) → Judge(评分) → Synthesize(融合)
export const meta = {
  name: 'judge-panel',
  description: '探索代码 → 三角度出方案 → 评分 → 融合，代码只读一次',
  phases: [
    { title: 'Explore', detail: '单 agent 读取并分析代码' },
    { title: 'Draft', detail: '三路并行出方案（共享分析结果）' },
    { title: 'Judge', detail: '并行评分' },
    { title: 'Synthesize', detail: '融合最优方案' },
  ],
}

const problem = args.problem || args.task || '如何优化当前项目的构建速度?'

// Phase 1: 单个 agent 探索代码库，输出结构化分析（只读一次）
phase('Explore')
const codeAnalysis = await agent(
  '探索当前项目，输出一份结构化的代码分析（中文），供后续方案设计使用。\n' +
  '需覆盖: 1)涉及的关键文件和模块 2)现有的架构/模式/依赖关系 3)变更的风险点和约束 4)代码规模和复杂度估算。\n' +
  '只做分析，不要提方案。输出纯文本即可，不要 JSON。',
  { label: 'explore', phase: 'Explore', agentType: 'Explore' }
)
log('代码分析完成 (' + codeAnalysis.length + ' 字符)')

// Phase 2: 三路并行出方案，共享同一份 Explore 结果，不再各自读文件
const ANGLES = [
  { key: 'mvp', prompt: '从最小可行方案出发（改动最少、风险最低）: ' + problem },
  { key: 'best', prompt: '从技术最优方案出发（不考虑迁移成本）: ' + problem },
  { key: 'pragmatic', prompt: '从实际可落地出发（平衡理想与现实）: ' + problem },
]

phase('Draft')
const drafts = await parallel(ANGLES.map(a =>
  () => agent(
    a.prompt + '\n\n## 代码分析（已提前完成，直接使用，不要再读文件）\n' + codeAnalysis,
    { label: 'draft:' + a.key, phase: 'Draft', modelTier: 'power' }
  )
))
const validDrafts = drafts.filter(Boolean)

phase('Judge')
const scored = await parallel(validDrafts.map((d, i) =>
  () => agent('对以下方案从 1-10 分评分（可行性/风险/收益/可维护性）:\n' + d, {
    label: 'judge:' + i, phase: 'Judge',
    schema: { type:'object', properties:{ feasibility:{type:'number'}, risk:{type:'number'}, benefit:{type:'number'}, maintainability:{type:'number'}, total:{type:'number'}, comment:{type:'string'} }, required:['feasibility','risk','benefit','total'] },
  }).then(s => ({ draft: d, score: s }))
))
scored.sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))
const winner = scored[0]
log('最优方案: #' + (winner?.score?.total || '?') + ' 分 — ' + (winner?.score?.comment || ''))

phase('Synthesize')
const others = scored.slice(1).map(s => '## 方案 (评分:' + (s.score?.total||0) + ')\n' + s.draft).join('\n---\n')
const synthesis = await agent(
  '以最优方案为基础融合其他方案的优点，输出最终方案（中文）:\n\n## 最优方案\n' + winner.draft + '\n\n## 其他方案\n' + others,
  { label: 'synthesize', phase: 'Synthesize' }
)
return { synthesis, scores: scored.map(s => ({ angle: s.score?.comment?.substring(0,30), total: s.score?.total })) }
