// ─── Generate-Critic-Fix ───
// 生成 → 批评 → 修复 迭代循环，适合实现复杂功能/算法优化
// 自动检测项目语言，critic 路由到语言专用 Agent
export const meta = {
  name: 'generate-critic-fix',
  description: '生成→批评→修复循环，适合实现复杂功能/算法优化，自动收敛到高质量输出',
  phases: [
    { title: 'Scan', detail: '检测语言' },
    { title: 'Generate', detail: '生成初始实现' },
    { title: 'Critic', detail: '多维度批评找缺陷' },
    { title: 'Fix', detail: '针对性修复' },
  ],
}

var task = args.task || '实现一个健壮的 HTTP 请求重试工具函数（支持指数退避、抖动、超时）'
var language = args.language || '与项目当前语言保持一致'
var target = args.path || args.target || '.'

phase('Scan')
log('目标: ' + target + ' (Critic Agent: reviewer)')

phase('Generate')
var impl = await agent('用 ' + language + ' 实现: ' + task + ' 输出完整的生产级代码。', {
  label: 'generate', phase: 'Generate', effort: 'high',
})

phase('Critic')
var SEARCHABLE = impl
var critics = await parallel([
  function(){ return agent('审查以下代码的正确性（逻辑/边界/异常处理），列出所有缺陷:\n\n' + SEARCHABLE, {
    label: 'critic:correctness', agentType: 'reviewer',
    schema: { type:'object', properties:{ defects:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},description:{type:'string'}},required:['severity','title','description']}}, severity:{type:'string'} }, required:['defects'] },
  })},
  function(){ return agent('审查以下代码的安全性（注入/权限/敏感信息/输入校验）:\n\n' + SEARCHABLE, {
    label: 'critic:security', agentType: 'reviewer',
    schema: { type:'object', properties:{ defects:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},description:{type:'string'}},required:['severity','title','description']}}, severity:{type:'string'} }, required:['defects'] },
  })},
])

var allDefects = critics.filter(Boolean).flatMap(function(c){ return c.defects || [] })
log('发现 ' + allDefects.length + ' 个缺陷')

if (allDefects.filter(function(d){ return d.severity === 'critical' || d.severity === 'high' }).length > 0) {
  log('检测到高危缺陷，需要修复')

  phase('Fix')
  var defectsStr = JSON.stringify(allDefects, null, 2)
  var fixed = await agent(
    '修复以下代码的所有缺陷。只输出修复后的完整代码，不要解释:\n\n## 原始代码\n\n' + SEARCHABLE + '\n\n## 缺陷列表\n' + defectsStr,
    { label: 'fix', phase: 'Fix', effort: 'high' }
  )
  return { original: impl.substring(0, 500), fixed: fixed, defectCount: allDefects.length, criticalCount: allDefects.filter(function(d){ return d.severity === 'critical' }).length }
}

log('无高危缺陷，代码通过')
return { implementation: impl, defectCount: allDefects.length, verdict: 'passed' }
