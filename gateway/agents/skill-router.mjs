const DIGITAL_TWIN_CONTEXT = /(?:数字孪生|工业孪生|机器人孪生|digital\s+twin|industrial\s+twin|robot\s+twin|twin[._ -]?manifest|twin\.config\.ya?ml|设备三维资产)/i
const DIGITAL_TWIN_INTEGRATION = /(?:cad|step|glb|gltf|urdf|srdf|sdf|节点|零件|部件|关节|遥测|telemetry|设备映射|component\s*id|device\s*id|manifest|单位|坐标系)/i
const DIGITAL_TWIN_DIRECT = /(?:(?:cad|glb|gltf).{0,50}(?:节点|零件|部件|node|part).{0,50}(?:绑定|映射|bind|map)|(?:遥测|telemetry).{0,50}(?:模型|节点|关节|model|node|joint).{0,50}(?:状态|变换|state|transform))/i

function isDigitalTwinIntegration(text) {
    return DIGITAL_TWIN_DIRECT.test(text)
        || (DIGITAL_TWIN_CONTEXT.test(text) && DIGITAL_TWIN_INTEGRATION.test(text))
}

function hasSpecificDeviceDriverSignal(text) {
    return /(?:串口|com\d*|连接|断开|重连|自动重连|握手|通信超时|设备驱动|驱动实现|驱动开发|connect|disconnect|reconnect)/i.test(text)
}

const MEMORY_DIRECT = /(?:记住|记录下来|沉淀|整理|更新|删除|忘记|写入|保存).{0,80}(?:记忆|memory|项目约定|项目规则)|(?:记忆|memory|项目约定|项目规则).{0,80}(?:记住|记录|沉淀|整理|更新|删除|忘记|写入|保存)/i

const ROUTES = [
    {
        name: 'bridge-memory',
        match: text => MEMORY_DIRECT.test(text),
    },
    {
        name: 'digital-twin-cad',
        match: isDigitalTwinIntegration,
    },
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
        const signalMatch = typeof route.match === 'function' ? route.match(combined) : route.signals.test(combined)
        const extensionMatch = route.extensions?.test(asText(targetFiles)) || false
        if (route.name === 'device-driver' && routed.includes('digital-twin-cad') && !hasSpecificDeviceDriverSignal(combined)) {
            continue
        }
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
