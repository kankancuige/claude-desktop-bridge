// ─── Default ───
// 通用多阶段编排: Plan → Execute → Review → Synthesize
export const meta = {
  name: 'default',
  description: '通用多阶段编排: 分析任务 → 拆分子任务 → 并行执行 → 审查 → 汇总',
  phases: [
    { title: 'Plan', detail: '分析任务并生成执行计划' },
    { title: 'Execute', detail: '并行执行子任务' },
    { title: 'Review', detail: '对抗性验证执行结果' },
    { title: 'Synthesize', detail: '汇总最终输出' },
  ],
}

const task = args.task || '分析当前项目的代码结构和关键文件'

phase('Plan')
log('开始: ' + task + (budget.total ? ' (预算: ' + budget.total + ' tokens)' : ''))

const plan = await agent('将以下任务拆分为 2-4 个可独立并行执行的子任务，返回 JSON 数组:\n' + task, {
  agentType: 'Plan', label: 'planner', modelTier: 'power',
  schema: {
    type: 'array', items: { type:'object', properties:{ id:{type:'string'}, title:{type:'string'}, agentType:{type:'string',enum:['Explore','general-purpose','code-reviewer','Plan']} }, required:['title','agentType'] },
  },
})

const subtasks = plan || []
log('计划: ' + subtasks.length + ' 个子任务')

phase('Execute')
const results = await parallel(subtasks.map(p =>
  () => agent(p.title, { agentType: p.agentType || 'general-purpose', label: p.id || 'task', modelTier: 'balanced', maxTurns: 10 })
))
const successCount = results.filter(Boolean).length
log('执行: ' + successCount + '/' + subtasks.length)

phase('Review')
const needsReview = results.filter(Boolean).slice(0, 6)
let verified = []
if (needsReview.length > 0) {
  const verdicts = await parallel(needsReview.map((r, i) =>
    () => agent('对抗性审查以下内容，找出问题或遗漏。正常返回{"ok":true}，有问题返回{"ok":false,"issues":["..."]}:\n' + String(r).substring(0, 3000), {
      label: 'review:' + i,
      schema: { type:'object', properties:{ ok:{type:'boolean'}, issues:{type:'array',items:{type:'string'}} }, required:['ok'] },
    }).then(v => ({ output: r, verdict: v }))
  ))
  verified = verdicts.filter(Boolean)
  log('审查: ' + verified.filter(v => v.verdict && !v.verdict.ok).length + ' 项有问题/' + verified.length + ' 项已审查')
}

phase('Synthesize')
const summary = await agent(
  '汇总以下执行结果为简洁的 Markdown 报告（中文）:\n\n## 任务\n' + task + '\n\n## 执行结果\n' +
  results.filter(Boolean).map((r, i) => '### ' + (subtasks[i]?.title || '#'+i) + '\n' + String(r).substring(0, 2000)).join('\n\n') +
  (verified.length > 0 ? '\n\n## 审查发现\n' + verified.filter(v => v.verdict && !v.verdict.ok).map(v => '- ' + (v.verdict?.issues || []).join('\n- ')).join('\n') : ''),
  { label: 'synthesize', modelTier: 'power' }
)
return { summary, subtaskCount: subtasks.length, successCount, verifiedCount: verified.length }
