// workflow-runner.mjs — Claude Code 原生 Workflow 执行引擎
// 基于 Claude Code v2.1.88 泄露源码 + cc-fleet 架构逆向实现
// API: agent() / parallel() / pipeline() / phase() / log() / budget / args / meta
// 特性: vm 沙箱 | Journal/Resume | Schema 验证+重试 | Worktree 隔离 | Budget 硬上限 | 节点暂停/恢复 | effort 参数
import {createContext, runInContext} from 'node:vm'
import {createHash} from 'node:crypto'
import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync} from 'node:fs'
import {execSync} from 'node:child_process'
import {join} from 'node:path'
import {homedir, cpus} from 'node:os'
import {createLogger} from './logger.mjs'

const log = createLogger('workflow')

const CLAUDE_HOME = join(homedir(), '.claude')
const WF_DIR = join(CLAUDE_HOME, 'workflows')
const JOURNAL_DIR = join(CLAUDE_HOME, 'workflow-journals')
const WORKTREE_ROOT = join(CLAUDE_HOME, 'worktrees')
const CPU_COUNT = cpus().length
const MAX_PARALLEL = Math.max(4, Math.min(16, CPU_COUNT - 2))  // min(16, cpu-2) 对齐原生
const DEFAULT_MAX_TURNS = 15
const SCRIPT_TIMEOUT_MS = 600_000      // 脚本总超时 10 分钟
const AGENT_TIMEOUT_MS = 300_000       // 单 agent 超时 5 分钟

// ── Agent 类型注册表 ──
// 扫描 ~/.claude/agents/*.md 的 frontmatter，建立 {type} → [{name, language, exts}] 索引
// workflow 只需声明 agentType: 'reviewer'，系统根据项目语言自动匹配具体 agent
const AGENTS_DIR = join(CLAUDE_HOME, 'agents')

function parseAgentFrontmatter(content) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!m) return {}
    const fm = {}
    for (const l of m[1].split('\n')) {
        const col = l.indexOf(':')
        if (col > 0) {
            const k = l.slice(0, col).trim()
            let v = l.slice(col + 1).trim()
            // 解析数组值: ["a", "b"]
            if (v.startsWith('[') && v.endsWith(']')) {
                try {
                    v = JSON.parse(v)
                } catch {
                }
            }
            fm[k] = v
        }
    }
    return fm
}

// 构建 agent 注册表: { type: [{name, language, exts}] }
// 30 秒 TTL 缓存，避免每个 agent() 调用都读磁盘遍历 agents/ 目录
let _agentRegistryCache = null
let _agentRegistryCacheAt = 0
const AGENT_REGISTRY_CACHE_TTL = 30_000

function buildAgentRegistry() {
    if (_agentRegistryCache && (Date.now() - _agentRegistryCacheAt) < AGENT_REGISTRY_CACHE_TTL) {
        return _agentRegistryCache
    }
    const registry = {}
    try {
        if (!existsSync(AGENTS_DIR)) return registry
        for (const fn of readdirSync(AGENTS_DIR)) {
            if (!fn.endsWith('.md')) continue
            try {
                const content = readFileSync(join(AGENTS_DIR, fn), 'utf8')
                const fm = parseAgentFrontmatter(content)
                if (!fm.type) continue
                const entry = {
                    name: fm.name || fn.replace('.md', ''),
                    language: fm.language || '',
                    exts: Array.isArray(fm.exts) ? fm.exts : [],
                }
                if (!registry[fm.type]) registry[fm.type] = []
                registry[fm.type].push(entry)
            } catch {
            }
        }
    } catch {
    }
    _agentRegistryCache = registry
    _agentRegistryCacheAt = Date.now()
    return registry
}

// ── 根据项目文件扩展名检测语言 ──
function detectProjectLanguage(workDir) {
    const exts = {}
    try {
        const fs = {
            readdirSync, statSync: (p) => {
                try {
                    return require('fs').statSync(p)
                } catch {
                    return null
                }
            }
        }

        function walk(dir, depth) {
            if (depth > 3) return
            try {
                for (const e of readdirSync(dir)) {
                    if (e.startsWith('.') || e === 'node_modules' || e === 'target' || e === 'dist' || e === 'build') continue
                    const p = join(dir, e)
                    const st = fs.statSync(p)
                    if (!st) continue
                    if (st.isDirectory()) {
                        walk(p, depth + 1)
                    } else {
                        const ext = require('path').extname(e)
                        if (ext) exts[ext] = (exts[ext] || 0) + 1
                    }
                }
            } catch {
            }
        }

        walk(workDir, 0)
    } catch {
    }
    return exts
}

// ── 解析 agent type → 具体 agent name ──
// 1. 如果 requestedType 直接匹配某个 agent name → 返回（向后兼容）
// 2. 如果是 type 类别 → 扫描注册表，找出最匹配项目语言的 agent
// 3. 都匹配不到 → 'general-purpose'
function resolveAgentType(requestedType, workDir) {
    if (!requestedType || requestedType === 'general-purpose') return 'general-purpose'

    // 先用注册表查找
    const registry = buildAgentRegistry()

    // 直接名称匹配（向后兼容: 'java-reviewer' → 'java-reviewer'）
    for (const agents of Object.values(registry)) {
        if (agents.some(a => a.name === requestedType)) return requestedType
    }

    // 按 type 类别匹配
    const candidates = registry[requestedType]
    if (!candidates || candidates.length === 0) return 'general-purpose'

    // 只有一个候选 → 直接用
    if (candidates.length === 1) return candidates[0].name

    // 多个候选 → 检测项目语言匹配
    const langExts = detectProjectLanguage(workDir)
    let best = null, bestScore = 0
    for (const c of candidates) {
        let score = 0
        for (const ext of c.exts) {
            score += langExts[ext] || 0
        }
        if (score > bestScore) {
            bestScore = score;
            best = c
        }
    }
    return best ? best.name : candidates[0].name
}

const SCHEMA_MAX_RETRIES = 2           // Schema 验证失败重试次数

