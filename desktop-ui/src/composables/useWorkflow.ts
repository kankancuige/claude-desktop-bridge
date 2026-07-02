/**
 * useWorkflow.ts —— 工作流 DAG 编排状态管理
 * ── 功能说明 ──
 * 提供工作流画布的全部状态与操作方法：
 *   1. Agent 节点 CRUD（添加/删除/移动/选中）
 *   2. 连线管理（pipeline 串行依赖）
 *   3. 并行组（parallel group）管理
 *   4. 阶段分隔条（phase）管理
 *   5. DAG → JS 脚本导出（dtoWorkflowScript）
 * ── 实现方式 ──
 * 所有状态为 Vue ref，节点/边/组/阶段各自独立数组；
 * 依赖关系通过节点的 dependsOn 数组和 edges 数组双重维护；
 * 脚本导出通过拓扑分层 BFS 将 DAG 转为 Workflow 引擎可执行的 JS 代码。
 */
import {ref, computed, nextTick} from 'vue'

export interface AgentTool {
    key: string;
    label: string;
    icon: string;
    svg: string;
    color: string;
    desc: string
}

// 工作流节点 (agent)
export interface WfNode {
    id: string;
    agent: string;
    prompt: string;
    model: string
    maxTurns: number;
    allowedTools: string;
    dependsOn: string[]
    groupId: string  // '' = 不属于 parallel 组
    x: number;
    y: number;
    status: 'pending' | 'running' | 'done' | 'error'
    output?: string
}

// 节点间连线 (pipeline 串行)
export interface WfEdge {
    from: string;
    to: string
}

// 并行组 (parallel)
export interface WfGroup {
    id: string;
    label: string;
    nodeIds: string[]    // 框内节点
    x: number;
    y: number;
    w: number;
    h: number       // 画布位置（自动由节点位置计算）
}

// 阶段分隔条 (phase)
export interface WfPhase {
    id: string;
    title: string;
    y: number             // 画布 Y 位置
}

// 工作流 meta
export interface WfMeta {
    name: string;
    description: string;
    budgetTokens: number
}

export interface WorkflowState {
    id: string;
    status: string;
    phase: string
    waves: { id: string; agent: string; status: string; output: string }[][]
    waveIndex: number
}

