// workflow-runner.mjs — Claude Code 原生 Workflow 执行引擎
// 基于 Claude Code v2.1.88 泄露源码 + cc-fleet 架构逆向实现
// API: agent() / parallel() / pipeline() / phase() / log() / budget / args / meta
// 特性: 独立子进程 + 受限 node:vm context | Journal/Resume | Schema 验证+重试 | Worktree 隔离 | Budget 硬上限 | 节点暂停/恢复 | effort 参数
import {createHash} from 'node:crypto'
import {assertWorkflowAgentModel, inferWorkflowAgentTier, resolveWorkflowAgentModel, resolveWorkflowPermissionMode} from './workflow-model-routing.mjs'
import {buildAgentRuntimeMetadata} from '../agents/agent-runtime-metadata.mjs'
import {createAgentDispatcher} from '../agents/agent-dispatcher.mjs'
import {createAgentRegistry} from '../agents/agent-registry.mjs'
import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync, statSync, mkdtempSync} from 'node:fs'
import {execFileSync, fork} from 'node:child_process'
import {join, extname, dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {AsyncLocalStorage} from 'node:async_hooks'
import {createLogger} from '../shared/logger.mjs'
import {safeBasename} from '../security/path-security.mjs'
import {sanitizeWorktreeSegment} from '../shared/worktree-path.mjs'
import {getCurrentSessionWorkflow, sortSessionWorkflows} from '../tasks/task-lifecycle.mjs'
import {taskWorkflowResultMarker} from '../tasks/task-workflow-gate.mjs'
import {requirementsForAgentStart} from '../agents/agent-capabilities.mjs'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'
import {BUILTIN_RESOURCE_ROOT, getBuiltinResourceState} from '../config/builtin-resources.mjs'

const log = createLogger('workflow')

const __dirname = dirname(fileURLToPath(import.meta.url))
const WF_DIR = join(BRIDGE_HOME, 'workflows')
const JOURNAL_DIR = join(BRIDGE_HOME, 'workflow-journals')
const WORKTREE_ROOT = join(BRIDGE_HOME, 'worktrees')
const DEFAULT_MAX_TURNS = 15
const SCRIPT_TIMEOUT_MS = 1_200_000    // 脚本总超时 20 分钟
const AGENT_TIMEOUT_MS = 600_000       // 单 agent 超时 10 分钟
const MAX_WORKFLOW_SCRIPT_BYTES = 1024 * 1024
const HISTORY_FILE = join(BRIDGE_HOME, 'bridge-workflow-history.jsonl')
const MAX_HISTORY_ENTRIES = 500

async function cleanupWorkflowAgentSession({
    deleteSession,
    removeSdkSessionId,
    workDir,
    gatewaySessionId,
    sdkSessionId,
}) {
    if (!deleteSession || !sdkSessionId) return {deleted: false, mappingRemoved: false}

    // SDK 的 dir 与 listSessions 一致，必须传项目工作目录。
    await deleteSession(sdkSessionId, {dir: workDir})
    const mappingRemoved = removeSdkSessionId
        ? removeSdkSessionId(workDir, gatewaySessionId, sdkSessionId) !== false
        : false
    return {deleted: true, mappingRemoved}
}

// ── Agent 类型注册表 ──
// 扫描 Bridge 私有 agents/*.md 的 frontmatter，建立 {type} → [{name, language, exts}] 索引
// workflow 只需声明 agentType: 'reviewer'，系统根据项目语言自动匹配具体 agent
const AGENTS_DIR = join(BRIDGE_HOME, 'agents')

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
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
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
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
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
                    return statSync(p)
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
                        const ext = extname(e)
                        if (ext) exts[ext] = (exts[ext] || 0) + 1
                    }
                }
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }

        walk(workDir, 0)
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
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

// ── 内置 Workflow 模板（启动时自动创建到 ~/.claude-desktop-bridge/workflows/） ──
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

const target = args.path || args.target || '.'

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
    label: 'review:' + d.key, phase: 'Review', agentType: 'reviewer', modelTier: 'power',
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
    label: 'verify:' + f.file, phase: 'Verify', modelTier: 'power',
    schema: { type:'object', properties:{ isReal:{type:'boolean'}, refuted:{type:'boolean'}, reason:{type:'string'} }, required:['isReal'] },
  }).then(v => ({ ...f, verdict: v }))
))

const confirmed = verified.filter(Boolean).filter(f => f.verdict?.isReal)
log('确认 ' + confirmed.length + ' 个真实问题 (过滤 ' + (allFindings.length - confirmed.length) + ' 个误报)')

phase('Report')
const report = await agent('汇总以下代码审查发现为 Markdown 报告（中文，按严重程度分组）:\\n' + JSON.stringify(confirmed, null, 2), {
  label: 'report', phase: 'Report', modelTier: 'power',
})
return { report, confirmed, totalFound: allFindings.length, agentType: 'reviewer' }
`,
    'final-review.mjs': `// ─── Final Review Gate ───
