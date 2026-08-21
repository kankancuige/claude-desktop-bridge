// ─── Bug Hunter ───
// 猎手找 bug + 证伪者逐条反驳，适合发版前排查、重构后验证
// 自动检测项目语言，路由到语言专用 Agent
export const meta = {
  name: 'bug-hunter',
  description: '猎手搜索潜在 bug + 证伪者逐条验证，自动路由到语言专用 Agent',
  phases: [
    { title: 'Scan', detail: '检测语言' },
    { title: 'Hunt', detail: '多角度搜索潜在 bug' },
    { title: 'Verify', detail: '证伪者逐条验证' },
    { title: 'Report', detail: '输出确认的 bug 清单' },
  ],
}

// Workflow 子进程不暴露 process；目标目录只能由 Gateway 受控注入。
const target = args.path || args.target || '.'

const ANGLES = [
  { key: 'logic', prompt: '逻辑错误: 条件判断错误、循环边界、状态机缺陷、死代码' },
  { key: 'async', prompt: '异步/并发问题: race condition、死锁、未处理的 Promise、回调时序' },
  { key: 'memory', prompt: '内存问题: 泄漏、未释放资源、大对象常驻、循环引用' },
  { key: 'edge', prompt: '边界/异常: null/undefined、除零、空集合、超长输入、特殊字符' },
]

phase('Scan')
log('搜寻目标: ' + target + ' (Agent: reviewer)')

phase('Hunt')
const bugs = await parallel(ANGLES.map(a =>
  () => agent('在 ' + target + ' 中搜索:\n' + a.prompt + '\n只报告确信度高的真实 bug，返回 JSON', {
    label: 'hunt:' + a.key, phase: 'Hunt', agentType: 'reviewer', modelTier: 'balanced',
    schema: {
      type: 'object', properties: { bugs: { type:'array', items:{ type:'object', properties:{ file:{type:'string'},line:{type:'number'},title:{type:'string'},confidence:{type:'string',enum:['high','medium']},description:{type:'string'} }, required:['file','title','confidence','description'] } } },
      required: ['bugs'],
    },
  })
))

const allBugs = bugs.filter(Boolean).flatMap(b => b.bugs || [])
log('猎手发现 ' + allBugs.length + ' 个可疑 bug')

// 证伪者逐条验证
phase('Verify')
const confirmed = await parallel(allBugs.slice(0, 10).map(b =>
  () => agent('尝试证伪以下 bug 报告，确认是否真正存在。如不存在返回 refuted:true:\n文件:' + b.file + ':' + (b.line||'') + '\n' + b.title + '\n' + b.description, {
    label: 'verify:' + b.file, phase: 'Verify', modelTier: 'power',
    schema: { type:'object', properties:{ confirmed:{type:'boolean'}, refuted:{type:'boolean'}, actualImpact:{type:'string'}, fixSuggestion:{type:'string'} }, required:['confirmed'] },
  }).then(v => ({ ...b, verdict: v }))
))

const realBugs = confirmed.filter(Boolean).filter(b => b.verdict?.confirmed)
log('确认 ' + realBugs.length + ' 个真实 bug (' + allBugs.length + ' 个原始报告)')

phase('Report')
return { bugs: realBugs, totalReported: allBugs.length, confirmedCount: realBugs.length, agentType: 'reviewer' }
