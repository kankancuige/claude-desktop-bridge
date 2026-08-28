const DIGITAL_TWIN_CONTEXT = /(?:数字孪生|工业孪生|机器人孪生|digital\s+twin|industrial\s+twin|robot\s+twin|twin[._ -]?manifest|twin\.config\.ya?ml|设备三维资产)/i
const DIGITAL_TWIN_INTEGRATION = /(?:cad|step|glb|gltf|urdf|srdf|sdf|节点|零件|部件|关节|遥测|telemetry|设备映射|component\s*id|device\s*id|manifest|单位|坐标系|参考图|参考图片|reference\s+image|image[- ]?(?:to[- ]?3d|procedural|proxy)|runtime\s+proxy|generative\s+mesh|程序化模型|程序化网格|代理网格|图像建模|mesh\s*proxy|objectsculptspec|three\.js)/i
const DIGITAL_TWIN_DIRECT = /(?:(?:cad|glb|gltf).{0,50}(?:节点|零件|部件|node|part).{0,50}(?:绑定|映射|bind|map)|(?:遥测|telemetry).{0,50}(?:模型|节点|关节|model|node|joint).{0,50}(?:状态|变换|state|transform)|(?:参考图|参考图片|reference\s+image|image).{0,60}(?:程序化|procedural|代理网格|mesh\s*proxy|three\.js|模型|model).{0,60}(?:孪生|twin|运行时|runtime))/i

function isDigitalTwinIntegration(text) {
    return DIGITAL_TWIN_DIRECT.test(text)
        || (DIGITAL_TWIN_CONTEXT.test(text) && DIGITAL_TWIN_INTEGRATION.test(text))
}

function hasSpecificDeviceDriverSignal(text) {
    return /(?:串口|com\d*|连接|断开|重连|自动重连|握手|通信超时|设备驱动|驱动实现|驱动开发|connect|disconnect|reconnect)/i.test(text)
}

const MEMORY_DIRECT = /(?:记住|记录下来|沉淀|整理|更新|删除|忘记|写入|保存).{0,80}(?:记忆|memory|项目约定|项目规则)|(?:记忆|memory|项目约定|项目规则).{0,80}(?:记住|记录|沉淀|整理|更新|删除|忘记|写入|保存)/i
const INDUSTRIAL_SOLUTION_DIRECT = /(?:工业拧紧|智能拧紧|拧紧设备|扭矩校验|扭矩扳手|数字工厂|工位规划|工位管理|技术方案|项目技术方案|技术协议|招标响应|投标响应|实施方案|验收方案|方案书|MES|MOM|KMIS|LIMS|PLM|生产追溯|质量追溯|信创适配|车间大屏)/i
const ARCHITECTURE_DIAGRAM_DIRECT = /(?:当前架构图|现状架构图|目标架构图|架构演进图|系统上下文图|容器图|组件图|部署图|架构关系图|架构拓扑图|架构视图|architecture\s+(?:diagram|view)|system\s+context|container\s+diagram|component\s+diagram|deployment\s+diagram)/i
const DIAGRAM_DESIGN_DIRECT = /(?:绘制|画|生成|创建|重绘|输出|导出|可视化).{0,80}(?:架构(?:图|视图)?|系统(?:上下文|容器|组件|部署)?图?|流程图|时序图|状态(?:机)?图|实体关系图|er\s*(?:图|diagram)?|数据模型图|时间线|泳道图|雷达图|甘特图|散点图|数据流图|部署图|依赖图|uml|故事地图|看板|用户旅程|安全矩阵|sankey|鱼骨图|wardley|diagram|mermaid|draw\.io|drawio|svg|png|html)/i
const UI_INTENT = /(?:界面|页面|视图|组件|控件|按钮|文本框|表格|布局|主题|样式|ui|view|component|control|button|table|layout|theme|style)/i
const NEGATED_FRAMEWORKS = {
    vue: /(?:不要|不|无需|禁止|拒绝|勿|别).{0,20}(?:使用|用|注入|加载)?\s*(?:vue|vue3|vue\s*3|element\s*plus)/i,
    winforms: /(?:不要|不|无需|禁止|拒绝|勿|别).{0,20}(?:使用|用|注入|加载)?\s*(?:winforms|windows\s*forms|窗体)/i,
    avalonia: /(?:不要|不|无需|禁止|拒绝|勿|别).{0,20}(?:使用|用|注入|加载)?\s*avalonia/i,
}

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
        name: 'industrial-tightening-solution',
        match: text => INDUSTRIAL_SOLUTION_DIRECT.test(text),
    },
    {
        name: 'ln-75-architecture-diagram-builder',
        match: text => ARCHITECTURE_DIAGRAM_DIRECT.test(text),
    },
    {
        name: 'diagram-design',
        match: text => DIAGRAM_DESIGN_DIRECT.test(text),
    },
    {
        name: 'protocol-parser',
        signals: /(?:协议|帧|半包|粘包|字节|十六进制|hex|crc|校验和|checksum|串口帧|报文|解析器|parser)/i,
        extensions: /\.(?:c|h|cpp|cs|java|js|mjs|ts)$/i,
    },
    {
        name: 'device-driver',
        signals: /(?:扳手|串口|com\d*|连接|断开|重连|自动重连|握手|通信超时|设备驱动|驱动实现|驱动开发|plc|传感器|rfid|扫码|device\s+driver|connect|disconnect|reconnect)/i,
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
        signals: /(?:vue|element plus|pinia|vite|uni-app|uniapp)/i,
        extensions: /\.(?:vue|tsx?|jsx?)$/i,
    },
    {
        name: 'avalonia-ui',
        signals: /(?:avalonia|axaml|xaml|viewmodel|reactiveui|communitytoolkit\.mvvm)/i,
        extensions: /\.(?:axaml|xaml|cs)$/i,
    },
]