// ── 内置 Workflow 模板（启动时自动创建到 ~/.claude/workflows/） ──
// 7 个实战模式，模型根据任务特征自主选择
const BUILTIN_WORKFLOWS = {

    // ─── 1. 代码审查 — 最高频 ───
    'code-review.mjs': `// ─── Code Review ───
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

const target = args.path || args.target || process.cwd()

const DIMENSIONS = [
  { key: 'bugs', prompt: '潜在 bug: 空指针、未处理异常、竞态条件、边界条件错误、资源泄漏' },
  { key: 'security', prompt: '安全问题: 注入漏洞、敏感信息泄露、权限绕过、不安全加密、缺少输入校验' },
  { key: 'perf', prompt: '性能问题: 不必要分配、阻塞调用、N+1 查询、大对象拷贝、缺少缓存' },
]

phase('Scan')
log('审查目标: ' + target + ' (Agent: reviewer)')

phase('Review')
const findings = await parallel(DIMENSIONS.map(d =>
  () => agent('审查 ' + target + ' 下的代码:\\n' + d.prompt, {
    label: 'review:' + d.key, phase: 'Review', agentType: 'reviewer',
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
  () => agent('对抗性验证此发现是否真实存在。不存在则返回 refuted:true:\\n文件:' + f.file + '\\n标题:' + f.title + '\\n描述:' + f.description, {
    label: 'verify:' + f.file, phase: 'Verify',
    schema: { type:'object', properties:{ isReal:{type:'boolean'}, refuted:{type:'boolean'}, reason:{type:'string'} }, required:['isReal'] },
  }).then(v => ({ ...f, verdict: v }))
))

const confirmed = verified.filter(Boolean).filter(f => f.verdict?.isReal)
log('确认 ' + confirmed.length + ' 个真实问题 (过滤 ' + (allFindings.length - confirmed.length) + ' 个误报)')

phase('Report')
const report = await agent('汇总以下代码审查发现为 Markdown 报告（中文，按严重程度分组）:\\n' + JSON.stringify(confirmed, null, 2), {
  label: 'report', phase: 'Report',
})
return { report, confirmed, totalFound: allFindings.length, agentType: 'reviewer' }
`,

    // ─── 2. Bug 猎手 ───
    'bug-hunter.mjs': `// ─── Bug Hunter ───
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

const target = args.path || args.target || process.cwd()

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
  () => agent('在 ' + target + ' 中搜索:\\n' + a.prompt + '\\n只报告确信度高的真实 bug，返回 JSON', {
    label: 'hunt:' + a.key, phase: 'Hunt', agentType: 'reviewer',
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
  () => agent('尝试证伪以下 bug 报告，确认是否真正存在。如不存在返回 refuted:true:\\n文件:' + b.file + ':' + (b.line||'') + '\\n' + b.title + '\\n' + b.description, {
    label: 'verify:' + b.file, phase: 'Verify',
    schema: { type:'object', properties:{ confirmed:{type:'boolean'}, refuted:{type:'boolean'}, actualImpact:{type:'string'}, fixSuggestion:{type:'string'} }, required:['confirmed'] },
  }).then(v => ({ ...b, verdict: v }))
))

const realBugs = confirmed.filter(Boolean).filter(b => b.verdict?.confirmed)
log('确认 ' + realBugs.length + ' 个真实 bug (' + allBugs.length + ' 个原始报告)')

phase('Report')
return { bugs: realBugs, totalReported: allBugs.length, confirmedCount: realBugs.length, agentType: 'reviewer' }
`,

    // ─── 3. 评委面板 ───
    'judge-panel.mjs': `// ─── Judge Panel ───
// 多方案独立生成 → 并行评分 → 选优融合，适合架构选型/方案对比
export const meta = {
  name: 'judge-panel',
  description: '多方案独立生成 + 并行评分 + 优胜融合，适合架构选型/方案对比',
  phases: [
    { title: 'Draft', detail: '多角度独立生成方案' },
    { title: 'Judge', detail: '并行评分' },
    { title: 'Synthesize', detail: '融合最优方案' },
  ],
}

const problem = args.problem || args.task || '如何优化当前项目的构建速度?'
const ANGLES = [
  { key: 'mvp', prompt: '从最小可行方案出发（改动最少、风险最低）: ' + problem },
  { key: 'best', prompt: '从技术最优方案出发（不考虑迁移成本）: ' + problem },
  { key: 'pragmatic', prompt: '从实际可落地出发（平衡理想与现实）: ' + problem },
]

phase('Draft')
const drafts = await parallel(ANGLES.map(a =>
  () => agent(a.prompt, { label: 'draft:' + a.key, phase: 'Draft', model: 'sonnet' })
))
const validDrafts = drafts.filter(Boolean)

phase('Judge')
const scored = await parallel(validDrafts.map((d, i) =>
  () => agent('对以下方案从 1-10 分评分（可行性/风险/收益/可维护性）:\\n' + d, {
    label: 'judge:' + i, phase: 'Judge',
    schema: { type:'object', properties:{ feasibility:{type:'number'}, risk:{type:'number'}, benefit:{type:'number'}, maintainability:{type:'number'}, total:{type:'number'}, comment:{type:'string'} }, required:['feasibility','risk','benefit','total'] },
  }).then(s => ({ draft: d, score: s }))
))
scored.sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))
const winner = scored[0]
log('最优方案: #' + (winner?.score?.total || '?') + ' 分 — ' + (winner?.score?.comment || ''))

phase('Synthesize')
const others = scored.slice(1).map(s => '## 方案 (评分:' + (s.score?.total||0) + ')\\n' + s.draft).join('\\n---\\n')
const synthesis = await agent(
  '以最优方案为基础融合其他方案的优点，输出最终方案（中文）:\\n\\n## 最优方案\\n' + winner.draft + '\\n\\n## 其他方案\\n' + others,
  { label: 'synthesize', phase: 'Synthesize' }
)
return { synthesis, scores: scored.map(s => ({ angle: s.score?.comment?.substring(0,30), total: s.score?.total })) }
`,

    // ─── 4. 深度研究 ───
    'deep-research.mjs': `// ─── Deep Research ───
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
const claims = validResults.join('\\n').substring(0, 4000)
const verification = await agent('交叉核实以下多角度分析的矛盾点和关键结论，找出不一致之处:\\n' + claims, {
  label: 'verify', phase: 'Verify',
  schema: { type:'object', properties:{ consistent:{type:'boolean'}, conflicts:{type:'array',items:{type:'string'}}, keyFindings:{type:'array',items:{type:'string'}} }, required:['consistent','keyFindings'] },
})

phase('Synthesize')
const report = await agent(
  '基于以下研究结果生成综合报告（中文 Markdown，含架构概览、关键发现、风险建议）:\\n\\n## 各角度分析\\n' +
  validResults.map((r, i) => '### ' + ANGLES[i].key + '\\n' + r.substring(0, 2000)).join('\\n\\n') +
  '\\n\\n## 交叉核实\\n' + JSON.stringify(verification, null, 2),
  { label: 'synthesize', phase: 'Synthesize' }
)
return { report, keyFindings: verification?.keyFindings || [] }
`,

    // ─── 5. 生成-批评-修复 ───
    'generate-critic-fix.mjs': `// ─── Generate-Critic-Fix ───
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
var target = args.path || args.target || process.cwd()

phase('Scan')
log('目标: ' + target + ' (Critic Agent: reviewer)')

phase('Generate')
var impl = await agent('用 ' + language + ' 实现: ' + task + ' 输出完整的生产级代码。', {
  label: 'generate', phase: 'Generate', effort: 'high',
})

phase('Critic')
var SEARCHABLE = impl
var critics = await parallel([
  function(){ return agent('审查以下代码的正确性（逻辑/边界/异常处理），列出所有缺陷:\\n\\n' + SEARCHABLE, {
    label: 'critic:correctness', agentType: 'reviewer',
    schema: { type:'object', properties:{ defects:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},description:{type:'string'}},required:['severity','title','description']}}}, severity:{type:'string'} }, required:['defects'] },
  })},
  function(){ return agent('审查以下代码的安全性（注入/权限/敏感信息/输入校验）:\\n\\n' + SEARCHABLE, {
    label: 'critic:security', agentType: 'reviewer',
    schema: { type:'object', properties:{ defects:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},description:{type:'string'}},required:['severity','title','description']}}}, severity:{type:'string'} }, required:['defects'] },
  })},
])

var allDefects = critics.filter(Boolean).flatMap(function(c){ return c.defects || [] })
log('发现 ' + allDefects.length + ' 个缺陷')

if (allDefects.filter(function(d){ return d.severity === 'critical' || d.severity === 'high' }).length > 0) {
  log('检测到高危缺陷，需要修复')

  phase('Fix')
  var defectsStr = JSON.stringify(allDefects, null, 2)
  var fixed = await agent(
    '修复以下代码的所有缺陷。只输出修复后的完整代码，不要解释:\\n\\n## 原始代码\\n\\n' + SEARCHABLE + '\\n\\n## 缺陷列表\\n' + defectsStr,
    { label: 'fix', phase: 'Fix', effort: 'high' }
  )
  return { original: impl.substring(0, 500), fixed: fixed, defectCount: allDefects.length, criticalCount: allDefects.filter(function(d){ return d.severity === 'critical' }).length }
}

log('无高危缺陷，代码通过')
return { implementation: impl, defectCount: allDefects.length, verdict: 'passed' }
`,

    // ─── 6. 项目审计 ───
    'audit-sweep.mjs': `// ─── Audit Sweep ───
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
  () => agent('扫描 ' + target + ' 下的 ' + d.prompt + '\\n返回结构化发现列表', {
    label: 'scan:' + d.key, phase: 'Scan', agentType: agentTypeForDimension(d.key),
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
    () => agent('深度分析此问题的影响范围和修复方案:\\n' + JSON.stringify(c), {
      label: 'deep:' + i, phase: 'DeepDive',
      schema: { type:'object', properties:{ impact:{type:'string'}, effort:{type:'string',enum:['small','medium','large']}, recommendation:{type:'string'} }, required:['impact','recommendation'] },
    }).then(a => ({ issue: c, analysis: a }))
  ))
  deepAnalysis = deepAnalysis.filter(Boolean)
}

// 完整性检查
phase('Completeness')
const critic = await agent(
  '以下是对 ' + target + ' 的多维度审计结果。你是一个完整性审查者——还有哪些维度没覆盖？哪些文件/模块被遗漏？\\n\\n## 已有发现\\n' +
  JSON.stringify({ dimensions: DIMENSIONS.map(d => d.key), issueCount: allIssues.length, issues: allIssues.slice(0, 20) }, null, 2),
  { label: 'completeness', phase: 'Completeness',
    schema: { type:'object', properties:{ missedDimensions:{type:'array',items:{type:'string'}}, missedAreas:{type:'array',items:{type:'string'}}, completeness:{type:'number'} }, required:['completeness'] },
  }
)

log('完整性评估: ' + ((critic?.completeness || 0) * 100).toFixed(0) + '%')

phase('Report')
const report = await agent(
  '生成项目审计报告（中文 Markdown，含评分、TOP 问题、改进路线图）:\\n' +
  JSON.stringify({ target, totalIssues: allIssues.length, bySeverity: { critical: allIssues.filter(i => i.severity==='critical').length, high: allIssues.filter(i => i.severity==='high').length, medium: allIssues.filter(i => i.severity==='medium').length, low: allIssues.filter(i => i.severity==='low').length }, deepAnalysis: deepAnalysis.map(d => ({ issue: d.issue.title, impact: d.analysis?.impact, recommendation: d.analysis?.recommendation })), completeness: critic }, null, 2),
  { label: 'report', phase: 'Report' }
)
return { report, totalIssues: allIssues.length, completeness: critic?.completeness || 0, agentType: 'reviewer' }
`,

    // ─── 7. 通用编排 ───
    'default.mjs': `// ─── Default ───
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

const plan = await agent('将以下任务拆分为 2-4 个可独立并行执行的子任务，返回 JSON 数组:\\n' + task, {
  agentType: 'Plan', label: 'planner', model: 'sonnet',
  schema: {
    type: 'array', items: { type:'object', properties:{ id:{type:'string'}, title:{type:'string'}, agentType:{type:'string',enum:['Explore','general-purpose','code-reviewer','Plan']} }, required:['title','agentType'] },
  },
})

const subtasks = plan || []
log('计划: ' + subtasks.length + ' 个子任务')

phase('Execute')
const results = await parallel(subtasks.map(p =>
  () => agent(p.title, { agentType: p.agentType || 'general-purpose', label: p.id || 'task', model: 'sonnet', maxTurns: 10 })
))
const successCount = results.filter(Boolean).length
log('执行: ' + successCount + '/' + subtasks.length)

phase('Review')
const needsReview = results.filter(Boolean).slice(0, 6)
let verified = []
if (needsReview.length > 0) {
  const verdicts = await parallel(needsReview.map((r, i) =>
    () => agent('对抗性审查以下内容，找出问题或遗漏。正常返回{"ok":true}，有问题返回{"ok":false,"issues":["..."]}:\\n' + String(r).substring(0, 3000), {
      label: 'review:' + i,
      schema: { type:'object', properties:{ ok:{type:'boolean'}, issues:{type:'array',items:{type:'string'}} }, required:['ok'] },
    }).then(v => ({ output: r, verdict: v }))
  ))
  verified = verdicts.filter(Boolean)
  log('审查: ' + verified.filter(v => v.verdict && !v.verdict.ok).length + ' 项有问题/' + verified.length + ' 项已审查')
}

phase('Synthesize')
const summary = await agent(
  '汇总以下执行结果为简洁的 Markdown 报告（中文）:\\n\\n## 任务\\n' + task + '\\n\\n## 执行结果\\n' +
  results.filter(Boolean).map((r, i) => '### ' + (subtasks[i]?.title || '#'+i) + '\\n' + String(r).substring(0, 2000)).join('\\n\\n') +
  (verified.length > 0 ? '\\n\\n## 审查发现\\n' + verified.filter(v => v.verdict && !v.verdict.ok).map(v => '- ' + (v.verdict?.issues || []).join('\\n- ')).join('\\n') : ''),
  { label: 'synthesize', model: 'sonnet' }
)
return { summary, subtaskCount: subtasks.length, successCount, verifiedCount: verified.length }
`,
}