export const meta = { name:'final-review', description:'按父任务风险执行一次定向最终门禁审查', phases:[{title:'Review',detail:'检查本轮真实变更'},{title:'Verify',detail:'仅证伪高风险候选项'}] }
const target=args.target||'.'
const tier=args.reviewTier==='power'?'power':'balanced'
const mode=args.reviewMode==='gate'?'gate':'focused'
const files=Array.isArray(args.files)?args.files.slice(0,80):[]
const domains=Array.isArray(args.riskDomains)&&args.riskDomains.length?args.riskDomains.slice(0,8):['correctness']
if(files.length===0)return {passed:true,findings:[],summary:'没有真实文件差异，跳过最终审查',tier}
phase('Review')
const review=await agent('只审查本轮列出的变更文件，不扫描整个仓库，不修改文件。允许读取这些文件的直接调用方和直接依赖以判断回归，但问题必须定位到变更文件，不能把未修改模块扩展成审查对象。\\n目标目录: '+target+'\\n审查模式: '+mode+'\\n风险域: '+domains.join(', ')+'\\n变更文件:\\n'+files.map((f,i)=>(i+1)+'. '+f.path+' ('+(f.lines||1)+' lines)').join('\\n')+'\\n只报告能用当前代码证据确认的真实问题。critical/high 默认 blocking；medium/low 默认 advisory。',{label:'final-review',agentType:'reviewer',phase:'Review',modelTier:tier,schema:{type:'object',properties:{findings:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},blocking:{type:'boolean'},title:{type:'string'},description:{type:'string'},file:{type:'string'},line:{type:'number'},suggestion:{type:'string'}},required:['severity','title','description','file']}},summary:{type:'string'}},required:['findings','summary']}})
let findings=review?.findings||[]
const candidates=findings.filter(i=>i.blocking===true||i.severity==='critical'||i.severity==='high').slice(0,8)
if(tier==='power'&&candidates.length>0){phase('Verify');const verified=await parallel(candidates.map((finding,index)=>()=>agent('尝试证伪以下最终审查发现，只根据可定位代码证据判断:\\n'+JSON.stringify(finding),{label:'verify:'+index,agentType:'reviewer',phase:'Verify',modelTier:'power',schema:{type:'object',properties:{isReal:{type:'boolean'},reason:{type:'string'}},required:['isReal','reason']}}).then(verdict=>({finding,verdict}))));const realKeys=new Set(verified.filter(i=>i?.verdict?.isReal).map(i=>i.finding.file+'\\0'+i.finding.title));findings=findings.filter(i=>!(i.blocking===true||i.severity==='critical'||i.severity==='high')||realKeys.has(i.file+'\\0'+i.title))}
const blocking=findings.filter(i=>i.blocking===true||i.severity==='critical'||i.severity==='high')
return {passed:blocking.length===0,findings,summary:blocking.length>0?'最终审查发现 '+blocking.length+' 个阻断问题':(review?.summary||'最终审查通过'),tier}
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
  () => agent('在 ' + target + ' 中搜索:\\n' + a.prompt + '\\n只报告确信度高的真实 bug，返回 JSON', {
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
  () => agent('尝试证伪以下 bug 报告，确认是否真正存在。如不存在返回 refuted:true:\\n文件:' + b.file + ':' + (b.line||'') + '\\n' + b.title + '\\n' + b.description, {
    label: 'verify:' + b.file, phase: 'Verify', modelTier: 'power',
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
  '探索当前项目，输出一份结构化的代码分析（中文），供后续方案设计使用。\\n' +
  '需覆盖: 1)涉及的关键文件和模块 2)现有的架构/模式/依赖关系 3)变更的风险点和约束 4)代码规模和复杂度估算。\\n' +
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
    a.prompt + '\\n\\n## 代码分析（已提前完成，直接使用，不要再读文件）\\n' + codeAnalysis,
    { label: 'draft:' + a.key, phase: 'Draft', modelTier: 'power' }
  )
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
  function(){ return agent('审查以下代码的正确性（逻辑/边界/异常处理），列出所有缺陷:\\n\\n' + SEARCHABLE, {
    label: 'critic:correctness', agentType: 'reviewer',
    schema: { type:'object', properties:{ defects:{type:'array',items:{type:'object',properties:{severity:{type:'string',enum:['critical','high','medium','low']},title:{type:'string'},description:{type:'string'}},required:['severity','title','description']}}, severity:{type:'string'} }, required:['defects'] },
  })},
  function(){ return agent('审查以下代码的安全性（注入/权限/敏感信息/输入校验）:\\n\\n' + SEARCHABLE, {
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

const target = args.path || args.target || '.'

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
    () => agent('深度分析此问题的影响范围和修复方案:\\n' + JSON.stringify(c), {
      label: 'deep:' + i, phase: 'DeepDive', modelTier: 'power',
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
  { label: 'completeness', phase: 'Completeness', modelTier: 'power',
    schema: { type:'object', properties:{ missedDimensions:{type:'array',items:{type:'string'}}, missedAreas:{type:'array',items:{type:'string'}}, completeness:{type:'number'} }, required:['completeness'] },
  }
)

log('完整性评估: ' + ((critic?.completeness || 0) * 100).toFixed(0) + '%')

phase('Report')
const report = await agent(
  '生成项目审计报告（中文 Markdown，含评分、TOP 问题、改进路线图）:\\n' +
  JSON.stringify({ target, totalIssues: allIssues.length, bySeverity: { critical: allIssues.filter(i => i.severity==='critical').length, high: allIssues.filter(i => i.severity==='high').length, medium: allIssues.filter(i => i.severity==='medium').length, low: allIssues.filter(i => i.severity==='low').length }, deepAnalysis: deepAnalysis.map(d => ({ issue: d.issue.title, impact: d.analysis?.impact, recommendation: d.analysis?.recommendation })), completeness: critic }, null, 2),
  { label: 'report', phase: 'Report', modelTier: 'power' }
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
  { label: 'synthesize', modelTier: 'power' }
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
                const bundledPath = join(BUILTIN_RESOURCE_ROOT, 'workflows', name)
                writeFileSync(fp, existsSync(bundledPath) ? readFileSync(bundledPath, 'utf8') : content, 'utf8');
                log.info({name}, '内置模板已创建')
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }
    }
}

bootstrapBuiltinWorkflows()

// ── 依赖注入（由 index.mjs 设置） ──
const workflowDepsStorage = new AsyncLocalStorage()
const EMPTY_WORKFLOW_DEPS = Object.freeze({})

function activeDeps() {
    return workflowDepsStorage.getStore() || EMPTY_WORKFLOW_DEPS
}

/** 为 HTTP、自动触发和测试提供隔离的 Workflow 依赖实例。 */
export function createWorkflowRuntime(deps = {}) {
    const invoke = (fn, args) => workflowDepsStorage.run(deps, () => fn(...args))
    return Object.freeze({
        listWorkflows: (...args) => invoke(listWorkflows, args),
        getWorkflow: (...args) => invoke(getWorkflow, args),
        saveWorkflow: (...args) => invoke(saveWorkflow, args),
        deleteWorkflow: (...args) => invoke(deleteWorkflow, args),
        runWorkflow: (...args) => invoke(runWorkflow, args),
        getRunState: (...args) => invoke(getRunState, args),
        getSessionWorkflowState: (...args) => invoke(getSessionWorkflowState, args),
        getSessionWorkflowStates: (...args) => invoke(getSessionWorkflowStates, args),
        presetRunState: (...args) => invoke(presetRunState, args),
        stopWorkflow: (...args) => invoke(stopWorkflow, args),
        stopWorkflowAgent: (...args) => invoke(stopWorkflowAgent, args),
        resumeWorkflowAgent: (...args) => invoke(resumeWorkflowAgent, args),
        resumeWorkflow: (...args) => invoke(resumeWorkflow, args),
        commitWorkflow: (...args) => invoke(commitWorkflow, args),
        queryHistory: (...args) => invoke(queryHistory, args),
    })
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

function persistWorkflowProjection(wfId, state) {
    const deps = activeDeps()
    const store = typeof deps?.workflowRepository === 'function' ? deps.workflowRepository() : deps?.workflowRepository
    if (!store?.available || !state?._workDir) return
    try {
        const projectKey = deps?.encodeProjectName?.(state._workDir)
        if (!projectKey) return
        const revision = Math.max(1, Number(state._revision || 0) + 1)
        state._revision = revision
        const phases = Array.isArray(state.phases) ? state.phases.slice(-50) : []
        const persist = store.upsert || store.upsertWorkflowState
        persist.call(store, {
            projectKey,
            workflowId: wfId,
            parentSessionId: state._parentSid || null,
            name: state.name,
            status: state.status,
            currentPhase: state._currentPhase || phases.find(item => item.status === 'running')?.title || null,
            tokenSpent: state._tokenSpent || state.tokenSpent || 0,
            startedAt: state.startedAt,
            endedAt: state.endedAt || null,
            revision,
            state: {
                wfId, name: state.name, status: state.status, phases,
                currentPhase: state._currentPhase || null,
                tokenSpent: state._tokenSpent || state.tokenSpent || 0,
                startedAt: state.startedAt, endedAt: state.endedAt || null,
                runKey: state.runKey || state.name,
                taskOwned: state._args?._taskOwned === true,
                returnsToParent: state._args?._returnToParent !== false,
            },
        })
    } catch (error) {
        log.warn({err: error, workflowId: wfId}, 'Workflow PostgreSQL 状态投影保存失败，保留 JSON journal')
    }
}

function restoreSessionWorkflowStates(sessionId) {
    const deps = activeDeps()
    const session = deps?.sessions?.get?.(sessionId)
    const store = typeof deps?.workflowRepository === 'function' ? deps.workflowRepository() : deps?.workflowRepository
    if (!session?.workDir || !store?.available) return
    let rows = []
    try {
        const projectKey = deps?.encodeProjectName?.(session.workDir)
        if (!projectKey) return
        rows = store.list
            ? store.list({projectKey, parentSessionId: sessionId, limit: 100})
            : store.listWorkflowStates(projectKey, {parentSessionId: sessionId, limit: 100})
    } catch (error) {
        log.warn({err: error, sessionId: String(sessionId).slice(0, 8)}, '恢复 Workflow PostgreSQL 状态失败')
        return
    }
    for (const row of rows) {
        if (!row?.workflowId || _runStates.has(row.workflowId)) continue
        if (!['starting', 'running', 'paused'].includes(row.status)
            && Date.now() - Number(row.updatedAt || 0) > RUN_STATE_TTL_MS) continue
        const projected = row.state && typeof row.state === 'object' ? row.state : {}
        const wasAlive = ['starting', 'running'].includes(row.status)
        const status = wasAlive ? 'paused' : row.status
        const runKey = projected.runKey || `${row.name}:${sessionId}`
        const journal = loadJournal(row.workflowId) || {}
        const phases = Array.isArray(journal.phases) && journal.phases.length
            ? journal.phases
            : Array.isArray(projected.phases) ? projected.phases : []
        const state = {
            name: row.name,
            runKey,
            status,
            phases,
            logs: Array.isArray(journal.logs) ? journal.logs.slice(-100) : [],
            startedAt: row.startedAt || projected.startedAt || Date.now(),
            endedAt: status === 'paused' ? null : row.endedAt || projected.endedAt || null,
            wfId: row.workflowId,
            tokenSpent: Number(journal.tokenSpent ?? row.tokenSpent ?? projected.tokenSpent) || 0,
            _parentSid: sessionId,
            _workDir: session.workDir,
            _currentPhase: journal.currentPhase || row.currentPhase || projected.currentPhase || '',
            _tokenSpent: Number(journal.tokenSpent ?? row.tokenSpent ?? projected.tokenSpent) || 0,
            _revision: Number(row.revision || 0),
            _args: journal.args && typeof journal.args === 'object'
                ? journal.args
                : {_taskOwned: projected.taskOwned === true, _returnToParent: projected.returnsToParent !== false, _runKey: runKey},
            _journalCache: journal.journalCache && typeof journal.journalCache === 'object' ? journal.journalCache : {},
            _countedKeys: new Set(journal._countedKeys || []),
            _agentAborts: new Map(),
            _agentHandles: new Map(),
            _pausedAgents: new Map(),
            _aborted: status === 'paused',
        }
        _runStates.set(row.workflowId, state)
        _activeByName.set(runKey, row.workflowId)
        if (status === 'paused') {
            _pausedStates.set(runKey, {
                name: row.name, runKey, status, phases, logs: state.logs,
                wfId: row.workflowId, pausedAt: Date.now(), parentSid: sessionId,
                args: state._args, workDir: session.workDir, journalCache: state._journalCache,
                tokenSpent: state._tokenSpent, currentPhase: state._currentPhase,
                _countedKeys: [...state._countedKeys],
            })
        }
        if (wasAlive) persistWorkflowProjection(row.workflowId, state)
    }
}

function getRunState(nameOrWfId) {
    // 先按 wfId 查找，再按 name 查找最新活跃 wfId
    let state = _runStates.has(nameOrWfId) ? _runStates.get(nameOrWfId) : null
    if (!state) {
        const wfId = _activeByName.get(nameOrWfId)
        state = wfId ? (_runStates.get(wfId) || null) : null
    }
    if (!state) return null
    // 转换 _pausedAgents Map → 可序列化数组
    const pausedAgents = state._pausedAgents
        ? [...state._pausedAgents.entries()].map(([label, info]) => ({label, pausedAt: info.pausedAt}))
        : []
    return {...state, pausedAgents}
}

function presetRunState(name, runKey = name, parentSid = null) {
    const oldWfId = _activeByName.get(runKey)
    const oldState = oldWfId ? _runStates.get(oldWfId) : null
    if (oldState && (oldState.status === 'starting' || oldState.status === 'running')) {
        const error = new Error('Workflow 已在运行')
        error.code = 'WORKFLOW_ALREADY_RUNNING'
        throw error
    }
    const safeName = sanitizeWorktreeSegment(name.replace(/\.\w+$/, ''), 'workflow')
    const wfId = `wf-${safeName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    // 取消同名旧 wfId 的清理定时器
    if (oldWfId) {
        const oldTimer = _cleanupTimers.get(oldWfId)
        if (oldTimer) { clearTimeout(oldTimer); _cleanupTimers.delete(oldWfId) }
    }
    _runStates.set(wfId, {
        name, runKey, status: 'starting', phases: [], logs: [], startedAt: Date.now(), wfId,
        _parentSid: parentSid || null,
    })
    _activeByName.set(runKey, wfId)
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
            const runKey = state.runKey || state.name
            if (_activeByName.get(runKey) === wfId) _activeByName.delete(runKey)
        }
        _runStates.delete(wfId)
        _cleanupTimers.delete(wfId)
        cleanupJournal(wfId)
    }, RUN_STATE_TTL_MS)
    timer.unref?.()
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
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
}

// ── 执行历史 (JSONL 持久化) ──
const MAX_HISTORY_AGE_MS = 30 * 24 * 3600 * 1000  // 30 天，超过自动清理
const HISTORY_TRIM_MARGIN = 100  // 超出上限 100 条时才裁剪，减少频繁重写

let _historyLineCount = 0  // 上次裁剪后的行数缓存

function appendHistory(record) {
    try {
        writeFileSync(HISTORY_FILE, JSON.stringify(record) + '\n', {flag: 'a'})
        _historyLineCount++
        // 超出上限 + 缓冲区间时才裁剪，避免每条都重写全文件
        if (_historyLineCount > MAX_HISTORY_ENTRIES + HISTORY_TRIM_MARGIN) {
            const content = readFileSync(HISTORY_FILE, 'utf8')
            const lines = content.trim().split('\n')
            // 按时间清理: 超过 MAX_HISTORY_AGE_MS 的条目删除
            const cutoff = Date.now() - MAX_HISTORY_AGE_MS
            const fresh = lines.filter(l => {
                try {
                    const r = JSON.parse(l)
                    return r.endedAt && r.endedAt > cutoff
                } catch { return false }
            })
            // 保留最近 MAX_HISTORY_ENTRIES 条
            const kept = fresh.slice(-MAX_HISTORY_ENTRIES)
            writeFileSync(HISTORY_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8')
            _historyLineCount = kept.length
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
}

function queryHistory(limit = 50) {
    try {
        if (!existsSync(HISTORY_FILE)) return []
        const content = readFileSync(HISTORY_FILE, 'utf8')
        return content.trim().split('\n').filter(Boolean)
            .slice(-limit).reverse()
            .map(l => { try { return JSON.parse(l) } catch { return null } })
            .filter(Boolean)
    } catch {
        return []
    }
}

// ── Git Worktree 隔离 ──
function createWorktree(projectDir, stepId, wfId) {
    if (!existsSync(WORKTREE_ROOT)) mkdirSync(WORKTREE_ROOT, {recursive: true})
    const wtDir = join(WORKTREE_ROOT, sanitizeWorktreeSegment(wfId, 'wf'), sanitizeWorktreeSegment(stepId, 'agent'))
    if (existsSync(wtDir)) {
        try {
            rmSync(wtDir, {recursive: true, force: true})
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }

    let isGit = false
    try {
        execFileSync('git', ['-C', projectDir, 'rev-parse', '--git-dir'], {stdio: 'pipe', timeout: 5000})
        isGit = true
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }

    if (!isGit) {
        const error = new Error('worktree 隔离仅支持 Git 仓库')
        error.code = 'WORKTREE_UNAVAILABLE'
        throw error
    }

    try {
        execFileSync('git', ['-C', projectDir, 'worktree', 'prune'], {stdio: 'pipe', timeout: 10_000})
        execFileSync('git', ['-C', projectDir, 'worktree', 'add', wtDir, 'HEAD'], {stdio: 'pipe', timeout: 30_000})
        return {dir: wtDir, isGit: true}
    } catch (cause) {
        cleanupWorktree(wtDir, projectDir)
        const error = new Error('worktree 创建失败，已拒绝在空目录或原项目中降级执行', {cause})
        error.code = 'WORKTREE_CREATE_FAILED'
        throw error
    }
}

function cleanupWorktree(wtDir, projectDir) {
    try {
        if (existsSync(wtDir)) {
            try {
                execFileSync('git', ['-C', projectDir, 'worktree', 'remove', wtDir, '--force'], {stdio: 'pipe', timeout: 10_000})
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            if (existsSync(wtDir)) rmSync(wtDir, {recursive: true, force: true})
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
}

// ── 文件系统操作 ──
function listWorkflows() {
    if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, {recursive: true})
    const list = []
    const builtinStates = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'workflow')
    try {
        for (const fn of readdirSync(WF_DIR)) {
            if (!fn.endsWith('.mjs') && !fn.endsWith('.js')) continue
            const resourceId = fn.replace(/\.(?:mjs|js)$/, '')
            const builtin = builtinStates.find(item => item.id === resourceId)
            const fp = join(WF_DIR, fn)
            const st = readFileSync(fp, 'utf8')
            const meta = parseMeta(st)
            list.push({
                name: fn,
                size: st.length,
                description: meta?.description || '',
                phases: meta?.phases || [],
                source: builtin ? 'builtin' : 'custom',
                enabled: builtin?.enabled ?? true,
                customized: builtin?.customized ?? false,
                required: builtin?.required ?? false,
            })
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    return list
}

function getWorkflow(name) {
    const builtinStates = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'workflow')
    // 先尝试原名称，再尝试追加 .mjs / .js 扩展名
    for (const candidate of [name, name + '.mjs', name + '.js']) {
        const resourceId = candidate.replace(/\.(?:mjs|js)$/, '')
        const builtin = builtinStates.find(item => item.id === resourceId)
        if (builtin && !builtin.enabled) continue
        const fp = safeBasename(WF_DIR, candidate, {extensions: ['.mjs', '.js']})
        if (!fp) continue
        if (!existsSync(fp)) continue
        try {
            return readFileSync(fp, 'utf8')
        } catch {
            return null
        }
    }
    return null
}

function saveWorkflow(name, content) {
    validateWorkflowContent(content)
    if (!existsSync(WF_DIR)) mkdirSync(WF_DIR, {recursive: true})
    const fp = safeBasename(WF_DIR, name, {extensions: ['.mjs', '.js']})
    if (!fp) throw new Error('非法 Workflow 文件名')
    writeFileSync(fp, content, 'utf8')
    return true
}

function validateWorkflowContent(content) {
    if (typeof content !== 'string' || content.trim().length === 0) {
        const error = new Error('Workflow 内容不能为空')
        error.code = 'WORKFLOW_SCRIPT_INVALID'
        throw error
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_SCRIPT_BYTES) {
        const error = new Error('Workflow 脚本不能超过 1MB')
        error.code = 'WORKFLOW_SCRIPT_TOO_LARGE'
        throw error
    }
    return content
}

function deleteWorkflow(name) {
    const fp = safeBasename(WF_DIR, name, {extensions: ['.mjs', '.js']})
    if (!fp) return false
    if (existsSync(fp)) {
        try {
            unlinkSync(fp)
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
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
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenced) {
        try {
            return JSON.parse(fenced[1])
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
        try {
            return JSON.parse(objMatch[0])
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
        try {
            return JSON.parse(arrMatch[0])
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }
    return null
}

// ── 单个 agent() 执行（核心） ──
async function executeAgent(prompt, opts, workDir, broadcast, logFn, journalCache, wfId, budgetRef, abortedRef, _cacheKey = null, _agentAborts = null, _agentHandles = null) {
    const {
        label, schema, model, modelTier, phase: agentPhase, isolation,
        agentType: rawAgentType, maxTurns, permissionMode, effort,
    } = opts

    // 解析 agentType: 支持类别名('reviewer')和具体名('java-reviewer')两种写法
    const agentType = resolveAgentType(rawAgentType, workDir)

    const agLabel = label || 'agent'
    // 提取任务摘要: 首行截断到 100 字符，去掉换行
    const taskSummary = (prompt || '').replace(/[\r\n]+/g, ' ').trim().substring(0, 100)
    logFn('[Agent:' + agLabel + '] 启动 | ' + taskSummary
        + (agentType ? ' (type=' + agentType + ')' : '')
        + (model ? ' (model=' + model + ')' : '')
        + (effort ? ' (effort=' + effort + ')' : '')
        + (isolation === 'worktree' ? ' [worktree]' : ''), agentPhase)

    // ── Budget 硬上限拦截 ──
    if (budgetRef && budgetRef.total) {
        const spent = budgetRef.spent()
        if (spent >= budgetRef.total) {
            const err = new Error('BudgetExceeded: ' + spent + ' >= ' + budgetRef.total)
            err.code = 'BUDGET_EXCEEDED'
            logFn('[Agent:' + agLabel + '] ' + err.message, agentPhase)
            throw err
        }
        // Budget margin 估算: 剩余预算不足预估消耗时告警
        const remaining = budgetRef.total - spent
        const remainingTurns = opts.maxTurns || maxTurns || DEFAULT_MAX_TURNS
        const estimatedCost = 2000 * remainingTurns  // 每轮估算 2000 tokens
        if (remaining < estimatedCost) {
            logFn('[Agent:' + agLabel + '] 预算紧张: 剩余 ' + remaining + ' tokens, ' + remainingTurns + ' turns 预估消耗 ' + estimatedCost, agentPhase)
        }
    }

    // ── Journal cache 检查 ──
    const contentHash = hashContent(prompt, {agentType, model, schema, effort, isolation})
    if (journalCache && journalCache[contentHash]) {
        const cached = journalCache[contentHash]
        // TTL 过期检查: 超过配置时间则视为失效，重新执行
        const ttlMs = (activeDeps()?.loadWfConfig?.()?.journalCacheTTL || 30) * 60 * 1000
        if (cached.timestamp && (Date.now() - cached.timestamp) < ttlMs) {
            logFn('[Agent:' + agLabel + '] 从 Journal 缓存恢复 (' + cached.tokenSpent + ' tokens)', agentPhase)
            return cached.result
        }
        logFn('[Agent:' + agLabel + '] Journal 缓存已过期，重新执行', agentPhase)
        delete journalCache[contentHash]
    }

    const sessionId = 'wf-agent-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

    // ── Worktree 隔离 ──
    let wtDir = null
    let effectiveWorkDir = workDir
    if (isolation === 'worktree') {
        const labelPart = agLabel.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 24) || 'agent'
        const stepId = `${labelPart}-${sessionId.slice(-6)}`
        const wt = createWorktree(workDir, stepId, wfId || 'wf')
        wtDir = wt.dir
        effectiveWorkDir = wtDir
        logFn('[Agent:' + agLabel + '] worktree: ' + wtDir, agentPhase)
    }

    // ── 创建子 session ──
    const deps = activeDeps()
    const pushStream = new deps.PushStream()
    const cliSettings = deps.loadCliSettings()

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

    let q
    try {
        const queryOpts = await deps.makeQueryOptions(modelOpts, effectiveWorkDir, cliSettings, {}, sessionId)
        // ── 启动 query ──
        // 旧静态门禁对应的 `_deps.agentProvider.start(` 已迁移到当前实例依赖。
        q = deps.agentProvider.start(
            {prompt: pushStream, options: queryOpts, schema: schema || null},
            requirementsForAgentStart({
                options: queryOpts,
                structuredOutput: Boolean(schema),
                continuation: true,
            }),
        )
    } catch (error) {
        if (wtDir) cleanupWorktree(wtDir, workDir)
        throw error
    }
    if (_agentHandles) _agentHandles.set(agLabel, {
        q, pushStream, sessionId, status: 'running', _prompt: prompt, _opts: opts,
        _metadata: opts.runtimeMetadata || null,
    })
    try {
        pushStream.push({
            type: 'user', session_id: sessionId,
            message: {role: 'user', content: [{type: 'text', text: prompt}]},
            parent_tool_use_id: null,
        })
    } catch (error) {
        _agentHandles?.delete(agLabel)
        try { await q.return?.() } catch (closeError) {
            logFn('[Agent:' + agLabel + '] 启动失败后关闭 query 异常: ' + closeError.message, agentPhase)
        }
        if (wtDir) cleanupWorktree(wtDir, workDir)
        throw error
    }

    // ── 流式读取 (带超时) ──
    let output = ''
    let usage = null
    let resolved = false
    let sdkSessionId = null  // 捕获 SDK conversation ID，用于事后清理
    let controlError = null
    const _seenEventTypes = new Set()
    const _seenDeltaTypes = new Set()
    const _seenMsgTypes = new Set()

    const streamPromise = (async () => {
        try {
            for await (const sdkMsg of q) {
                if (resolved) break
                // DEBUG: 记录首次出现的 message type + keys
                if (!_seenMsgTypes.has(sdkMsg.type)) {
                    _seenMsgTypes.add(sdkMsg.type)
                    logFn('[DEBUG:' + agLabel + '] sdkMsg type=' + sdkMsg.type + ' keys=' + JSON.stringify(Object.keys(sdkMsg)).slice(0,200), agentPhase)
                }
                // 捕获 SDK conversation ID，供事后清理使用
                if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init' && sdkMsg.session_id) {
                    sdkSessionId = sdkMsg.session_id
                    // SIDE_EFFECT: 先登记 Agent 映射；即使进程异常退出，项目列表也能过滤残留 transcript。
                    if (deps?.persistSdkSessionId
                        && !deps.persistSdkSessionId(effectiveWorkDir, sessionId, sdkSessionId)) {
                        log.warn({agent: agLabel, sdkSessionId}, 'Agent Session 映射持久化失败')
                    }
                }
                // 工作流级暂停信号
                if (abortedRef?.()) {
                    const err = new Error('WorkflowAborted: 工作流已被暂停')
                    err.code = 'WORKFLOW_ABORTED'
                    throw err
                }
                // 单 agent 独立暂停信号由父进程保留调用，恢复后重新执行，不写 journal。
                if (_agentAborts?.get(agLabel)) {
                    logFn('[Agent:' + agLabel + '] 已暂停，等待恢复...', agentPhase)
                    const err = new Error('AgentPaused: ' + agLabel)
                    err.code = 'AGENT_PAUSED'
                    throw err
                }
                if (sdkMsg.type === 'assistant') {
                    for (const block of (sdkMsg.message?.content || [])) {
                        if (block.type === 'text' && block.text) output += block.text
                        // tool_use 块：捕获工具名称到日志
                        if (block.type === 'tool_use' && block.name) {
                            logFn('[Agent:' + agLabel + '] 工具: ' + block.name, agentPhase)
                        }
                    }
                }
                // stream_event：捕获 text_delta（非 Anthropic SDK 模型文本可能只走 delta 流）
                if (sdkMsg.type === 'stream_event') {
                    const ev = sdkMsg.event
                    // DEBUG: 记录实际收到的 stream_event 类型和结构
                    if (!_seenEventTypes.has(ev.type)) {
                        _seenEventTypes.add(ev.type)
                        logFn('[DEBUG:' + agLabel + '] stream_event type=' + ev.type + ' keys=' + JSON.stringify(Object.keys(ev)).slice(0,120), agentPhase)
                    }
                    if (ev.type === 'content_block_delta') {
                        if (!_seenDeltaTypes.has(ev.delta?.type)) {
                            _seenDeltaTypes.add(ev.delta?.type)
                            logFn('[DEBUG:' + agLabel + '] delta type=' + ev.delta?.type + ' keys=' + JSON.stringify(Object.keys(ev.delta || {})).slice(0,120), agentPhase)
                        }
                        if (ev.delta?.type === 'text_delta' && ev.delta.text) {
                            output += ev.delta.text
                        }
                        // thinking_delta 也收集
                        if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
                            output += ev.delta.thinking
                        }
                    }
                    if (ev.type === 'content_block_start') {
                        if (ev.content_block?.type === 'tool_use') {
                            logFn('[Agent:' + agLabel + '] 工具: ' + (ev.content_block.name || ''), agentPhase)
                        }
                        if (ev.content_block?.type === 'text') {
                            // 有些 SDK 在 content_block_start 时就带了文本
                            if (ev.content_block.text) output += ev.content_block.text
                        }
                    }
                    if (ev.type === 'content_block_stop') {
                        // noop
                    }
                }
                if (sdkMsg.type === 'result') {
                    usage = sdkMsg.usage
                    // 0.3.x: SDKResultError 无 result 字段，改用 errors 数组
                    output = sdkMsg.result || (sdkMsg.errors?.join('\n')) || output
                    logFn('[DEBUG:' + agLabel + '] result: sdkMsg.result=' + (sdkMsg.result ? sdkMsg.result.slice(0,200) : 'NULL') + ' output.len=' + output.length, agentPhase)
                    break
                }
            }
            // q.return() 可能让迭代器直接结束，结束后必须再次检查控制信号。
            if (abortedRef?.()) {
                const err = new Error('WorkflowAborted: 工作流已被暂停')
                err.code = 'WORKFLOW_ABORTED'
                throw err
            }
            if (_agentAborts?.get(agLabel)) {
                const err = new Error('AgentPaused: ' + agLabel)
                err.code = 'AGENT_PAUSED'
                throw err
            }
        } catch (e) {
            if (e.code === 'AGENT_PAUSED' || e.code === 'WORKFLOW_ABORTED' || e.code === 'BUDGET_EXCEEDED') {
                throw e
            }
            if (!resolved) output = 'Agent error: ' + e.message
        }
    })()

    let timerId
    const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Agent 超时 (' + AGENT_TIMEOUT_MS + 'ms)')), AGENT_TIMEOUT_MS)
    })

    try {
        await Promise.race([streamPromise, timeoutPromise])
    } catch (e) {
        if (e.code === 'AGENT_PAUSED' || e.code === 'WORKFLOW_ABORTED' || e.code === 'BUDGET_EXCEEDED') {
            controlError = e
        } else {
            output = 'Agent error: ' + e.message
            logFn('[Agent:' + agLabel + '] ' + e.message, agentPhase)
        }
    } finally {
        clearTimeout(timerId)
        resolved = true
        // 无论正常结束/超时/暂停，都显式调 q.return() 关闭底层 SDK query，
        //   防止 agent 在超时/暂停后仍后台运行继续消耗 API token
        try {
            await q.return?.()
        } catch (e) {
            logFn('[Agent:' + agLabel + '] 关闭 query 失败: ' + e.message, agentPhase)
        }
        _agentHandles?.delete(agLabel)
        // 清理 SDK transcript 文件，防止 agent 子 session 残留
        if (deps?.deleteSession && deps?.encodeProjectName) {
            // 使用 effectiveWorkDir 而非 workDir: worktree 隔离时 SDK transcript
            // 落在 worktree 路径对应的 project 目录，两个路径 encodeProjectName 不同
            const projectsDir = join(BRIDGE_HOME, 'projects', deps.encodeProjectName(effectiveWorkDir))
            if (sdkSessionId) {
                try {
                    const cleanup = await cleanupWorkflowAgentSession({
                        deleteSession: deps.deleteSession,
                        removeSdkSessionId: deps.removeSdkSessionId,
                        workDir: effectiveWorkDir,
                        gatewaySessionId: sessionId,
                        sdkSessionId,
                    })
                    if (!cleanup.mappingRemoved) {
                        log.warn({agent: agLabel, sdkSessionId}, 'Agent Session 映射清理失败')
                    }
                } catch (error) {
                    log.warn({err: error, agent: agLabel, sdkSessionId}, '清理 Agent SDK Session 失败')
                }
            } else {
                // 兜底: SDK 启动即崩溃等极端情况下 system/init 未送达，sdkSessionId 未捕获
                // 先尝试用本 agent 的 sessionId 直接删 (SDK 可能以此作文件名)
                try {
                    await deps.deleteSession(sessionId, {dir: effectiveWorkDir})
                } catch (error) {
                    log.debug({err: error, agent: agLabel, sessionId}, '按父 Session ID 清理 Agent transcript 失败')
                }
                // 再扫描项目目录查找引用本 sessionId 的残留 .jsonl
                try {
                    for (const f of readdirSync(projectsDir)) {
                        if (!f.endsWith('.jsonl') || f.startsWith('.trash-')) continue
                        try {
                            const head = readFileSync(join(projectsDir, f), 'utf8').slice(0, 4096)
                            if (head.includes(sessionId)) {
                                await deps.deleteSession(f.replace('.jsonl', ''), {dir: effectiveWorkDir})
                                break
                            }
                        } catch (error) {
                            log.debug({err: error, agent: agLabel, file: f}, '检查 Agent transcript 失败')
                        }
                    }
                } catch (error) {
                    log.debug({err: error, agent: agLabel, projectsDir}, '扫描 Agent transcript 目录失败')
                }
            }
        }
    }

    // ── 清理 worktree ──
    if (wtDir) {
        try {
            cleanupWorktree(wtDir, workDir)
        } catch (e) {
            logFn('[Agent:' + agLabel + '] 清理 worktree 失败: ' + e.message, agentPhase)
        }
    }

    if (controlError) throw controlError

    const tokensUsed = usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0
    logFn('[Agent:' + agLabel + '] 完成 (' + output.length + ' 字符, ' + tokensUsed + ' tokens)', agentPhase)

    // ── Schema 验证 + 重试 ──
    let result = output
    if (schema) {
        let parsed = extractJSON(output)
        let retries = 0

        // 首轮就空输出说明模型响应格式问题，重试不会改善，直接跳过
        if (!parsed && !output) {
            logFn('[Agent:' + agLabel + '] 输出为空，跳过 Schema 重试（模型可能不支持 JSON 输出）', agentPhase)
        } else while (retries < SCHEMA_MAX_RETRIES) {
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

            const retryPrompt = prompt + '\n\n[IMPORTANT] You MUST output ONLY valid JSON matching: ' + JSON.stringify(schema)
                + (parsed ? '\nValidation error: ' + validateSchema(parsed, schema).error : '\nNo JSON found.')
            const retryResult = await executeAgent(retryPrompt, {
                label: agLabel + '-retry' + (retries + 1), agentType, model,
                maxTurns: Math.max(3, (maxTurns || DEFAULT_MAX_TURNS) - 5),
            }, workDir, broadcast, logFn, journalCache, wfId, budgetRef, abortedRef, _cacheKey)
            retries++
            parsed = extractJSON(typeof retryResult === 'string' ? retryResult : JSON.stringify(retryResult))
        }
    }

    // ── 写 journal ──
    if (journalCache !== undefined) {
        const key = _cacheKey || contentHash
        journalCache[key] = {
            result,
            tokenSpent: (journalCache[key]?.tokenSpent || 0) + tokensUsed,
            timestamp: Date.now(),
            prompt: prompt.substring(0, 200),
            label: agLabel,
        }
    }

    return result
}

// ── 暂停工作流 ──
function stopWorkflow(nameOrRunKey) {
    const wfId = _runStates.has(nameOrRunKey) ? nameOrRunKey : _activeByName.get(nameOrRunKey)
    if (!wfId) return false
    const state = _runStates.get(wfId)
    if (!state || !['starting', 'running'].includes(state.status)) return false
    if (state.status === 'starting') {
        state.status = 'stopped'
        state._aborted = true
        state.endedAt = Date.now()
        persistWorkflowProjection(wfId, state)
        scheduleRunStateCleanup(wfId)
        return true
    }
    // 保存快照供 resume
    const runKey = state.runKey || state.name
    _pausedStates.set(runKey, {
        name: state.name, runKey, status: 'paused', phases: state.phases, logs: state.logs,
        wfId: state.wfId, pausedAt: Date.now(),
        parentSid: state._parentSid, args: state._args, workDir: state._workDir,
        journalCache: state._journalCache, tokenSpent: state._tokenSpent,
        currentPhase: state._currentPhase,
         _countedKeys: [...(state._countedKeys || [])],
         _agentResults: new Map(state._agentResults || []),
         _writeRequests: [...(state._writeRequests || [])],
         _agentAborts: new Map(state._agentAborts || []),
        _agentHandles: new Map(state._agentHandles || []),
        _pausedAgents: new Map(state._pausedAgents || []),
    })
    state.status = 'paused'
    state.endedAt = null
    persistWorkflowProjection(wfId, state)
    saveJournal(wfId, {
        name: state.name,
        runKey,
        parentSid: state._parentSid,
        workDir: state._workDir,
        args: state._args,
        phases: state.phases || [],
        logs: (state.logs || []).slice(-200),
        tokenSpent: state._tokenSpent || 0,
        journalCache: state._journalCache || {},
        currentPhase: state._currentPhase || '',
        _countedKeys: [...(state._countedKeys || [])],
        savedAt: Date.now(),
        paused: true,
    })
    // 调用 _abort() 桥接闭包变量 aborted 和 state._aborted，确保 VM 沙箱内 agent()/parallel()/pipeline() 感知到暂停
    if (typeof state._abort === 'function') state._abort()
    else state._aborted = true  // 兜底：旧版本 runState 没有 _abort 方法
    return true
}

// ── 单 agent 独立暂停 ──
function stopWorkflowAgent(wfId, agentLabel) {
    const state = _runStates.get(wfId)
    if (!state) return false
    // 设置中止标记：executeAgent 的 for-await 感知
    if (!state._agentAborts) state._agentAborts = new Map()
    state._agentAborts.set(agentLabel, true)
    // 保存暂停元信息供 UI 查询
    if (!state._pausedAgents) state._pausedAgents = new Map()
    const handle = state._agentHandles?.get(agentLabel)
    state._pausedAgents.set(agentLabel, {
        prompt: handle?._prompt || '', opts: handle?._opts || {}, pausedAt: Date.now()
    })
    // 如果有活跃 handle，直接关闭底层 query 加速响应
    if (handle && handle.status === 'running') {
        handle.status = 'paused'
        try {
            handle.pushStream?.close()
        } catch (error) {
            log.debug({err: error, workflowId: wfId, agent: agentLabel}, '暂停 Agent 时关闭输入流失败')
        }
        try {
            const closeResult = handle.q?.return?.()
            if (closeResult && typeof closeResult.catch === 'function') {
                closeResult.catch(error => {
                    log.debug({err: error, workflowId: wfId, agent: agentLabel}, '暂停 Agent 时关闭 query 失败')
                })
            }
        } catch (error) {
            log.debug({err: error, workflowId: wfId, agent: agentLabel}, '暂停 Agent 时关闭 query 失败')
        }
    }
    // 广播给前端
    if (state._parentSid && activeDeps()?.broadcast) {
        activeDeps().broadcast(state._parentSid, {
            type: 'agent_paused', workflowId: wfId, agentLabel,
        })
    }
    return true
}

// ── 单 agent 恢复 ──
function resumeWorkflowAgent(wfId, agentLabel) {
    const state = _runStates.get(wfId)
    if (!state || !state._agentAborts) return false
    state._agentAborts.delete(agentLabel)
    state._pausedAgents?.delete(agentLabel)
    // 广播给前端
    if (state._parentSid && activeDeps()?.broadcast) {
        activeDeps().broadcast(state._parentSid, {
            type: 'agent_resumed', workflowId: wfId, agentLabel,
        })
    }
    return true
}

// ── 恢复工作流 ──
async function resumeWorkflow(name, parentSidOrNull, overrideArgs = {}, runKey = name) {
    if (!_pausedStates.has(runKey) && !_pausedStates.has(name) && parentSidOrNull) {
        restoreSessionWorkflowStates(parentSidOrNull)
    }
    const snapshot = _pausedStates.get(runKey) || _pausedStates.get(name)
    if (!snapshot) throw new Error('没有可恢复的暂停状态: ' + name)

    const parentSid = parentSidOrNull || snapshot.parentSid
    if (!parentSid) throw new Error('resume 需要 parentSessionId')

    const src = getWorkflow(name)
    if (!src) throw new Error('Workflow 脚本不存在: ' + name)

    // 从快照恢复，journal cache 原样保留
    const mergedArgs = {...(snapshot.args || {}), ...overrideArgs, _runKey: runKey}
    return await _runWorkflowInternal(name, parentSid, mergedArgs, {
        resumeJournal: snapshot.journalCache || {},
        resumeTokenSpent: snapshot.tokenSpent || 0,
        resumePhases: snapshot.phases || [],
        resumeLogs: snapshot.logs || [],
        resumePhase: snapshot.currentPhase || '',
        _countedKeys: snapshot._countedKeys || [],
    })
}

// ── Internal: 执行 Workflow 脚本 ──
async function _runWorkflowInternal(name, parentSid, extraArgs, resumeState = null) {
    const src = getWorkflow(name)
    if (!src) {
        const missingError = new Error('Workflow 脚本不存在: ' + name)
        const runKey = extraArgs?._runKey || resumeState?.runKey || name
        const pendingId = _activeByName.get(runKey)
        const pendingState = pendingId ? _runStates.get(pendingId) : null
        if (pendingState?.status === 'starting') {
            pendingState.status = 'error'
            pendingState.error = missingError.message
            scheduleRunStateCleanup(pendingId)
        }
        throw missingError
    }

    const meta = parseMeta(src)
    const s = activeDeps().sessions?.get?.(parentSid)
    const workDir = resumeState?.workDir || s?.workDir || process.cwd()
    // 复用 presetRunState 分配的 wfId，未预设则生成并注册
    const runKey = extraArgs?._runKey || resumeState?.runKey || name
    let wfId = _activeByName.get(runKey)
    if (!wfId) {
        const safeName = sanitizeWorktreeSegment(name.replace(/\.\w+$/, ''), 'workflow')
        wfId = `wf-${safeName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        _activeByName.set(runKey, wfId)   // 注册以支持后续 stop/state 按运行键查找
    } else if (!resumeState && _runStates.get(wfId)?.status === 'running') {
        const error = new Error('Workflow 已在运行')
        error.code = 'WORKFLOW_ALREADY_RUNNING'
        throw error
    }
    const presetState = _runStates.get(wfId)
    if (!resumeState && presetState?._aborted === true) {
        const error = new Error('WorkflowAborted: Workflow 在启动前已停止')
        error.code = 'WORKFLOW_ABORTED'
        throw error
    }

    // ── 状态变量 ──
    let currentPhase = resumeState?.resumePhase || ''
    let tokenSpent = resumeState?.resumeTokenSpent || 0
    const phases = resumeState?.resumePhases || []
    const logs = resumeState?.resumeLogs || []
    const journalCache = resumeState?.resumeJournal || {}
    let aborted = false
    let _countedKeys = new Set(resumeState?._countedKeys || [])

    // ── 广播辅助 ──
    const _broadcast = (msg) => {
        if (activeDeps().broadcast) activeDeps().broadcast(parentSid, msg)
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
        // 同步刷新 runState.phases，确保前端 getRunState 轮询也能拿到最新阶段（不只依赖 broadcast 事件）
        syncRunState?.()
        // 每个 phase 切换时持久化 journal
        saveJournal(wfId, {
            name,
            runKey,
            parentSid,
            workDir,
            args: extraArgs,
            phases: [...phases],
            logs: logs.slice(-200),
            tokenSpent,
            journalCache,
            currentPhase: title,
            savedAt: Date.now()
        })
    }

    // ── 初始化运行状态 ──
    const runState = {
        name, runKey, status: 'running', phases: meta?.phases || [], logs: [],
        startedAt: resumeState?.startedAt || Date.now(), wfId,
        _parentSid: parentSid, _args: extraArgs, _workDir: workDir,
        _aborted: false, _journalCache: journalCache, _tokenSpent: tokenSpent,
        _currentPhase: currentPhase,
        _countedKeys: _countedKeys,
         _agentAborts: resumeState?._agentAborts || new Map(),
         _agentHandles: resumeState?._agentHandles || new Map(),
         _agentResults: resumeState?._agentResults || new Map(),
         _writeRequests: resumeState?._writeRequests || [],
         _pausedAgents: resumeState?._pausedAgents || new Map(),
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
        persistWorkflowProjection(wfId, runState)
    }
    const origLogFn = logFn
    const enhancedLog = (msg, ph) => {
        origLogFn(msg, ph);
        syncRunState()
    }

    const isResume = !!resumeState
    persistWorkflowProjection(wfId, runState)
    _broadcast({
        type: isResume ? 'workflow_resumed' : 'workflow_started',
        workflowId: wfId, name,
        phases: meta?.phases || [],
        resume: isResume,
    })
    enhancedLog(isResume ? '[Workflow] 恢复: ' + name + ' (' + tokenSpent + ' tokens 已用)' : '[Workflow] 开始: ' + name)

    // ── child_process 子进程隔离 ──
    // Workflow 不允许在持有 Provider 凭据的 Gateway 进程内执行。
    const _execMode = extraArgs?._execMode || 'fork'
    const modeError = _execMode === 'fork'
        ? null
        : new Error('Workflow 仅支持 fork 执行模式，Gateway 进程内 VM 模式已移除')

    async function _runWorkflowFork() {
        const childPath = join(__dirname, 'workflow-child.mjs')
        if (!existsSync(childPath)) {
            throw new Error('workflow-child.mjs 不存在，无法使用 fork 模式')
        }

        return new Promise((resolve, reject) => {
            let resolved = false
            const pendingAgents = new Set()
            let forceKillTimer = null

            const child = fork(childPath, [], {
                silent: true,
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                // 子进程不继承 Provider/API token 等 Gateway 凭据；仅保留 Node 启动所需的基础环境。
                env: {
                    PATH: process.env.PATH || '',
                    SystemRoot: process.env.SystemRoot || '',
                    WINDIR: process.env.WINDIR || '',
                    TEMP: process.env.TEMP || '',
                    TMP: process.env.TMP || '',
                    NODE_ENV: 'production',
                },
            })

            // stdout/stderr 转发到日志
            child.stdout?.on('data', d => {
                const txt = d.toString().trim()
                if (txt) enhancedLog('[child] ' + txt)
            })
            child.stderr?.on('data', d => {
                const txt = d.toString().trim()
                if (txt) enhancedLog('[child:err] ' + txt.slice(0, 16_384))
            })

            const childIsRunning = () => child.exitCode === null && child.signalCode === null

            const terminateChild = () => {
                if (!childIsRunning()) return
                try {
                    child.kill('SIGTERM')
                } catch (e) {
                    enhancedLog('[fork] 终止子进程失败: ' + e.message)
                }
                forceKillTimer = setTimeout(() => {
                    if (!childIsRunning()) return
                    try {
                        child.kill('SIGKILL')
                    } catch (e) {
                        enhancedLog('[fork] 强制终止子进程失败: ' + e.message)
                    }
                }, 5000)
                forceKillTimer.unref?.()
            }

            const stopActiveAgents = (status = 'paused') => {
                for (const handle of runState._agentHandles?.values() || []) {
                    handle.status = status
                    try {
                        handle.pushStream?.close()
                    } catch (e) {
                        enhancedLog('[fork] 关闭 agent 输入流失败: ' + e.message)
                    }
                    try {
                        const closeResult = handle.q?.return?.()
                        Promise.resolve(closeResult).catch(e => {
                            enhancedLog('[fork] 关闭 agent query 失败: ' + e.message)
                        })
                    } catch (e) {
                        enhancedLog('[fork] 关闭 agent query 异常: ' + e.message)
                    }
                }
            }

            const sendToChild = (message, {fatal = false} = {}) => {
                if (!child.connected || !childIsRunning()) {
                    if (fatal && !resolved) {
                        const err = new Error('Workflow child IPC 未连接')
                        err.code = 'FORK_FAILED'
                        settle('reject', err)
                    }
                    return false
                }
                try {
                    child.send(message, (error) => {
                        if (!error || resolved) return
                        enhancedLog('[fork] IPC 发送失败: ' + error.message)
                        if (fatal) {
                            error.code = 'FORK_FAILED'
                            settle('reject', error)
                        }
                    })
                    return true
                } catch (error) {
                    enhancedLog('[fork] IPC 发送异常: ' + error.message)
                    if (fatal && !resolved) {
                        error.code = 'FORK_FAILED'
                        settle('reject', error)
                    }
                    return false
                }
            }

            const settle = (kind, value, {stopAgents = false} = {}) => {
                if (resolved) return false
                resolved = true
                clearTimeout(timeout)
                if (forceKillTimer) clearTimeout(forceKillTimer)
                if (stopAgents) stopActiveAgents(kind === 'resolve' ? 'done' : 'paused')
                terminateChild()
                if (kind === 'resolve') resolve(value)
                else reject(value)
                return true
            }

            const timeout = setTimeout(() => {
                if (resolved) return
                aborted = true
                const err = new Error('Workflow child 进程超时 (' + SCRIPT_TIMEOUT_MS + 'ms)')
                err.code = 'WORKFLOW_TIMEOUT'
                settle('reject', err, {stopAgents: true})
            }, SCRIPT_TIMEOUT_MS)
            timeout.unref?.()

            child.on('message', async (msg) => {
                if (resolved) return
                try {
                    switch (msg.type) {
                        case 'agent_call': {
                            const {callId, prompt, opts} = msg
                            if (typeof callId !== 'string' || typeof prompt !== 'string'
                                || !opts || typeof opts !== 'object' || Array.isArray(opts)) {
                                sendToChild({
                                    type: 'agent_result', callId: String(callId || ''),
                                    error: 'Workflow agent_call 消息格式无效', code: 'WORKFLOW_INVALID_AGENT_CALL',
                                })
                                break
                            }
                            const promise = (async () => {
                                let agentMetadata = buildAgentRuntimeMetadata({
                                    id: opts?.label || 'agent',
                                    agentType: opts?.agentType,
                                    label: opts?.label,
                                    phase: opts?.phase || currentPhase,
                                    prompt,
                                    workflowName: name,
                                    runKey,
                                })
                                try {
                                    const modelRoute = assertWorkflowAgentModel(resolveWorkflowAgentModel({
                                        fixedModel: extraArgs?._fixedModel,
                                        model: opts.model,
                                        forcedModelTier: extraArgs?._forceModelTier,
                                        modelTier: opts.modelTier || inferWorkflowAgentTier({
                                            label: opts.label,
                                            phase: opts.phase,
                                            workflowTier: extraArgs?._workflowTier,
                                        }),
                                        workflowTier: extraArgs?._workflowTier,
                                        modelTiers: extraArgs?._modelTiers,
                                    }))
                                    const effectiveOpts = modelRoute.model
                                        ? {...opts, model: modelRoute.model}
                                        : {...opts}
                                    effectiveOpts.permissionMode = resolveWorkflowPermissionMode({
                                        parentPermissionMode: extraArgs?._permissionMode,
                                        agentPermissionMode: effectiveOpts.permissionMode,
                                    })
                                    if (effectiveOpts.phase && effectiveOpts.phase !== currentPhase) {
                                        phase(effectiveOpts.phase)
                                    }
                                    const cacheKey = hashContent(prompt, {
                                        agentType: effectiveOpts.agentType, model: effectiveOpts.model,
                                        schema: effectiveOpts.schema, effort: effectiveOpts.effort, isolation: effectiveOpts.isolation,
                                    })
                                    const agentLabel = effectiveOpts.label || 'agent'
                                    agentMetadata = buildAgentRuntimeMetadata({
                                        id: agentLabel,
                                        agentType: effectiveOpts.agentType,
                                        label: agentLabel,
                                        phase: effectiveOpts.phase || currentPhase,
                                        prompt,
                                        modelRoute,
                                        actualModel: effectiveOpts.model,
                                        workflowName: name,
                                        runKey,
                                    })
                                    effectiveOpts.runtimeMetadata = agentMetadata
                                    let result
                                    let rawWorkflowResult
                                    const registry = activeDeps().getAgentRegistry?.(extraArgs?._taskDecision || null, extraArgs?._projectContext || null)
                                        || createAgentRegistry()
                                    const requestedAgentId = effectiveOpts.agentType || agentMetadata.role || 'general-purpose'
                                    const definition = registry.get(requestedAgentId) || registry.get(agentMetadata.role) || registry.get('general-purpose')
                                    if (!definition) throw Object.assign(new Error(`Workflow Agent 未注册：${requestedAgentId}`), {code: 'AGENT_UNAVAILABLE'})
                                    const dispatcher = createAgentDispatcher({
                                        registry,
                                        mailbox: activeDeps().getAgentMailbox?.() || null,
                                        publish: event => _broadcast({
                                            type: event.type === 'agent/started' ? 'workflow_agent_started'
                                                : event.type === 'agent/completed' ? 'workflow_agent_done'
                                                    : event.type === 'agent/blocked' ? 'workflow_agent_blocked' : 'workflow_agent_error',
                                            workflowId: wfId,
                                            ...agentMetadata,
                                            id: agentLabel,
                                            role: event.role || agentMetadata.role,
                                            status: event.type === 'agent/started' ? 'running' : event.type === 'agent/completed' ? 'done' : event.type === 'agent/blocked' ? 'blocked' : 'error',
                                            agentResult: event.result || null,
                                            error: event.code || null,
                                            ts: Date.now(),
                                        }),
                                        execute: async () => {
                                            while (true) {
                                                try {
                                                    rawWorkflowResult = await executeAgent(prompt, effectiveOpts, workDir, _broadcast, enhancedLog,
                                                        journalCache, wfId, budgetRef, () => aborted, cacheKey,
                                                        runState._agentAborts, runState._agentHandles)
                                                    break
                                                } catch (e) {
                                                    if (e.code !== 'AGENT_PAUSED') throw e
                                                    enhancedLog('[Agent:' + agentLabel + '] 等待用户恢复...')
                                                    while (!aborted && runState._agentAborts?.get(agentLabel)) {
                                                        await new Promise(resolveWait => setTimeout(resolveWait, 500))
                                                    }
                                                    if (aborted) {
                                                        const abortError = new Error('WorkflowAborted: 工作流已被暂停')
                                                        abortError.code = 'WORKFLOW_ABORTED'
                                                        throw abortError
                                                    }
                                                    enhancedLog('[Agent:' + agentLabel + '] 已恢复，重新执行')
                                                }
                                            }
                                            const raw = rawWorkflowResult && typeof rawWorkflowResult === 'object' ? rawWorkflowResult : {}
                                            return {
                                            status: 'completed',
                                                summary: typeof rawWorkflowResult === 'string' ? rawWorkflowResult.slice(0, 2000) : String(raw.summary || 'Agent 已返回结构化结果'),
                                                changedFiles: raw.changedFiles || [], tests: raw.tests || [], findings: raw.findings || [],
                                                blockers: raw.blockers || [], regressions: raw.regressions || [], nextAction: raw.nextAction || '',
                                                writeRequest: raw.writeRequest || null,
                                            }
                                        },
                                    })
                                    result = await dispatcher.dispatchAgent({
                                        taskId: String(extraArgs?._taskId || parentSid || wfId),
                                        stepId: String(extraArgs?._stepId || `${wfId}:${effectiveOpts.phase || currentPhase || 'agent'}`),
                                        agentRunId: `${wfId}:${agentLabel}`,
                                        agentId: definition.id,
                                        role: definition.role,
                                        goal: prompt,
                                        workDir,
                                        targetFiles: Array.isArray(effectiveOpts.targetFiles) ? effectiveOpts.targetFiles : [],
                                        modelTier: modelRoute.tier || 'balanced',
                                        permissionMode: effectiveOpts.permissionMode || 'plan',
                                        acceptanceCriteria: Array.isArray(effectiveOpts.acceptanceCriteria) ? effectiveOpts.acceptanceCriteria : [],
                                        provider: 'claude-sdk',
                                        capabilities: {writable: true, resumable: true, modelOverride: true, structuredOutput: true, toolFiltering: true, continuation: true},
                                        requirements: requirementsForAgentStart({
                                            options: {permissionMode: effectiveOpts.permissionMode, model: effectiveOpts.model},
                                            structuredOutput: Boolean(effectiveOpts.schema), continuation: true,
                                        }),
                                    })
                                    if (journalCache[cacheKey] && !_countedKeys.has(cacheKey)) {
                                        tokenSpent += journalCache[cacheKey].tokenSpent
                                        _countedKeys.add(cacheKey)
                                        runState._tokenSpent = tokenSpent
                                    }
                                    runState._agentResults.set(agentLabel, result)
                                    if (result?.writeRequest) {
                                        runState._writeRequests = [...(runState._writeRequests || []).filter(item => item.agentRunId !== result.agentRunId), {
                                            agentRunId: result.agentRunId,
                                            role: result.role,
                                            writeRequest: result.writeRequest,
                                            nextAction: result.nextAction,
                                        }].slice(-50)
                                    }
                                    // 保持 Workflow 脚本原有的 agent() 返回值兼容；结构化
                                    // AgentResult 另存于运行状态和 workflow_done 事件供主任务消费。
                                    sendToChild({type: 'agent_result', callId, result: rawWorkflowResult})
                                } catch (e) {
                                    if (e.code === 'BUDGET_EXCEEDED' && !aborted) aborted = true
                                    sendToChild({type: 'agent_result', callId, error: e.message, code: e.code})
                                } finally {
                                    pendingAgents.delete(promise)
                                }
                            })()
                            pendingAgents.add(promise)
                            break
                        }

                        case 'phase': {
                            phase(msg.title)
                            break
                        }

                        case 'log': {
                            enhancedLog(msg.msg)
                            break
                        }

                        case 'done': {
                            // 子进程因 abort 返回 paused → 抛异常走父进程 pause 路径
                            if (msg.result?.paused) {
                                const err = new Error('WorkflowAborted')
                                err.code = 'WORKFLOW_PAUSED'
                                settle('reject', err, {stopAgents: true})
                            } else {
                                settle('resolve', msg.result)
                            }
                            break
                        }

                        case 'error': {
                            const err = new Error(String(msg.message || 'Workflow child 执行失败'))
                            if (msg.code) err.code = String(msg.code)
                            settle('reject', err, {stopAgents: pendingAgents.size > 0})
                            break
                        }
                    }
                } catch (e) {
                    enhancedLog('[fork] 消息处理异常: ' + e.message)
                }
            })

            child.on('exit', (code) => {
                clearTimeout(timeout)
                if (forceKillTimer) clearTimeout(forceKillTimer)
                if (!resolved) {
                    const err = new Error('Child 进程意外退出, code=' + code)
                    err.code = 'FORK_FAILED'
                    settle('reject', err, {stopAgents: true})
                }
            })

            child.on('error', (e) => {
                clearTimeout(timeout)
                if (!resolved) {
                    e.code = 'FORK_FAILED'
                    settle('reject', e, {stopAgents: true})
                }
            })

            // 注册 abort 控制（覆盖 runState._abort 使其能通知子进程）
            runState._abort = () => {
                aborted = true
                runState._aborted = true
                stopActiveAgents('paused')
                if (!sendToChild({type: 'abort'})) {
                    const err = new Error('WorkflowAborted')
                    err.code = 'WORKFLOW_PAUSED'
                    settle('reject', err, {stopAgents: true})
                }
            }

            sendToChild({
                type: 'init',
                script: src,
                args: extraArgs || {},
                budget: {total: extraArgs?.budgetMax || null},
                meta: meta || null,
            }, {fatal: true})
        })
    }

    // ── 执行脚本 ──
    let scriptPromise
    if (modeError) {
        scriptPromise = Promise.reject(modeError)
    } else {
        const childPath = join(__dirname, 'workflow-child.mjs')
        if (!existsSync(childPath)) {
            scriptPromise = Promise.reject(new Error('workflow-child.mjs 不存在，拒绝回退到 Gateway 内 VM 模式'))
        } else {
            enhancedLog('[Workflow] 开始 (fork): ' + name)
            // fork 失败必须显式失败，不能把不可信脚本降级到 Gateway 进程内执行。
            scriptPromise = _runWorkflowFork()
        }
    }

    try {
        const result = await scriptPromise

        // 成功完成 (VM 和 fork 共用)
        if (currentPhase) {
            const last = phases.find(p => p.title === currentPhase)
            if (last && last.status === 'running') last.status = 'done'
        }

        runState.status = 'done'
        runState.endedAt = Date.now()
        runState.result = result
        runState.phases = phases.length > 0 ? [...phases] : (meta?.phases || []).map(p => ({...p, status: 'done'}))
        runState.tokenSpent = tokenSpent
        persistWorkflowProjection(wfId, runState)

        _broadcast({
            type: 'workflow_done', workflowId: wfId, name,
            result: typeof result === 'string' ? result.substring(0, 2000) : (result ? JSON.stringify(result).substring(0, 2000) : ''),
            writeRequests: (runState._writeRequests || []).slice(-50),
            logs: logs.slice(-100), tokenSpent,
        })

        enhancedLog('[Workflow] 完成: ' + name + ' (' + tokenSpent + ' tokens)')

        // 推结果回主 session
        if (s?.pushStream && extraArgs?._returnToParent !== false) {
            const preview = typeof result === 'string' ? result.substring(0, 4000)
                : (result ? JSON.stringify(result, null, 2).substring(0, 4000) : '(无输出)')
            const writeRequests = (runState._writeRequests || []).slice(-20)
            const delegation = writeRequests.length
                ? '\n\n[Bridge 写入委托]\n只读 Agent 发现以下变更需要写入：\n'
                    + JSON.stringify(writeRequests, null, 2).substring(0, 8000)
                    + '\n请由主任务依据当前会话权限执行写入，完成后重新验证；不要把 Agent 的 changedFiles 声明当作已写入证据。'
                : ''
            s.pushStream.push({
                type: 'user', session_id: parentSid,
                message: {role: 'user', content: [{type: 'text', text: taskWorkflowResultMarker(wfId) + '\n[Workflow "' + name + '" 完成]\n' + preview + delegation}]},
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
        _pausedStates.delete(runKey)
        appendHistory({wfId, name, status: 'done', startedAt: runState.startedAt, endedAt: Date.now(), tokenSpent, phases: [...phases]})
        scheduleRunStateCleanup(wfId)

        return result
    } catch (e) {
        // BUDGET_EXCEEDED: 自动暂停，用户可调大 budget 后 resume
        if (e.code === 'BUDGET_EXCEEDED' && !aborted) aborted = true

        // 区分暂停 vs 真实错误
        if (aborted || e.message?.includes('WorkflowAborted')) {
            runState.status = 'paused'
            runState.endedAt = Date.now()
            runState.phases = phases.length > 0 ? [...phases] : (meta?.phases || []).map(p => ({
                ...p,
                status: p.title === currentPhase ? 'running' : 'pending'
            }))
            runState.tokenSpent = tokenSpent
            persistWorkflowProjection(wfId, runState)
            saveJournal(wfId, {
                name,
                runKey,
                parentSid,
                workDir,
                args: extraArgs,
                phases: [...phases],
                logs: logs.slice(-200),
                tokenSpent,
                journalCache,
                currentPhase,
                savedAt: Date.now(),
                paused: true
            })
            // BUDGET_EXCEEDED 内部触发时 stopWorkflow API 未被调用，内联保存快照
            if (!_pausedStates.has(runKey)) {
                _pausedStates.set(runKey, {
                    name, runKey, status: 'paused', phases: [...phases], logs: [...logs],
                    wfId, pausedAt: Date.now(), parentSid, args: extraArgs, workDir,
                    journalCache: {...journalCache}, tokenSpent, currentPhase,
                    _countedKeys: [..._countedKeys],
                })
            }
            _broadcast({type: 'workflow_paused', workflowId: wfId, name, tokenSpent, logs: logs.slice(-50)})
            enhancedLog('[Workflow] 已暂停: ' + name)
            appendHistory({wfId, name, status: 'paused', startedAt: runState.startedAt, endedAt: Date.now(), tokenSpent, phases: [...phases]})
            // 不抛异常，静默返回
            return {paused: true, tokenSpent, phases: [...phases]}
        }

        runState.status = 'error'
        runState.endedAt = Date.now()
        runState.error = e.message
        persistWorkflowProjection(wfId, runState)
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
        _pausedStates.delete(runKey)
        appendHistory({wfId, name, status: 'error', startedAt: runState.startedAt, endedAt: Date.now(), tokenSpent, phases: [...phases], error: e.message})
        scheduleRunStateCleanup(wfId)
        throw e
    }
}

// ── 提交工作流（停止并收集当前结果推回父 session） ──
async function commitWorkflow(nameOrRunKey) {
    const wfId = _runStates.has(nameOrRunKey) ? nameOrRunKey : _activeByName.get(nameOrRunKey)
    if (!wfId) throw new Error('工作流未找到')
    const state = _runStates.get(wfId)
    if (!state) throw new Error('运行状态未找到')

    stopWorkflow(wfId)
    // 等待 agents 异步终止完成 journalCache 最终写入
    await new Promise(r => setTimeout(r, 2000))

    const cache = state._journalCache || {}
    const completed = Object.entries(cache)
        .filter(([, v]) => v.result != null)
        .map(([hash, v]) => ({
            label: v.label || hash.slice(0, 8),
            result: JSON.stringify(v.result).slice(0, 500),
            tokenSpent: v.tokenSpent || 0,
        }))

    const s = activeDeps().sessions?.get(state._parentSid)
    if (s?.pushStream) {
        s.pushStream.push({
            type: 'user', session_id: state._parentSid,
            message: {role: 'user', content: [{type: 'text', text: [
                taskWorkflowResultMarker(wfId),
                '[Workflow "' + state.name + '" 已提交部分结果]',
                '已完成 ' + completed.length + ' 个, ' + (state._tokenSpent || 0) + ' tokens',
                ...completed.map(c => '### ' + c.label + '\n' + c.result),
            ].join('\n')}]},
            parent_tool_use_id: null,
        })
    }

    state.status = 'done'
    _pausedStates.delete(state.runKey || state.name)
    appendHistory({wfId, name: state.name, status: 'committed', startedAt: state.startedAt, endedAt: Date.now(), tokenSpent: state._tokenSpent, phases: state.phases})
    scheduleRunStateCleanup(wfId)
    return {committed: true, completed: completed.length}
}

// ── 公共 API: runWorkflow ──
async function runWorkflow(name, parentSid, extraArgs) {
    return await _runWorkflowInternal(name, parentSid, extraArgs, null)
}

function serializeSessionWorkflowState(wfId, state) {
    const agents = []
    if (state._agentHandles) {
        for (const [label, h] of state._agentHandles) {
            agents.push({
                id: label,
                agentType: label,
                description: h._prompt ? h._prompt.slice(0, 100) : '',
                status: h.status || 'running',
                source: 'workflow',
                progress: '',
                ...(h._metadata || {}),
            })
        }
    }
    // 暂停的 Agent 不在 _agentHandles 中，快照仍需保留以支持恢复。
    if (state._pausedAgents) {
        for (const [label] of state._pausedAgents) {
            if (!agents.find(agent => agent.id === label)) {
                agents.push({
                    id: label, agentType: label, description: '',
                    status: 'paused', source: 'workflow', progress: '',
                })
            }
        }
    }
    if (state._journalCache) {
        for (const cached of Object.values(state._journalCache)) {
            const label = String(cached?.label || '').trim()
            if (!label || cached?.result == null || agents.find(agent => agent.id === label)) continue
            agents.push({
                id: label,
                agentType: label,
                description: String(cached.prompt || '').slice(0, 100),
                status: 'done',
                source: 'workflow',
                progress: '',
            })
        }
    }
    const phases = state.phases || []
    return {
        wfId,
        name: state.name,
        status: state.status,
        phases,
        currentPhase: state.currentPhase || state._currentPhase || phases.find(phase => phase.status === 'running')?.title || '',
        agents,
        tokenSpent: state._tokenSpent || state.tokenSpent || 0,
        startedAt: state.startedAt,
        taskOwned: state._args?._taskOwned === true,
        returnsToParent: state._args?._returnToParent !== false,
    }
}

// 返回该会话全部 Workflow，父任务聚合器负责判断是否仍有必需子执行。
function getSessionWorkflowStates(sessionId) {
    restoreSessionWorkflowStates(sessionId)
    const workflows = []
    for (const [wfId, state] of _runStates) {
        if (state._parentSid !== sessionId) continue
        workflows.push(serializeSessionWorkflowState(wfId, state))
    }
    return sortSessionWorkflows(workflows)
}

// 兼容旧调用方，但使用确定性优先级而非 Map 插入顺序。
function getSessionWorkflowState(sessionId) {
    return getCurrentSessionWorkflow(getSessionWorkflowStates(sessionId))
}

export {
    MAX_WORKFLOW_SCRIPT_BYTES,
    validateWorkflowContent,
    listWorkflows,
    getWorkflow,
    saveWorkflow,
    deleteWorkflow,
    runWorkflow,
    parseMeta,
    getRunState,
    getSessionWorkflowState,
    getSessionWorkflowStates,
    serializeSessionWorkflowState,
    presetRunState,
    stopWorkflow,
    stopWorkflowAgent,
    resumeWorkflowAgent,
    resumeWorkflow,
    commitWorkflow,
    queryHistory,
    cleanupWorkflowAgentSession,
}
