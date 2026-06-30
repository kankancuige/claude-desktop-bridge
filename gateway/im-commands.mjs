/**
 * IM 自定义命令引擎 — 微信/飞书/钉钉共用
 * 9 条命令：/p /ss /sw /sws /ns /m /stop /i /h（+中文别名）
 */

const GW = 'http://127.0.0.1:3456'

// 命令定义：前缀 → key（按长度降序避免 /sw 误匹配 /sws）
const CMD_LIST = [
    { prefix: '/切换会话', key: 'switch_session' },
    { prefix: '/sws',       key: 'switch_session' },
    { prefix: '/切换',       key: 'switch_project' },
    { prefix: '/switch',    key: 'switch_project' },
    { prefix: '/sw',        key: 'switch_project' },
    { prefix: '/新会话',     key: 'new_session' },
    { prefix: '/ns',        key: 'new_session' },
    { prefix: '/镜像',       key: 'mirror' },
    { prefix: '/mirror',    key: 'mirror' },
    { prefix: '/m',         key: 'mirror' },
    { prefix: '/停止',       key: 'stop' },
    { prefix: '/stop',      key: 'stop' },
    { prefix: '/信息',       key: 'info' },
    { prefix: '/info',      key: 'info' },
    { prefix: '/i',         key: 'info' },
    { prefix: '/帮助',       key: 'help' },
    { prefix: '/help',      key: 'help' },
    { prefix: '/h',         key: 'help' },
    { prefix: '/项目',       key: 'projects' },
    { prefix: '/projects',  key: 'projects' },
    { prefix: '/p',         key: 'projects' },
    { prefix: '/会话',       key: 'sessions' },
    { prefix: '/sessions',  key: 'sessions' },
    { prefix: '/ss',        key: 'sessions' },
]

// ── detectCommand ──
export function detectCommand(text) {
    const t = text.trim()
    if (!t.startsWith('/')) return null

    for (const { prefix, key } of CMD_LIST) {
        if (t === prefix || t.startsWith(prefix + ' ') || t.startsWith(prefix + '\t')) {
            const argsPart = t.slice(prefix.length).trim()
            return { key, args: parseArgs(key, argsPart) }
        }
    }
    return null
}

function parseArgs(key, s) {
    if (!s) return {}
    const parts = s.split(/\s+/).filter(Boolean)
    switch (key) {
        case 'switch_project':
            return { projectName: parts[0] || '', sessionIndex: parts[1] || null }
        case 'switch_session': {
            const v = parts[0] || ''
            if (/^\d+$/.test(v)) return { sessionIndex: v }
            return { sessionId: v }
        }
        case 'new_session':
            return { projectName: parts[0] || null }
        case 'mirror': {
            const platform = parts[0] || ''
            const toggle = parts[1] || ''
            return { platform, toggle }
        }
        case 'sessions': {
            return { projectLabel: parts[0] || null }
        }
    }
    return {}
}

// ── executeCommand ──
export async function executeCommand(cmd) {
    const { key, args } = cmd

    switch (key) {
        case 'switch_project': {
            const ok = await postNudge('switch_project', args)
            if (!ok) return { replyText: '桌面端离线，指令未送达。请先打开桌面端。' }
            return { replyText: `✅ 已切换至 [${args.projectName || ''}]` }
        }
        case 'switch_session': {
            const ok = await postNudge('switch_session', args)
            if (!ok) return { replyText: '桌面端离线，指令未送达。请先打开桌面端。' }
            if (args.sessionId) return { replyText: `✅ 已切换会话 ${args.sessionId.slice(0, 8)}...` }
            return { replyText: `✅ 已切换至第${args.sessionIndex}个会话` }
        }
        case 'new_session': {
            const ok = await postNudge('new_session', args)
            if (!ok) return { replyText: '桌面端离线，指令未送达。请先打开桌面端。' }
            if (args.projectName) return { replyText: `✅ 已在 [${args.projectName}] 新建会话` }
            return { replyText: '✅ 已新建会话' }
        }
        case 'stop': {
            const ok = await postNudge('stop', {})
            if (!ok) return { replyText: '桌面端离线，指令未送达。' }
            return { replyText: '✅ 已发送停止指令' }
        }
        case 'projects':
            return await handleProjects()

        case 'sessions':
            return await handleSessions(args)

        case 'mirror':
            return await handleMirror(args)

        case 'info':
            return await handleInfo()

        case 'help':
            return { replyText: helpText() }
    }
}

// ── /p —— 列出所有已注册项目 ──
async function handleProjects() {
    try {
        const r = await fetch(`${GW}/api/projects`, { signal: AbortSignal.timeout(5000) })
        if (!r.ok) return { replyText: '获取项目列表失败' }
        const { projects } = await r.json()
        if (!projects?.length) return { replyText: '暂无已注册项目' }
        const lines = projects.map((p, i) => {
            const label = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || p.workDir
            return `${i + 1}. [${label}] ${p.sessionCount}个会话`
        })
        return { replyText: lines.join('\n') }
    } catch {
        return { replyText: '获取项目列表失败（Gateway 未响应）' }
    }
}