// ── 启动时确保内置模板存在（只创建不覆盖已有文件） ──
function bootstrapBuiltinWorkflows() {
    if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, {recursive: true})
    for (const [name, content] of Object.entries(BUILTIN_WORKFLOWS)) {
        const fp = join(WF_DIR, name)
        if (!existsSync(fp)) {
            try {
                writeFileSync(fp, content, 'utf8');
                log.info({name}, '内置模板已创建')
            } catch {
            }
        }
    }
}

bootstrapBuiltinWorkflows()

// ── 依赖注入（由 index.mjs 设置） ──
let _deps = null

function setDeps(d) {
    _deps = d
}

// ── 运行状态存储 ──
// _runStates key = wfId（每次执行唯一），防止同名并发互相覆盖
// _activeByName: name → wfId 映射，供 stop/state 等按名称 API 查找
const _runStates = new Map()       // wfId → { name, status, phases, logs, startedAt, wfId, ... }
const _activeByName = new Map()    // name → wfId（当前活跃/最近完成的）
const _pausedStates = new Map()    // name → 暂停时保存的快照，用于 resume
const _cleanupTimers = new Map()   // wfId → setTimeout id，workflow 终止后延迟清理

// 运行状态 TTL（毫秒），终端状态保留此时间后自动清理，给 UI 留查询窗口
const RUN_STATE_TTL_MS = 5 * 60 * 1000