function asText(value) {
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join('\n')
    return typeof value === 'string' ? value : ''
}

function hasExplicitSkillExplanation(text) {
    return /(?:什么是|是什么意思|怎么用|怎么.{0,12}(?:注入|加载)|为何.{0,12}(?:注入|加载)|为什么.{0,12}(?:注入|加载)|是否需要|有必要|解释一下|介绍一下).*(?:skill|技能|规则|注入|加载)/i.test(text)
}

function contextFrameworks(projectContext) {
    const values = [
        ...(Array.isArray(projectContext?.frameworks) ? projectContext.frameworks : []),
        projectContext?.stack?.framework,
    ].filter(value => typeof value === 'string').join(' ').toLowerCase()
    return {
        avalonia: /avalonia/.test(values),
        vue: /vue/.test(values),
        winforms: /winforms|windows\s*forms/.test(values),
        wpf: /wpf/.test(values),
    }
}

function explicitlyRequestedFramework(text, framework) {
    if (framework === 'avalonia') return /avalonia|axaml|reactiveui|communitytoolkit\.mvvm/i.test(text)
    if (framework === 'vue') return /vue|element\s*plus|pinia|vite|uni-app|uniapp/i.test(text)
    if (framework === 'winforms') return /winforms|windows\s*forms|窗体|form\d+|datagridview|antd\s*ui/i.test(text)
    return false
}

function frameworkAllowed(name, text, targetFiles, projectContext) {
    const frameworks = contextFrameworks(projectContext)
    const knownDesktopFramework = frameworks.avalonia || frameworks.vue || frameworks.winforms || frameworks.wpf
    if (name === 'avalonia-ui') return !NEGATED_FRAMEWORKS.avalonia.test(text) && (frameworks.avalonia || (!knownDesktopFramework && /\.(?:axaml|xaml)$/i.test(targetFiles)) || (!knownDesktopFramework && explicitlyRequestedFramework(text, 'avalonia')))
    if (name === 'vue-frontend') return !NEGATED_FRAMEWORKS.vue.test(text) && (frameworks.vue || (!knownDesktopFramework && /\.vue$/i.test(targetFiles)) || (!knownDesktopFramework && explicitlyRequestedFramework(text, 'vue')))
    if (name === 'ui-winforms') return !NEGATED_FRAMEWORKS.winforms.test(text) && (frameworks.winforms || (!frameworks.avalonia && !frameworks.vue && !frameworks.wpf && explicitlyRequestedFramework(text, 'winforms')))
    return true
}

function frameworkContextMatches(name, projectContext) {
    const frameworks = contextFrameworks(projectContext)
    return name === 'avalonia-ui' ? frameworks.avalonia : name === 'vue-frontend' ? frameworks.vue : name === 'ui-winforms' ? frameworks.winforms : false
}

export function routeSkills({text = '', targetFiles = [], projectContext = null, profile = 'full', availableSkills = null, requestedSkills = null} = {}) {
    if (profile === 'light') return []
    const combined = [asText(text), asText(targetFiles)].filter(Boolean).join('\n')
    if ((!combined && !Array.isArray(requestedSkills)) || hasExplicitSkillExplanation(combined)) return []
    const targetText = asText(targetFiles)
    const routed = Array.isArray(requestedSkills)
        ? requestedSkills.filter(name => typeof name === 'string' && name.length <= 128 && frameworkAllowed(name, combined, targetText, projectContext))
        : []
    if (Array.isArray(requestedSkills)) {
        const result = [...new Set(routed)]
        return Array.isArray(availableSkills) ? result.filter(name => availableSkills.includes(name)) : result
    }
    for (const route of ROUTES) {
        const signalMatch = typeof route.match === 'function' ? route.match(combined) : route.signals.test(combined)
        const extensionMatch = route.extensions?.test(targetText) || false
        const contextMatch = frameworkContextMatches(route.name, projectContext) && UI_INTENT.test(combined)
        if (route.name === 'device-driver' && routed.includes('digital-twin-cad') && !hasSpecificDeviceDriverSignal(combined)) {
            continue
        }
        if ((signalMatch || extensionMatch || contextMatch) && frameworkAllowed(route.name, combined, targetText, projectContext)) {
            routed.push(route.name)
        }
    }
    const result = [...new Set(routed)]
    if (Array.isArray(availableSkills)) return result.filter(name => availableSkills.includes(name))
    return result
}

export function applySkillRoute(options, route) {
    if (!options || typeof options !== 'object') return options
    return {...options, skills: [...new Set(Array.isArray(route) ? route.filter(name => typeof name === 'string' && name.length <= 128) : [])]}
}
