const ROUTES = [
    {
        name: 'protocol-parser',
        signals: /(?:协议|帧|半包|粘包|字节|十六进制|hex|crc|校验和|checksum|串口帧|报文|解析器|parser)/i,
        extensions: /\.(?:c|h|cpp|cs|java|js|mjs|ts)$/i,
    },
    {
        name: 'device-driver',
        signals: /(?:扳手|设备|串口|com\d*|连接|断开|重连|自动重连|握手|超时|plc|传感器|rfid|扫码|驱动|device|connect|disconnect|reconnect)/i,
        extensions: /\.(?:cs|c|h|cpp|java)$/i,
    },
    {
        name: 'ui-winforms',
        signals: /(?:winforms|windows forms|窗体|控件|按钮|文本框|表格|datagridview|ui线程|界面线程|antd ui)/i,
        extensions: /\.(?:cs|csproj|resx|Designer\.cs)$/i,
    },
    {
        name: 'db-sql',
        signals: /(?:sql|数据库|表结构|迁移|索引|慢查询|分页|查询|insert|update|delete|select|mysql|sqlserver|sqlite)/i,
        extensions: /\.(?:sql|cs|java|xml)$/i,
    },
    {
        name: 'vue-frontend',
        signals: /(?:vue|element plus|pinia|路由|前端|组件|页面|vite|uni-app|uniapp)/i,
        extensions: /\.(?:vue|tsx?|jsx?)$/i,
    },
]

function asText(value) {
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join('\n')
    return typeof value === 'string' ? value : ''
}

function hasExplicitSkillExplanation(text) {
    return /(?:什么是|是什么意思|怎么用|是否需要|有必要|解释一下|介绍一下).*(?:skill|技能|规则|注入)/i.test(text)
}

export function routeSkills({text = '', workDir = '', profile = 'full', targetFiles = []} = {}) {
    if (profile === 'light') return []
    // 工作目录仅用于上层记录，不作为 Skill 选择依据，避免“路径中有扳手/WinForms”就加载完整规则。
    void workDir
    const combined = [asText(text), asText(targetFiles)].filter(Boolean).join('\n')
    if (!combined || hasExplicitSkillExplanation(combined)) return []
    const routed = []
    for (const route of ROUTES) {
        const signalMatch = route.signals.test(combined)
        const extensionMatch = route.extensions.test(asText(targetFiles))
        if (signalMatch || (extensionMatch && route.name === 'ui-winforms' && /(?:窗体|控件|按钮|文本框|表格|ui线程|winforms|windows forms|datagridview|antd ui)/i.test(combined))) {
            routed.push(route.name)
        }
    }
    return [...new Set(routed)]
}

export function applySkillRoute(options, route) {
    if (!options || typeof options !== 'object') return options
    return {...options, skills: [...new Set(Array.isArray(route) ? route.filter(name => typeof name === 'string' && name.length <= 128) : [])]}
}