function getRunState(nameOrWfId) {
    // 先按 wfId 查找，再按 name 查找最新活跃 wfId
    if (_runStates.has(nameOrWfId)) return _runStates.get(nameOrWfId)
    const wfId = _activeByName.get(nameOrWfId)
    return wfId ? (_runStates.get(wfId) || null) : null
}

function presetRunState(name) {
    const wfId = 'wf-' + name.replace(/\.\w+$/, '') + '-' + Date.now().toString(36)
    // 取消同名旧 wfId 的清理定时器
    const oldWfId = _activeByName.get(name)
    if (oldWfId) {
        const oldTimer = _cleanupTimers.get(oldWfId)
        if (oldTimer) { clearTimeout(oldTimer); _cleanupTimers.delete(oldWfId) }
    }
    _runStates.set(wfId, {name, status: 'starting', phases: [], logs: [], startedAt: Date.now(), wfId})
    _activeByName.set(name, wfId)
    return wfId
}

// 计划清理 runState —— workflow 终止（done/error）后延迟 RUN_STATE_TTL_MS 执行
function scheduleRunStateCleanup(wfId) {
    const existing = _cleanupTimers.get(wfId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
        const state = _runStates.get(wfId)
        if (state) {
            // 如果 _activeByName 仍指向此 wfId，清除
            if (_activeByName.get(state.name) === wfId) _activeByName.delete(state.name)
        }
        _runStates.delete(wfId)
        _cleanupTimers.delete(wfId)
    }, RUN_STATE_TTL_MS)
    _cleanupTimers.set(wfId, timer)
}

// ── Journal (内容哈希缓存，用于 resume) ──
function hashContent(prompt, opts = {}) {
    return createHash('sha256')
        .update(prompt + JSON.stringify(opts))
        .digest('hex').substring(0, 16)
}

function loadJournal(wfId) {
    const fp = join(JOURNAL_DIR, wfId + '.json')
    try {
        return existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : null
    } catch {
        return null
    }
}

function saveJournal(wfId, data) {
    if (!existsSync(JOURNAL_DIR)) mkdirSync(JOURNAL_DIR, {recursive: true})
    writeFileSync(join(JOURNAL_DIR, wfId + '.json'), JSON.stringify(data, null, 2), 'utf8')
}

function cleanupJournal(wfId) {
    try {
        const fp = join(JOURNAL_DIR, wfId + '.json');
        if (existsSync(fp)) unlinkSync(fp)
    } catch {
    }
}

// ── Git Worktree 隔离 ──
function createWorktree(projectDir, stepId, wfId) {
    if (!existsSync(WORKTREE_ROOT)) mkdirSync(WORKTREE_ROOT, {recursive: true})
    const wtDir = join(WORKTREE_ROOT, wfId, stepId)
    if (existsSync(wtDir)) {
        try {
            rmSync(wtDir, {recursive: true, force: true})
        } catch {
        }
    }

    let isGit = false
    try {
        execSync(`git -C "${projectDir}" rev-parse --git-dir`, {stdio: 'pipe', timeout: 5000})
        isGit = true
    } catch {
    }

    if (isGit) {
        try {
            execSync(`git -C "${projectDir}" worktree prune`, {stdio: 'pipe'})
            execSync(`git -C "${projectDir}" worktree add "${wtDir}" HEAD`, {stdio: 'pipe', timeout: 30000})
            return {dir: wtDir, isGit: true}
        } catch (e) {
            log.warn({err: e}, 'worktree 创建失败, 降级为直接目录')
        }
    }

    mkdirSync(wtDir, {recursive: true})
    return {dir: wtDir, isGit: false}
}

function cleanupWorktree(wtDir, projectDir) {
    try {
        if (existsSync(wtDir)) {
            try {
                execSync(`git -C "${projectDir}" worktree remove "${wtDir}" --force`, {stdio: 'pipe', timeout: 10000})
            } catch {
            }
            if (existsSync(wtDir)) rmSync(wtDir, {recursive: true, force: true})
        }
    } catch {
    }
}

// ── 文件系统操作 ──
function listWorkflows() {
    if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, {recursive: true})
    const list = []
    try {
        for (const fn of readdirSync(WF_DIR)) {
            if (!fn.endsWith('.mjs') && !fn.endsWith('.js')) continue
            const fp = join(WF_DIR, fn)
            const st = readFileSync(fp, 'utf8')
            const meta = parseMeta(st)
            list.push({name: fn, size: st.length, description: meta?.description || '', phases: meta?.phases || []})
        }
    } catch {
    }
    return list
}