export function useWorkflow() {
    const GW = 'http://127.0.0.1:3456'

    function ri(d: string): string {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
    }

    const agents: AgentTool[] = [
        {
            key: 'Explore',
            label: 'Explore',
            icon: '◎',
            svg: ri('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
            color: '#6b96e0',
            desc: '代码搜索/定位'
        },
        {
            key: 'Plan',
            label: 'Plan',
            icon: '≡',
            svg: ri('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
            color: '#d4a853',
            desc: '架构设计'
        },
        {
            key: 'general-purpose',
            label: 'General',
            icon: '■',
            svg: ri('<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
            color: '#8b9dc3',
            desc: '通用任务'
        },
        {
            key: 'code-reviewer',
            label: 'Review',
            icon: '◉',
            svg: ri('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
            color: '#69c77f',
            desc: '代码审查'
        },
        {
            key: 'claude-code-guide',
            label: 'Guide',
            icon: '○',
            svg: ri('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
            color: '#b07cd8',
            desc: '文档参考'
        },
        {
            key: 'claude',
            label: 'Claude',
            icon: '●',
            svg: ri('<circle cx="12" cy="12" r="10"/><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'),
            color: '#e94560',
            desc: '全能力'
        },
    ]

    const nodes = ref<WfNode[]>([])
    const edges = ref<WfEdge[]>([])
    const groups = ref<WfGroup[]>([])
    const phases = ref<WfPhase[]>([])
    const wfMeta = ref<WfMeta>({name: '', description: '', budgetTokens: 0})

    const selectedNodeId = ref<string | null>(null)
    const connectingFrom = ref<string | null>(null)
    const submitting = ref(false)
    const started = ref(false)
    const runState = ref<WorkflowState | null>(null)

    const selectedNode = computed(() => nodes.value.find(n => n.id === selectedNodeId.value) || null)

    // ── 节点 CRUD ──
    /**
     * addNode — 在画布指定位置创建新的 Agent 节点
     * 功能说明: 生成唯一 ID(n+timestamp36)，插入 nodes 数组，自动选中新节点
     * 实现方式: nextTick 后设置 selectedNodeId 并触发 recalcGroup 刷新所在并行组边界
     * @param agentKey - Agent 类型 key (Explore/Plan/general-purpose 等)
     * @param x, y - 画布坐标（像素）
     */
    function addNode(agentKey: string, x: number, y: number) {
        const id = `n${Date.now().toString(36)}`
        nodes.value.push({
            id,
            agent: agentKey,
            prompt: '',
            model: 'inherit',
            maxTurns: 15,
            allowedTools: '',
            dependsOn: [],
            groupId: '',
            x,
            y,
            status: 'pending'
        })
        nextTick(() => {
            selectedNodeId.value = id;
            recalcGroup(id)
        })
    }

    /**
     * removeNode — 删除节点并级联清理所有关联
     * 功能说明: 删除节点、移除所有关联边、清理其他节点的 dependsOn 引用、
     *          从并行组中移除、清理空组、取消选中
     */
    function removeNode(id: string) {
        nodes.value = nodes.value.filter(n => n.id !== id)
        edges.value = edges.value.filter(e => e.from !== id && e.to !== id)
        for (const n of nodes.value) n.dependsOn = n.dependsOn.filter(d => d !== id)
        for (const g of groups.value) g.nodeIds = g.nodeIds.filter(nid => nid !== id)
        groups.value = groups.value.filter(g => g.nodeIds.length > 0)
        if (selectedNodeId.value === id) selectedNodeId.value = null
    }

    // ── 连线 (pipeline) ──
    /**
     * startConnect — 开始拖拽连线（从源节点出发）
     * 功能说明: 记录当前拖拽起点的节点 ID，画布层据此绘制临时连线
     */
    function startConnect(fromId: string) {
        connectingFrom.value = fromId
    }

    /**
     * completeConnect — 完成连线（从源节点到目标节点）
     * 功能说明: 校验合法性（非自连、非重复），创建边并更新目标节点的 dependsOn
     * 实现方式: 去重检查 → edges.push + dependsOn.push → 清空 connectingFrom
     */
    function completeConnect(toId: string) {
        if (!connectingFrom.value || connectingFrom.value === toId) {
            connectingFrom.value = null;
            return
        }
        if (edges.value.some(e => e.from === connectingFrom.value && e.to === toId)) {
            connectingFrom.value = null;
            return
        }
        edges.value.push({from: connectingFrom.value!, to: toId})
        const tn = nodes.value.find(n => n.id === toId)
        if (tn && !tn.dependsOn.includes(connectingFrom.value!)) tn.dependsOn.push(connectingFrom.value!)
        connectingFrom.value = null
    }

    function removeEdge(from: string, to: string) {
        edges.value = edges.value.filter(e => !(e.from === from && e.to === to))
        const tn = nodes.value.find(n => n.id === to)
        if (tn) tn.dependsOn = tn.dependsOn.filter(d => d !== from)
    }

    // ── 节点位置 ──
    function updateNodePos(id: string, x: number, y: number) {
        const n = nodes.value.find(n => n.id === id);
        if (n) {
            n.x = x;
            n.y = y;
            recalcGroup(id)
        }
    }

    // ── 并行组 (parallel) ──
    /**
     * createGroup — 将多个节点归入同一个并行执行组
     * 功能说明: 至少 2 个节点才能成组，设置 groupId 并计算组边界框
     * 实现方式: 生成 g+timestamp36 ID → 所有成员设 groupId → groups.push → recalcGroup 计算位置
     */
    function createGroup(nodeIds: string[]) {
        if (nodeIds.length < 2) return
        const id = `g${Date.now().toString(36)}`
        for (const nid of nodeIds) {
            const n = nodes.value.find(n => n.id === nid);
            if (n) n.groupId = id
        }
        groups.value.push({id, label: `Group ${groups.value.length + 1}`, nodeIds, x: 0, y: 0, w: 0, h: 0})
        recalcGroup(nodeIds[0])
    }

    function removeGroup(gid: string) {
        for (const n of nodes.value) {
            if (n.groupId === gid) n.groupId = ''
        }
        groups.value = groups.value.filter(g => g.id !== gid)
    }

    /**
     * recalcGroup — 重新计算并行组的边界框
     * 功能说明: 根据组内所有节点的位置自动计算组的 x/y/w/h，
     *          加入 padding 使视觉上不紧贴节点边缘
     */
    function recalcGroup(anyNodeId: string) {
        const n = nodes.value.find(n => n.id === anyNodeId)
        if (!n || !n.groupId) return
        const g = groups.value.find(g => g.id === n.groupId)
        if (!g) return
        const members = nodes.value.filter(n => n.groupId === g.id)
        if (members.length === 0) {
            removeGroup(g.id);
            return
        }
        g.x = Math.min(...members.map(n => n.x)) - 20
        g.y = Math.min(...members.map(n => n.y)) - 30
        g.w = Math.max(...members.map(n => n.x + 160)) - g.x + 20
        g.h = Math.max(...members.map(n => n.y + 82)) - g.y + 20
    }

    // ── 阶段分隔 (phase) ──
    function addPhase(title: string, y: number) {
        phases.value.push({id: `ph${Date.now().toString(36)}`, title, y})
        phases.value.sort((a, b) => a.y - b.y)
    }

    function removePhase(id: string) {
        phases.value = phases.value.filter(p => p.id !== id)
    }

    function updatePhasePos(id: string, y: number) {
        const p = phases.value.find(p => p.id === id);
        if (p) {
            p.y = y;
            phases.value.sort((a, b) => a.y - b.y)
        }
    }

    function updatePhaseTitle(id: string, title: string) {
        const p = phases.value.find(p => p.id === id);
        if (p) p.title = title
    }

    function updateGroupLabel(id: string, label: string) {
        const g = groups.value.find(g => g.id === id);
        if (g) g.label = label
    }

    // ── 清空画布 ──
    function reset() {
        nodes.value = [];
        edges.value = [];
        groups.value = [];
        phases.value = []
        selectedNodeId.value = null;
        connectingFrom.value = null
        submitting.value = false;
        started.value = false;
        runState.value = null
    }

    // ── DAG → JS 脚本导出 ──
    /**
     * dtoWorkflowScript — 将画布 DAG 转换为 Workflow 引擎可执行的 JS 脚本
     * 功能说明: 通过拓扑分层 BFS 将节点按依赖关系分层，
     *          每层内并行组用 parallel() 包裹，串行节点顺序执行，
     *          层间天然形成 barrier（每层 await 完成后才执行下一层），
     *          等价于 staged() 阶段性管道语义。
     *          生成完整的 export const meta + phase() + agent()/parallel() 代码
     * 实现方式:
     *   1. 构建邻接表 + 入度表
     *   2. BFS 拓扑分层（每层节点可并行执行）
     *   3. 每层内按 groupId 分组 → parallel()；单独节点 → await agent()
     *   4. 输出合法的 Workflow JS 脚本字符串
     * 关键数据流: nodes[] + edges[] → 拓扑排序 → 分层 → JS 代码字符串
     */
    function dtoWorkflowScript(): string {
        if (nodes.value.length === 0) return ''

        // 构建依赖图
        const inDegree = new Map<string, number>()
        const adj = new Map<string, string[]>()
        for (const n of nodes.value) {
            inDegree.set(n.id, n.dependsOn.length)
            for (const d of n.dependsOn) {
                if (!adj.has(d)) adj.set(d, [])
                adj.get(d)!.push(n.id)
            }
        }

        // 拓扑分层 BFS
        const levels: string[][] = []
        const visited = new Set<string>()
        let queue = nodes.value.filter(n => n.dependsOn.length === 0).map(n => n.id)
        while (queue.length > 0) {
            const fresh = queue.filter(id => !visited.has(id))
            if (fresh.length === 0) break
            levels.push(fresh)
            fresh.forEach(id => visited.add(id))
            const next = new Set<string>()
            for (const id of fresh) {
                for (const nid of (adj.get(id) || [])) {
                    const deg = (inDegree.get(nid) || 1) - 1
                    inDegree.set(nid, deg)
                    if (deg <= 0 && !visited.has(nid)) next.add(nid)
                }
            }
            queue = [...next]
        }

        // 未访问到的孤立节点（循环依赖 / 无入度不在 queue 中的）
        const orphan = nodes.value.filter(n => !visited.has(n.id)).map(n => n.id)
        if (orphan.length > 0) levels.push(orphan)

        const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
        const agentOpts = (n: typeof nodes.value[0]) => {
            const parts = [`agentType: '${esc(n.agent)}'`]
            if (n.model && n.model !== 'inherit') parts.push(`model: '${esc(n.model)}'`)
            if (n.maxTurns !== 15) parts.push(`maxTurns: ${n.maxTurns}`)
            return parts.join(', ')
        }

        const phaseList = phases.value.length > 0
            ? phases.value
            : levels.map((_, i) => ({ title: `Phase ${i + 1}`, y: 0, id: '' }))

        const lines: string[] = []
        // meta 块
        const metaLines = phaseList.map(p => `    { title: '${esc(p.title)}' },`).join('\n')
        lines.push(`export const meta = {`)
        lines.push(`  name: '${esc(wfMeta.value.name || 'my-workflow')}',`)
        lines.push(`  description: '${esc(wfMeta.value.description || '')}',`)
        lines.push(`  phases: [`)
        lines.push(metaLines)
        lines.push(`  ],`)
        lines.push(`}`)
        lines.push('')

        // 各层
        for (let li = 0; li < levels.length; li++) {
            const phase = phaseList[li]
            if (phase) lines.push(`phase('${esc(phase.title)}')`)

            const lvNodes = levels[li].map(id => nodes.value.find(n => n.id === id)!).filter(Boolean)

            // 分组：parallel group vs solo
            const grp = new Map<string, typeof lvNodes>()
            const solo: typeof lvNodes = []
            for (const n of lvNodes) {
                if (n.groupId) {
                    if (!grp.has(n.groupId)) grp.set(n.groupId, [])
                    grp.get(n.groupId)!.push(n)
                } else {
                    solo.push(n)
                }
            }

            // parallel 组
            for (const [, members] of grp) {
                const ids = members.map(m => `r_${m.id}`).join(', ')
                lines.push(`const [${ids}] = await parallel([`)
                for (const m of members) {
                    lines.push(`  () => agent('${esc(m.prompt || '未设置提示词')}', { ${agentOpts(m)}, label: '${m.id}' }),`)
                }
                lines.push(`])`)
            }

            // 串行节点：同层独立节点按序执行，层间有隐式 barrier（下一个 phase() 前必须全部完成）
            for (const n of solo) {
                lines.push(`const ${n.id} = await agent('${esc(n.prompt || '未设置提示词')}', { ${agentOpts(n)}, label: '${n.id}' })`)
            }

            if (lvNodes.length > 0) lines.push('')
        }

        lines.push(`log('DAG workflow complete')`)
        return lines.join('\n')
    }

    return {
        agents, nodes, edges, groups, phases, wfMeta,
        selectedNodeId, selectedNode, connectingFrom, submitting, started, runState,
        addNode, removeNode, removeEdge,
        startConnect, completeConnect, updateNodePos,
        createGroup, removeGroup, recalcGroup,
        addPhase, removePhase, updatePhasePos, updatePhaseTitle, updateGroupLabel,
        reset,
        dtoWorkflowScript,
    }
}