// ── /ss [项目] —— 列出项目下所有 Session（1 次 HTTP）──
async function handleSessions(args) {
    if (!args.projectLabel) return { replyText: '用法: /ss <项目标签>\n项目标签见 /p 列表中方括号内的名称' }
    try {
        const r = await fetch(`${GW}/api/sessions-by-label`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: args.projectLabel }),
            signal: AbortSignal.timeout(5000),
        })
        if (!r.ok) return { replyText: 'Gateway 未响应' }
        const { sessions } = await r.json()
        if (!sessions?.length) return { replyText: `[${args.projectLabel}] 下暂无会话。使用 /p 查看可用项目。` }
        const lines = sessions.map((s, i) => `${i + 1}. ${s.id.slice(0, 8)} ${s.title || ''}`)
        return { replyText: `[${args.projectLabel}] 会话列表:\n${lines.join('\n')}` }
    } catch {
        return { replyText: 'Gateway 未响应' }
    }
}

// ── /m [平台] [on/off] —— 镜像开关（1 次 HTTP）──
async function handleMirror(args) {
    const platformMap = {
        '微信': 'wechat', 'wechat': 'wechat', 'wx': 'wechat',
        '飞书': 'feishu', 'feishu': 'feishu', 'fs': 'feishu',
        '钉钉': 'dingtalk', 'dingtalk': 'dingtalk', 'dt': 'dingtalk',
    }
    const platform = platformMap[args.platform] || args.platform

    // /m 不带参数 → 查看所有镜像状态
    if (!platform) {
        try {
            const r = await fetch(`${GW}/api/mirror`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),  // 不带 platform → 查询
                signal: AbortSignal.timeout(3000),
            })
            if (!r.ok) return { replyText: 'Gateway 未响应' }
            const { mirrors, hasSession } = await r.json()
            if (!hasSession) return { replyText: '尚无活跃 Session' }
            const wIcon = mirrors?.wechat ? '✅' : '❌'
            const fIcon = mirrors?.feishu ? '✅' : '❌'
            const dIcon = mirrors?.dingtalk ? '✅' : '❌'
            return { replyText: `${wIcon}微信 ${fIcon}飞书 ${dIcon}钉钉` }
        } catch {
            return { replyText: 'Gateway 未响应' }
        }
    }

    if (!['wechat', 'feishu', 'dingtalk'].includes(platform)) {
        return { replyText: '平台: 微信/wechat/wx 飞书/feishu/fs 钉钉/dingtalk/dt' }
    }

    try {
        const body = { platform }
        if (args.toggle === 'on' || args.toggle === '开') {
            body.action = 'set'; body.enabled = true
        } else if (args.toggle === 'off' || args.toggle === '关') {
            body.action = 'set'; body.enabled = false
        } else {
            body.action = 'toggle'  // 不带参数 → 翻转
        }
        const r = await fetch(`${GW}/api/mirror`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(3000),
        })
        if (!r.ok) return { replyText: 'Gateway 未响应' }
        const d = await r.json()
        if (!d.ok) {
            if (d.error === 'no_session') return { replyText: '尚无活跃 Session，请先在桌面端打开项目。' }
            return { replyText: '操作失败' }
        }
        return { replyText: d.enabled ? `✅ ${platform}镜像已开启` : `❌ ${platform}镜像已关闭` }
    } catch {
        return { replyText: 'Gateway 未响应' }
    }
}

// ── /i —— 当前项目/Session/桌面状态 ──
async function handleInfo() {
    try {
        const fr = await fetch(`${GW}/api/sessions/focused`, { signal: AbortSignal.timeout(3000) })
        if (fr.ok) {
            const { sessionId, workDir } = await fr.json()
            const projName = (workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || workDir
            return { replyText: `项目: ${projName}\nSession: ${sessionId.slice(0, 8)}...\n桌面: 在线` }
        }
        const pr = await fetch(`${GW}/api/projects`, { signal: AbortSignal.timeout(3000) })
        if (pr.ok) {
            const { projects } = await pr.json()
            if (projects?.length) return { replyText: '桌面在线，暂无活跃 Session。请先在桌面端打开一个项目。' }
        }
        return { replyText: '桌面端离线或 Gateway 未运行' }
    } catch {
        return { replyText: 'Gateway 未响应' }
    }
}

// ── /h —— 列出所有可用命令 ──
function helpText() {
    return `/p  项目          列出所有已注册项目
/ss 会话 [项目]  列出项目下所有Session
/sw 切换 <项目>   切换项目
/sws 切换会话 <编号> 当前项目切会话
/ns 新会话 [项目] 新建Session
/m  镜像 <平台> [on/off] 镜像开关
/stop 停止        停止agent
/i  信息          当前状态
/h  帮助          此列表`
}

// ── postNudge ── 返回 true=桌面端在线已送达，false=离线未送达
async function postNudge(action, args) {
    try {
        const r = await fetch(`${GW}/api/desktop/nudge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, args, source: 'adapter' }),
            signal: AbortSignal.timeout(3000),
        })
        if (!r.ok) return false
        const d = await r.json()
        return d.delivered === true
    } catch {
        return false
    }
}