function getWorkflow(name) {
    const fp = join(WF_DIR, name)
    if (!existsSync(fp)) return null
    try {
        return readFileSync(fp, 'utf8')
    } catch {
        return null
    }
}

function saveWorkflow(name, content) {
    if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, {recursive: true})
    writeFileSync(join(WF_DIR, name), content, 'utf8')
    return true
}

function deleteWorkflow(name) {
    const fp = join(WF_DIR, name)
    if (existsSync(fp)) {
        try {
            unlinkSync(fp)
        } catch {
        }
        ;
        return true
    }
    return false
}

// ── Meta 解析（括号计数法，正确处理嵌套对象如 phases [{...}]） ──
function findMetaEnd(src, startPos) {
    // startPos 指向 '{' 后面第一个字符，depth 从 1 开始（外层 { 已计入）
    let depth = 1, inStr = false, ch = '';
    for (let i = startPos; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === '\\') {
                i++;
                continue;
            }
            if (c === ch) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            ch = c;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            if (--depth === 0) return i;
        }
    }
    return -1;
}

function parseMeta(src) {
    const keyIdx = src.indexOf('export const meta = {');
    if (keyIdx === -1) return null;
    const openIdx = keyIdx + 21; // 'export const meta = {' = 21 字符
    const closeIdx = findMetaEnd(src, openIdx);
    if (closeIdx === -1) return null;

    // 安全提取：只用正则匹配已知字段，永不 eval/new Function
    const block = src.substring(openIdx - 1, closeIdx + 1); // 含外层 { }
    const meta = { name: '', description: '', phases: [] };

    const nameMatch = block.match(/name\s*:\s*['"]([^'"]*)['"]/);
    if (nameMatch) meta.name = nameMatch[1];

    const descMatch = block.match(/description\s*:\s*['"]([^'"]*)['"]/);
    if (descMatch) meta.description = descMatch[1];

    // 提取 phases 数组中的每个 {title, detail} 对象
    const phasesMatch = block.match(/phases\s*:\s*\[([\s\S]*?)\]/);
    if (phasesMatch) {
        const re = /\{[^}]*title\s*:\s*['"]([^'"]*)['"][^}]*detail\s*:\s*['"]([^'"]*)['"][^}]*\}/g;
        let m;
        while ((m = re.exec(phasesMatch[1])) !== null) {
            meta.phases.push({ title: m[1], detail: m[2] });
        }
    }

    return meta;
}

// ── Schema 验证 ──
function validateSchema(value, schema) {
    if (!schema) return {valid: true}
    if (schema.type === 'array' && !Array.isArray(value)) return {
        valid: false,
        error: '期望 array，实际 ' + typeof value
    }
    if (schema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) return {
        valid: false,
        error: '期望 object，实际 ' + typeof value
    }

    if (schema.required) {
        for (const field of schema.required) {
            if (value === null || value === undefined || !(field in value)) return {
                valid: false,
                error: '缺少必填字段: ' + field
            }
        }
    }
    if (schema.type === 'array' && schema.items && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const r = validateSchema(value[i], schema.items)
            if (!r.valid) return {valid: false, error: 'items[' + i + ']: ' + r.error}
        }
    }
    if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (key in value) {
                const r = validateSchema(value[key], propSchema)
                if (!r.valid) return {valid: false, error: key + ': ' + r.error}
            }
        }
    }
    if (schema.enum && !schema.enum.includes(value)) return {
        valid: false,
        error: '值不在允许范围: ' + JSON.stringify(schema.enum)
    }
    return {valid: true}
}

// ── 从 agent 输出中提取 JSON ──
function extractJSON(text) {
    if (!text || typeof text !== 'string') return null
    try {
        return JSON.parse(text)
    } catch {
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenced) {
        try {
            return JSON.parse(fenced[1])
        } catch {
        }
    }
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
        try {
            return JSON.parse(objMatch[0])
        } catch {
        }
    }
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
        try {
            return JSON.parse(arrMatch[0])
        } catch {
        }
    }
    return null
}

// ── 单个 agent() 执行（核心） ──
async function executeAgent(prompt, opts, workDir, broadcast, logFn, journalCache, wfId, budgetRef) {
    const {
        label, schema, model, phase: agentPhase, isolation,
        agentType: rawAgentType, maxTurns, permissionMode, effort,
    } = opts

    // 解析 agentType: 支持类别名('reviewer')和具体名('java-reviewer')两种写法
    const agentType = resolveAgentType(rawAgentType, workDir)

    const agLabel = label || 'agent'
    logFn('[Agent:' + agLabel + '] 启动' + (model ? ' (model=' + model + ')' : '')
        + (effort ? ' (effort=' + effort + ')' : '') + (isolation === 'worktree' ? ' [worktree]' : ''), agentPhase)

    // ── Budget 硬上限拦截 ──
    if (budgetRef && budgetRef.total && budgetRef.spent() >= budgetRef.total) {
        const err = new Error('BudgetExceeded: ' + budgetRef.spent() + ' >= ' + budgetRef.total)
        err.code = 'BUDGET_EXCEEDED'
        logFn('[Agent:' + agLabel + '] ' + err.message, agentPhase)
        throw err
    }

    // ── Journal cache 检查 ──
    const contentHash = hashContent(prompt, {agentType, model, schema, effort, isolation})
    if (journalCache && journalCache[contentHash]) {
        const cached = journalCache[contentHash]
        logFn('[Agent:' + agLabel + '] 从 Journal 缓存恢复 (' + cached.tokenSpent + ' tokens)', agentPhase)
        return cached.result
    }

    // ── Worktree 隔离 ──
    let wtDir = null
    let effectiveWorkDir = workDir
    if (isolation === 'worktree') {
        const stepId = agLabel.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32)
        const wt = createWorktree(workDir, stepId, wfId || 'wf')
        wtDir = wt.dir
        effectiveWorkDir = wtDir
        logFn('[Agent:' + agLabel + '] worktree: ' + wtDir, agentPhase)
    }

    // ── 创建子 session ──
    const sessionId = 'wf-agent-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    const pushStream = new _deps.PushStream()
    const cliSettings = _deps.loadCliSettings()

    // ── 构建 query options ──
    const modelOpts = {
        model: model || undefined,
        maxTurns: maxTurns || DEFAULT_MAX_TURNS,
        permissionMode: permissionMode || 'acceptEdits',
        _agentName: agentType || 'general-purpose',
        _depth: 1,
    }
    // effort 参数映射: low/medium/high/xhigh/max
    if (effort) modelOpts._effort = effort

    const queryOpts = await _deps.makeQueryOptions(modelOpts, effectiveWorkDir, cliSettings, {}, sessionId)

    // ── 启动 query ──
    const q = _deps.query({prompt: pushStream, options: queryOpts})
    pushStream.push({
        type: 'user', session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text: prompt}]},
        parent_tool_use_id: null,
    })

    // ── 流式读取 (带超时) ──
    let output = ''
    let usage = null
    let resolved = false

    const streamPromise = (async () => {
        try {
            for await (const sdkMsg of q) {
                if (resolved) break
                if (sdkMsg.type === 'assistant') {
                    for (const block of (sdkMsg.message?.content || [])) {
                        if (block.type === 'text' && block.text) output += block.text
                    }
                }
                if (sdkMsg.type === 'result') {
                    usage = sdkMsg.usage
                    output = sdkMsg.result || output
                    break
                }
            }
        } catch (e) {
            if (!resolved) output = 'Agent error: ' + e.message
        }
    })()

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Agent 超时 (' + AGENT_TIMEOUT_MS + 'ms)')), AGENT_TIMEOUT_MS)
    )

    try {
        await Promise.race([streamPromise, timeoutPromise])
    } catch (e) {
        output = 'Agent error: ' + e.message
        logFn('[Agent:' + agLabel + '] ' + e.message, agentPhase)
    } finally {
        resolved = true
    }

    // ── 清理 worktree ──
    if (wtDir) {
        try {
            cleanupWorktree(wtDir, workDir)
        } catch {
        }
    }

    const tokensUsed = usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0
    logFn('[Agent:' + agLabel + '] 完成 (' + output.length + ' 字符, ' + tokensUsed + ' tokens)', agentPhase)

    // ── Schema 验证 + 重试 ──
    let result = output
    if (schema) {
        let parsed = extractJSON(output)
        let retries = 0

        while (retries <= SCHEMA_MAX_RETRIES) {
            if (parsed) {
                const validation = validateSchema(parsed, schema)
                if (validation.valid) {
                    result = parsed;
                    break
                }
                logFn('[Agent:' + agLabel + '] Schema 验证失败 (' + validation.error + ')，重试 ' + (retries + 1) + '/' + SCHEMA_MAX_RETRIES, agentPhase)
            } else {
                logFn('[Agent:' + agLabel + '] 未提取到 JSON，重试 ' + (retries + 1) + '/' + SCHEMA_MAX_RETRIES, agentPhase)
            }
            if (retries >= SCHEMA_MAX_RETRIES) break

            const retryPrompt = prompt + '\n\n[IMPORTANT] You MUST output ONLY valid JSON matching: ' + JSON.stringify(schema)
                + (parsed ? '\nValidation error: ' + validateSchema(parsed, schema).error : '\nNo JSON found.')
            const retryResult = await executeAgent(retryPrompt, {
                label: agLabel + '-retry' + (retries + 1), agentType, model,
                maxTurns: Math.max(3, (maxTurns || DEFAULT_MAX_TURNS) - 5),
            }, workDir, broadcast, logFn, journalCache, wfId, budgetRef)
            parsed = extractJSON(typeof retryResult === 'string' ? retryResult : JSON.stringify(retryResult))
            retries++
        }
    }

    // ── 写 journal ──
    if (journalCache !== undefined) {
        journalCache[contentHash] = {
            result,
            tokenSpent: tokensUsed,
            timestamp: Date.now(),
            prompt: prompt.substring(0, 200),
            label: agLabel
        }
    }

    return result
}

// ── 暂停工作流 ──
function stopWorkflow(name) {
    const wfId = _activeByName.get(name)
    if (!wfId) return false
    const state = _runStates.get(wfId)
    if (!state || state.status !== 'running') return false
    // 保存快照供 resume
    _pausedStates.set(name, {
        name, status: 'paused', phases: state.phases, logs: state.logs,
        wfId: state.wfId, pausedAt: Date.now(),
        parentSid: state._parentSid, args: state._args, workDir: state._workDir,
        journalCache: state._journalCache, tokenSpent: state._tokenSpent,
        currentPhase: state._currentPhase,
    })
    state.status = 'paused'
    // 调用 _abort() 桥接闭包变量 aborted 和 state._aborted，确保 VM 沙箱内 agent()/parallel()/pipeline() 感知到暂停
    if (typeof state._abort === 'function') state._abort()
    else state._aborted = true  // 兜底：旧版本 runState 没有 _abort 方法
    return true
}

// ── 恢复工作流 ──
async function resumeWorkflow(name, parentSidOrNull) {
    const snapshot = _pausedStates.get(name)
    if (!snapshot) throw new Error('没有可恢复的暂停状态: ' + name)

    const parentSid = parentSidOrNull || snapshot.parentSid
    if (!parentSid) throw new Error('resume 需要 parentSessionId')

    const src = getWorkflow(name)
    if (!src) throw new Error('Workflow 脚本不存在: ' + name)

    // 从快照恢复，journal cache 原样保留
    return await _runWorkflowInternal(name, parentSid, snapshot.args || {}, {
        resumeJournal: snapshot.journalCache || {},
        resumeTokenSpent: snapshot.tokenSpent || 0,
        resumePhases: snapshot.phases || [],
        resumeLogs: snapshot.logs || [],
        resumePhase: snapshot.currentPhase || '',
    })
}

// ── Internal: 执行 Workflow 脚本 ──
async function _runWorkflowInternal(name, parentSid, extraArgs, resumeState = null) {
    const src = getWorkflow(name)
    if (!src) throw new Error('Workflow 脚本不存在: ' + name)

    const meta = parseMeta(src)
    const s = _deps.sessions.get(parentSid)
    const workDir = resumeState?.workDir || s?.workDir || process.cwd()
    // 复用 presetRunState 分配的 wfId，未预设则生成并注册
    let wfId = _activeByName.get(name)
    if (!wfId) {
        wfId = 'wf-' + name.replace(/\.\w+$/, '') + '-' + Date.now().toString(36)
        _activeByName.set(name, wfId)   // 注册以支持后续 stop/state 按名称查找
    }

    // ── 状态变量 ──
    let currentPhase = resumeState?.resumePhase || ''
    let tokenSpent = resumeState?.resumeTokenSpent || 0
    const phases = resumeState?.resumePhases || []
    const logs = resumeState?.resumeLogs || []
    const journalCache = resumeState?.resumeJournal || {}
    let aborted = false

    // ── 广播辅助 ──
    const _broadcast = (msg) => {
        if (_deps.broadcast) _deps.broadcast(parentSid, msg)
    }

    const logFn = (msg, ph) => {
        const phaseName = ph || currentPhase
        logs.push({time: Date.now(), phase: phaseName, msg})
        _broadcast({type: 'workflow_log', workflowId: wfId, phase: phaseName, message: msg, logs: logs.slice(-50)})
    }

    // ── Budget 对象 (共享引用，agent 调用前检查) ──
    const budgetMax = extraArgs?.budgetMax || null
    const budgetRef = {
        total: budgetMax,
        spent: () => tokenSpent,
        remaining: () => budgetMax ? Math.max(0, budgetMax - tokenSpent) : Infinity,
    }
    const budget = {
        total: budgetMax,
        spent: () => tokenSpent,
        remaining: () => budgetMax ? Math.max(0, budgetMax - tokenSpent) : Infinity,
    }

    // ── Sandbox 全局: phase(title) ──
    const phase = (title) => {
        if (currentPhase) {
            const prev = phases.find(p => p.title === currentPhase)
            if (prev && prev.status === 'running') prev.status = 'done'
        }
        currentPhase = title
        const exists = phases.find(p => p.title === title)
        if (!exists) {
            phases.push({title, status: 'running', startedAt: Date.now()})
        } else {
            exists.status = 'running'
        }
        _broadcast({type: 'workflow_phase', workflowId: wfId, phase: title, phases: [...phases]})
        logFn('[Phase] ' + title, title)
        // 每个 phase 切换时持久化 journal
        saveJournal(wfId, {
            name,
            phases: [...phases],
            logs: logs.slice(-200),
            tokenSpent,
            journalCache,
            currentPhase: title,
            savedAt: Date.now()
        })
    }

    // ── Sandbox 全局: log(msg) ──
    const log = (msg) => {
        logFn(String(msg))
    }

    // ── Sandbox 全局: agent(prompt, opts) ──
    const agent = async (prompt, opts = {}) => {
        // 检查暂停信号
        if (aborted) throw new Error('WorkflowAborted: 工作流已被暂停')

        const {phase: agentPhase} = opts
        if (agentPhase && agentPhase !== currentPhase) phase(agentPhase)

        const result = await executeAgent(prompt, opts, workDir, _broadcast, logFn, journalCache, wfId, budgetRef)

        // 更新 token 统计
        const h = hashContent(prompt, {
            agentType: opts.agentType,
            model: opts.model,
            schema: opts.schema,
            effort: opts.effort,
            isolation: opts.isolation
        })
        if (journalCache[h]) tokenSpent += journalCache[h].tokenSpent

        return result
    }

    // ── Sandbox 全局: parallel(thunks) ──
    const parallel = async (thunks) => {
        if (!Array.isArray(thunks) || thunks.length === 0) return []
        logFn('[Parallel] 并行执行 ' + thunks.length + ' 个任务')
        const results = []
        for (let i = 0; i < thunks.length; i += MAX_PARALLEL) {
            if (aborted) throw new Error('WorkflowAborted: 工作流已被暂停')
            const batch = thunks.slice(i, i + MAX_PARALLEL)
            const batchResults = await Promise.all(batch.map((fn, bi) =>
                fn().catch(e => {
                    // BudgetExceeded 向上抛，其他异常返回 null
                    if (e.code === 'BUDGET_EXCEEDED') throw e
                    logFn('[Parallel #' + (i + bi) + '] 异常: ' + e.message)
                    return null
                })
            ))
            results.push(...batchResults)
        }
        logFn('[Parallel] 完成: ' + results.filter(Boolean).length + '/' + thunks.length + ' 成功')
        return results
    }

    // ── Sandbox 全局: pipeline(items, ...stages) ──
    const pipeline = async (items, ...stages) => {
        if (!Array.isArray(items) || items.length === 0) return []
        if (stages.length === 0) return items
        logFn('[Pipeline] ' + items.length + ' 项 x ' + stages.length + ' 阶段')
        const results = new Array(items.length)
        await Promise.all(items.map(async (item, idx) => {
            try {
                let val = item
                for (let si = 0; si < stages.length; si++) {
                    if (aborted) throw new Error('WorkflowAborted')
                    try {
                        val = await stages[si](val, item, idx)
                    } catch (stageErr) {
                        if (stageErr.code === 'BUDGET_EXCEEDED') throw stageErr
                        logFn('[Pipeline 项' + idx + ' 阶段' + si + '] 异常: ' + stageErr.message)
                        val = null;
                        break
                    }
                }
                results[idx] = val
            } catch (e) {
                if (e.code === 'BUDGET_EXCEEDED') throw e
                logFn('[Pipeline 项' + idx + '] 异常: ' + e.message)
                results[idx] = null
            }
        }))
        return results
    }

    // ── Sandbox 全局: args ──
    const args = {...(extraArgs || {})}

    // ── 受控 setTimeout / clearTimeout（上限 + 自动清理，防止 VM 沙箱泄露） ──
    const MAX_PENDING_TIMERS = 10
    const _pendingTimers = new Set()

    function safeSetTimeout(fn, delay) {
        if (typeof delay !== 'number' || delay < 0) delay = 0
        if (_pendingTimers.size >= MAX_PENDING_TIMERS) {
            logFn('[Warn] setTimeout 已达上限(' + MAX_PENDING_TIMERS + ')，调用被忽略')
            return -1
        }
        const id = setTimeout(() => {
            _pendingTimers.delete(id)
            try { fn() } catch (e) { logFn('[Error] setTimeout 回调异常: ' + e.message) }
        }, Math.min(delay, 30000)) // 单次最长 30s
        _pendingTimers.add(id)
        return id
    }

    function safeClearTimeout(id) {
        if (id === undefined || id === null) return
        clearTimeout(id)
        _pendingTimers.delete(id)
    }

    function cleanupAllTimers() {
        for (const id of _pendingTimers) clearTimeout(id)
        _pendingTimers.clear()
    }

    // ── 构建 VM 沙箱 ──
    const sandbox = {
        agent, parallel, pipeline, phase, log, budget, args, meta,
        console: {
            log: (...a) => logFn(a.map(String).join(' ')),
            error: (...a) => logFn('[Error] ' + a.map(String).join(' ')),
            warn: (...a) => logFn('[Warn] ' + a.map(String).join(' ')),
        },
        setTimeout: safeSetTimeout, clearTimeout: safeClearTimeout,
        Promise, JSON, Array, Object, String, Number, Boolean,
        Math, Date, Error, RegExp, Map, Set,
        parseInt, parseFloat, isNaN, isFinite,
        encodeURIComponent, decodeURIComponent,
    }

    // ── 脚本 AST 转换 ──
    let scriptBody = src;
    const metaKeyIdx = src.indexOf('export const meta = {');
    if (metaKeyIdx !== -1) {
        const openIdx = metaKeyIdx + 21;
        const closeIdx = findMetaEnd(src, openIdx);
        if (closeIdx !== -1) {
            // 去掉 meta 块（含末尾的 ; 或换行）
            let end = closeIdx + 1;
            while (end < src.length && (src[end] === ';' || src[end] === '\n' || src[end] === '\r')) end++;
            scriptBody = src.substring(0, metaKeyIdx) + src.substring(end);
        }
    }
    scriptBody = scriptBody.replace(/export\s+/g, '')

    const wrappedScript = `
    (async () => {
      try { ${scriptBody} }
      catch (_wfError) {
        if (_wfError.code === 'BUDGET_EXCEEDED') {
          console.warn('Budget 已用尽: ' + _wfError.message);
          throw _wfError;
        }
        console.error('Workflow script error: ' + (_wfError?.message || _wfError));
        throw _wfError;
      }
    })()
  `

    // ── 初始化运行状态 ──
    const runState = {
        name, status: 'running', phases: meta?.phases || [], logs: [],
        startedAt: resumeState?.startedAt || Date.now(), wfId,
        _parentSid: parentSid, _args: extraArgs, _workDir: workDir,
        _aborted: false, _journalCache: journalCache, _tokenSpent: tokenSpent,
        _currentPhase: currentPhase,
    }
    // 暴露 abort 控制（必须在 _runStates.set 之前定义，防止 stopWorkflow 竞态拿到没有 _abort 的 state）
    runState._abort = () => {
        aborted = true;
        runState._aborted = true
    }
    _runStates.set(wfId, runState)

    const syncRunState = () => {
        runState.logs = logs.slice(-100)
        runState.phases = phases.length > 0 ? [...phases]
            : (meta?.phases || []).map(p => ({...p, status: p.title === currentPhase ? 'running' : 'pending'}))
        runState._currentPhase = currentPhase
    }
    const origLogFn = logFn
    const enhancedLog = (msg, ph) => {
        origLogFn(msg, ph);
        syncRunState()
    }
    sandbox.log = (msg) => {
        enhancedLog(String(msg))
    }

    const isResume = !!resumeState
    _broadcast({
        type: isResume ? 'workflow_resumed' : 'workflow_started',
        workflowId: wfId, name,
        phases: meta?.phases || [],
        resume: isResume,
    })
    enhancedLog(isResume ? '[Workflow] 恢复: ' + name + ' (' + tokenSpent + ' tokens 已用)' : '[Workflow] 开始: ' + name)

    const context = createContext(sandbox)

    try {
        const result = await runInContext(wrappedScript, context, {
            timeout: SCRIPT_TIMEOUT_MS,
            displayErrors: true,
        })

        // 成功完成
        if (currentPhase) {
            const last = phases.find(p => p.title === currentPhase)
            if (last && last.status === 'running') last.status = 'done'
        }

        runState.status = 'done'
        runState.result = result
        runState.phases = phases.length > 0 ? [...phases] : (meta?.phases || []).map(p => ({...p, status: 'done'}))
        runState.tokenSpent = tokenSpent

        _broadcast({
            type: 'workflow_done', workflowId: wfId, name,
            result: typeof result === 'string' ? result.substring(0, 2000) : (result ? JSON.stringify(result).substring(0, 2000) : ''),
            logs: logs.slice(-100), tokenSpent,
        })

        enhancedLog('[Workflow] 完成: ' + name + ' (' + tokenSpent + ' tokens)')

        // 推结果回主 session
        if (s?.pushStream) {
            const preview = typeof result === 'string' ? result.substring(0, 4000)
                : (result ? JSON.stringify(result, null, 2).substring(0, 4000) : '(无输出)')
            s.pushStream.push({
                type: 'user', session_id: parentSid,
                message: {role: 'user', content: [{type: 'text', text: '[Workflow "' + name + '" 完成]\n' + preview}]},
                parent_tool_use_id: null,
            })
        }

        // 保存 journal + 清理暂停快照 + 安排 runState 延迟清理
        if (Object.keys(journalCache).length > 0) saveJournal(wfId, {
            name,
            phases: [...phases],
            logs: logs.slice(-200),
            tokenSpent,
            journalCache,
            currentPhase,
            savedAt: Date.now()
        })
        _pausedStates.delete(name)
        scheduleRunStateCleanup(wfId)

        cleanupAllTimers()
        return result
    } catch (e) {
        // 区分暂停 vs 真实错误
        if (aborted || e.message?.includes('WorkflowAborted')) {
            runState.status = 'paused'
            runState.phases = phases.length > 0 ? [...phases] : (meta?.phases || []).map(p => ({
                ...p,
                status: p.title === currentPhase ? 'running' : 'pending'
            }))
            runState.tokenSpent = tokenSpent
            saveJournal(wfId, {
                name,
                phases: [...phases],
                logs: logs.slice(-200),
                tokenSpent,
                journalCache,
                currentPhase,
                savedAt: Date.now(),
                paused: true
            })
            _broadcast({type: 'workflow_paused', workflowId: wfId, name, tokenSpent, logs: logs.slice(-50)})
            enhancedLog('[Workflow] 已暂停: ' + name)
            cleanupAllTimers()
            // 不抛异常，静默返回
            return {paused: true, tokenSpent, phases: [...phases]}
        }

        runState.status = 'error'
        runState.error = e.message
        _broadcast({type: 'workflow_error', workflowId: wfId, name, error: e.message, logs: logs.slice(-50)})
        enhancedLog('[Workflow] 错误: ' + e.message)

        // 即使出错也保存 journal 用于 debug
        if (Object.keys(journalCache).length > 0) saveJournal(wfId, {
            name,
            error: e.message,
            tokenSpent,
            journalCache,
            savedAt: Date.now()
        })
        _pausedStates.delete(name)
        scheduleRunStateCleanup(wfId)
        cleanupAllTimers()
        throw e
    }
}

// ── 公共 API: runWorkflow ──
async function runWorkflow(name, parentSid, extraArgs) {
    return await _runWorkflowInternal(name, parentSid, extraArgs, null)
}

export {
    setDeps,
    listWorkflows,
    getWorkflow,
    saveWorkflow,
    deleteWorkflow,
    runWorkflow,
    parseMeta,
    getRunState,
    presetRunState,
    stopWorkflow,
    resumeWorkflow,
}
