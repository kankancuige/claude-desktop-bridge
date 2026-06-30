// github.com/kankancuige/claude-desktop-bridge
import { ref } from 'vue'

/**
 * ============================================================================
 * 轻量 i18n 架构说明
 * ============================================================================
 *
 * 这是一个零第三方依赖的国际化方案，仅依赖 Vue 3 的 ref + 一个纯函数 t()。
 * 核心思路：
 *   1. `locale` 是一个响应式 ref<Locale>，当前语言切换时所有用到 t() 的模板自动重渲染。
 *   2. `t(key, params?)` 从 messages 字典中取当前语言的文案，缺失时回退中文，再缺失则返回 key 本身。
 *   3. `setLocale(l)` 负责切换语言、持久化到 localStorage、同步 document.documentElement.lang。
 *
 * 为什么不用 vue-i18n？
 *   - 避免引入大型依赖，保持桌面端轻量。
 *   - 文案总量可控（约 200 条），手写字典完全可维护。
 *   - t() 的查找链路简单透明：当前语言 → 中文 → key 自身。
 */

// ============================================================================
// Locale 类型系统
// ============================================================================
// 仅支持两种语言：'chinese'（中文，默认）和 'english'（英文）。
// 类型别名 `Locale` 限制了 locale ref 只能取这两个字面量，防止拼写错误。
export type Locale = 'chinese' | 'english'

/**
 * 从 localStorage 读取上次保存的语言偏好。
 * 用 IIFE + try/catch 包裹是因为：
 *   - 某些浏览器隐私模式下 localStorage 可能抛异常（SecurityError）。
 *   - 读不到或值为 null 时默认回退到 'chinese'。
 */
const saved = (() => { try { return localStorage.getItem('bridge-locale') } catch { return null } })()

/**
 * 响应式的当前语言 ref。
 * 初始值：如果 localStorage 存的是 'english' 则用英文，否则默认中文。
 * 模板中访问 locale.value 会建立响应式依赖，切换语言时自动触发重渲染。
 */
export const locale = ref<Locale>(saved === 'english' ? 'english' : 'chinese')

/**
 * setLocale - 切换界面语言
 *
 * 做三件事：
 *   1. 更新 locale ref（触发所有依赖 t() 的模板重渲染）。
 *   2. 持久化到 localStorage（key: 'bridge-locale'），下次启动时恢复。
 *   3. 同步 document.documentElement.lang 属性（'zh-CN' 或 'en'），
 *      用于浏览器原生的 lang 选择器（如 :lang() CSS 伪类、拼写检查等）。
 *
 * @param l - 传入的语言标识，只认 'english' 字符串，其余一律视为中文。
 *            这样做防御性处理：传入 null/undefined/未知值不会崩，静默回退中文。
 */
export function setLocale(l: string | undefined | null) {
  locale.value = l === 'english' ? 'english' : 'chinese'
  try { localStorage.setItem('bridge-locale', locale.value) } catch {}
  try { document.documentElement.lang = locale.value === 'english' ? 'en' : 'zh-CN' } catch {}
}

/**
 * t() - 翻译函数（核心）
 *
 * 查找链路（三层回退，逐级兜底）：
 *   1. 在当前语言字典中查找 → 找到则返回。
 *   2. 在中文字典中查找（中文作为 fallback 语言，永远有完整文案）。
 *   3. 返回 key 本身（开发和调试友好：未翻译的 key 会直接显示在 UI 上，一眼可见）。
 *
 * 参数替换：
 *   - 支持 {paramName} 占位符，如 t('sys.done', { turns: 3, ms: 120 })。
 *   - 单次正则全局替换所有占位符，避免每个参数各建一个 RegExp。
 *   - 参数值通过 String() 转换，数字可直接传入。
 *
 * @param key    - 文案键，如 'common.save'、'sys.done'
 * @param params - 可选，键值对，用于替换文案中的 {xxx} 占位符
 * @returns       - 替换后的最终文案字符串
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = (messages[locale.value] as Record<string, string>)[key]
    ?? (messages.chinese as Record<string, string>)[key]
    ?? key
  if (params) s = s.replace(/\{(\w+)\}/g, (match, key) => key in params ? String(params[key]) : match)
  return s
}

/**
 * ============================================================================
 * messages 字典 - 所有文案集中于此
 * ============================================================================
 *
 * 结构：Record<Locale, Record<string, string>>
 *   - 第一层 key: 'chinese' | 'english'
 *   - 第二层 key: 点分命名空间（如 'common.save'、'ws.copy'）
 *
 * 命名空间约定（前缀）：
 *   - common.*    : 通用（按钮、标签、操作文案）
 *   - header.*    : 顶栏/标题区
 *   - tab.*       : 设置页的 Tab 标签
 *   - gen.*       : 常规设置页（provider、模型、API、主题、语言等）
 *   - qr.*        : 二维码绑定弹窗（微信/飞书/钉钉）
 *   - skills.*    : Skills 管理页
 *   - agents.*    : Agents（自定义子代理）管理页
 *   - cmd.*       : 命令列表页（斜杠命令）
 *   - hooks.*     : Hooks（事件钩子）管理页
 *   - rules.*     : Rules（编码规则）管理页
 *   - mem.*       : Memory（项目记忆）管理页
 *   - mcp.*       : MCP 协议服务器配置页
 *   - im.*        : IM 连接页（微信/飞书/钉钉）
 *   - ws.*        : 工作区（Workspace）侧栏、气泡、输入区、确认横幅、文件面板、记录点等
 *   - perm.*      : 权限模式文案
 *   - think.*     : 思考级别文案
 *   - time.*      : 相对时间文案（timeAgo）
 *   - sys.*       : 系统消息/状态文案
 *   - err.*       : 错误消息文案
 *   - claudeMissing.* : Claude Code 未找到弹窗
 *
 * 编辑规则：
 *   - 所有 key 必须同时在 chinese 和 english 字典中存在，否则英文版会回退中文。
 *   - 不允许修改已有 key 名（会破坏模板引用），只能新增或删除。
 *   - 值中的占位符用 {paramName} 形式，与 t() 的参数名对应。
 */

const messages: Record<Locale, Record<string, string>> = {
  // ============================================================================
  // 中文文案字典
  // ============================================================================
  chinese: {
    // ────────────────────────────────────────────────────────────────────────
    // 通用（common）—— 跨页面复用的按钮、标签、操作反馈
    // ────────────────────────────────────────────────────────────────────────
    'common.loading': '加载中...',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.saved': '已保存',
    'common.create': '创建',
    'common.confirm': '确认',
    'common.tip': '提示',
    'common.ok': '确定',
    'common.new': '+ 新建',
    'common.all': '全部',
    'common.noDesc': '无描述',
    'common.delete': '删除',
    'common.refresh': '刷新',
    'common.builtin': '内置',
    'common.custom': '自定义',
    'common.disabled': '已禁用',
    'common.retry': '重试',
    'common.retryMaxed': '已达最大重试次数',
    'common.loadFailed': '加载失败',
    'common.readOnly': '只读',
    'common.createFailed': '创建失败: ',
    'common.saveFailed': '保存失败',
    'common.saving': '保存中...',

    // ────────────────────────────────────────────────────────────────────────
    // 顶栏 / Tabs（header + tab）—— 设置页标题栏和 Tab 导航标签
    // ────────────────────────────────────────────────────────────────────────
    'header.back': '返回工作区',
    'header.title': '配置管理',
    'header.sub': 'Claude Desktop Bridge Settings',
    'tab.general': '常规', 'tab.general.desc': '模型、权限与连接配置',
    'tab.skills': 'Skills', 'tab.skills.desc': 'AI 技能模块管理',
    'tab.agents': 'Agents', 'tab.agents.desc': '自定义子代理管理',
    'tab.commands': '命令', 'tab.commands.desc': '可用斜杠命令列表',
    'tab.hooks': 'Hooks', 'tab.hooks.desc': '事件钩子与自动化',
    'tab.rules': 'Rules', 'tab.rules.desc': '编码规则与规范',
    'tab.memory': 'Memory', 'tab.memory.desc': '项目记忆管理',
    'tab.mcp': 'MCP', 'tab.mcp.desc': '协议服务器配置',
    'tab.im': 'IM 连接', 'tab.im.desc': '微信/飞书/钉钉接入',
    'tab.workflow': 'Workflow', 'tab.workflow.desc': '多 Agent JS 编排脚本',
    'tab.scheduler': '定时任务', 'tab.scheduler.desc': 'Cron 定时执行',
    'tab.oss': '开源集成', 'tab.oss.desc': '开源项目版本管理与配置',

    // ────────────────────────────────────────────────────────────────────────
    // 常规页（gen）—— AI 供应商选择、模型配置、API Key、主题/语言切换
    // ────────────────────────────────────────────────────────────────────────
    'gen.provider': 'AI 供应商',
    'gen.modelsCount': '{n} 模型',
    'gen.apiConfig': 'API 配置',
    'gen.apiKeyPlaceholder': '输入 API Key...',
    'gen.apiKeyUnset': '未设置',
    'gen.officialSite': '官方网站',
    'gen.apiDocs': 'API 文档',
    'gen.defaultModel': '默认模型',
    'gen.modelDynamic': '动态',
    'gen.modelPreset': '预设',
    'gen.customModelId': '自定义模型 ID',
    'gen.customModelHint': '此供应商无预设模型，请在上方自定义模型 ID 框中输入',
    'gen.other': '其他设置',
    'gen.maxContext': '最大上下文 (tokens)',
    'gen.costLimit': '费用提醒阈值 (占余额 %)',
    'gen.costLimitHint': '本会话累计费用达余额此百分比时提醒一次，0 = 关闭',
    'gen.maxTurns': '单次最大轮数 (maxTurns)',
    'gen.maxTurnsHint': '单次请求最多 agent 轮数，防失控 tool 循环。默认 40',
    'gen.fileInject': '#文件注入上限 (KB)',
    'gen.fileInjectHint': '单条消息 # 引用文件内容注入的总量上限，超出截断/跳过。默认 200，0 = 不注入内容',
    'gen.theme': '主题',
    'gen.theme.system': '跟随系统', 'gen.theme.dark': 'Dark', 'gen.theme.light': 'Light',
    'gen.language': '语言',
    'gen.lang.zh': '中文', 'gen.lang.en': 'English',
    'gen.pet': '桌面宠物',
    'gen.pet.repo': '项目地址',
    'gen.saveBtn': '保存配置',
    'gen.enable': '启用',
    'gen.savedOk': '配置已保存',
    'gen.updateAvailable': '发现新版本 {version}',
    'gen.updateDownload': '下载更新',
    'gen.updateReady': '更新已就绪',
    'gen.updateReadyHint': '版本 {version} 已下载完成，是否立即重启安装？',
    'gen.updateInstall': '重启安装',
    'gen.updateChecking': '检查中...',
    'gen.updateCheck': '检查更新',
    'gen.updateUpToDate': '已是最新版本',
    'gen.updateFailed': '检查更新失败: {msg}',
    'gen.updateProgress': '下载中 {pct}%',
    'gen.show': '显示', 'gen.hide': '隐藏',
    'gen.testConn': '测试连接', 'gen.testing': '测试中...', 'gen.testOk': '连接成功 ({n} 模型)', 'gen.testFail': '连接失败',

    // Caveman 输出压缩
    'gen.caveman.desc': '内置 Caveman 压缩模式，减少 Claude 回复的 output token 消耗（MIT 开源）',
    'gen.caveman.level': '压缩级别',
    'gen.caveman.currentVersion': '当前版本',
    'gen.caveman.selectVersion': '切换版本',
    'gen.caveman.updateBtn': '更新',
    'gen.caveman.updateHint': 'Caveman 新版本 {latest} 可用（当前 {current}）。选择版本点击更新自动下载替换。',
    'gen.caveman.updateOk': 'Caveman 更新完成！',
    'gen.caveman.updateFail': 'Caveman 更新失败: {msg}',
    'gen.caveman.repo': '开源地址',
    // RTK Bash 压缩
    'gen.rtk.desc': '内置 RTK 压缩引擎，减少 Bash 命令输出的 input token 消耗（MIT 开源）',
    'gen.rtk.unavailable': '当前平台未内置 RTK 二进制，压缩不可用',
    'gen.rtk.updateHint': 'RTK 新版本 {latest} 可用（当前内置 {current}）。选择版本点击更新自动下载替换。',
    'gen.rtk.updateBtn': '更新',
    'gen.rtk.updateOk': 'RTK 更新完成！',
    'gen.rtk.updateFail': 'RTK 更新失败: {msg}',
    'gen.rtk.currentVersion': '当前版本',
    'gen.rtk.selectVersion': '切换版本',
    'gen.rtk.repo': '开源地址',

    // ────────────────────────────────────────────────────────────────────────
    // QR 绑定弹窗（qr）—— 微信/飞书/钉钉扫码绑定流程的 UI 状态文案
    // 状态流转：生成中 → 等待扫码 → 已扫码 → 绑定成功 / 过期 → 重新生成
    // ────────────────────────────────────────────────────────────────────────
    'qr.wechatTitle': '微信扫码绑定', 'qr.feishuTitle': '飞书应用绑定', 'qr.dingTitle': '钉钉应用绑定',
    'qr.generating': '正在生成二维码...',
    'qr.wait': '请使用微信扫描二维码', 'qr.scanned': '已扫码，请在手机上确认',
    'qr.confirmed': '绑定成功！刷新中...', 'qr.expired': '二维码已过期，请重试',
    'qr.regen': '重新生成',

    // ────────────────────────────────────────────────────────────────────────
    // Skills 管理页 —— AI 技能模块的 CRUD 操作文案
    // ────────────────────────────────────────────────────────────────────────
    'skills.namePlaceholder': 'Skill 名称 (kebab-case)',
    'skills.descPlaceholder': '描述 (可选)',
    'skills.empty': '暂无 Skills',
    'skills.editTitle': '编辑: {name}',
    'skills.market': 'Skills 市场',
    'skills.marketPlaceholder': '搜索 skills.sh 市场...',
    'skills.searchPlaceholder': '过滤或回车搜索市场...',
    'skills.search': '搜索',
    'skills.install': '安装',
    'skills.installing': '安装中...',
    'skills.marketEmpty': '未找到匹配的 Skill',
    'skills.installedToast': '已安装: {name}',

    // ────────────────────────────────────────────────────────────────────────
    // Agents 管理页 —— 自定义子代理的 CRUD、工具继承、模型配置
    // ────────────────────────────────────────────────────────────────────────
    'agents.count': '共 {n} 个 Agent · 文件位于 ~/.claude/agents/',
    'agents.editTitle': '编辑 Agent: {name}',
    'agents.namePlaceholder': 'Agent 名称 (kebab-case)',
    'agents.typePlaceholder': 'Type (选择或自定义, 如 reviewer)',
    'agents.languagePlaceholder': 'Language (如 java, csharp)',
    'agents.descPlaceholder': '何时使用此 agent（描述）',
    'agents.toolsPlaceholder': '允许的工具 (逗号分隔，留空=继承全部)',
    'agents.modelInherit': 'inherit（继承主模型）',
    'agents.loaded': '已加载',
    'agents.inheritAll': '继承全部工具',
    'agents.empty': '暂无自定义 Agents',
    'agents.confirmDelete': '确定删除 agent「{name}」?（会保留 .bak 备份）',

    // ────────────────────────────────────────────────────────────────────────
    // 命令列表页（cmd）—— 斜杠命令的搜索、展示、缓存状态
    // ────────────────────────────────────────────────────────────────────────
    'cmd.count': '共 {n} 个命令',
    'cmd.live': '实时', 'cmd.cached': '缓存',
    'cmd.searchPlaceholder': '搜索命令...',
    'cmd.cacheHint': '提示：命令列表需要活跃会话填充，若为「缓存」可先在工作区打开一个会话后刷新。',
    'cmd.empty': '暂无命令',

    // ────────────────────────────────────────────────────────────────────────
    // Hooks 管理页 —— 事件钩子脚本的创建和分组展示
    // ────────────────────────────────────────────────────────────────────────
    'hooks.groupCount': '共 {n} 个事件组',
    'hooks.filenamePlaceholder': '文件名 (e.g. my-hook.sh)',
    'hooks.searchPlaceholder': '搜索 hook...',

    // ────────────────────────────────────────────────────────────────────────
    // Rules 管理页 —— 编码规则的 CRUD、路径过滤配置
    // ────────────────────────────────────────────────────────────────────────
    'rules.filenamePlaceholder': '文件名 (e.g. python.md)',
    'rules.pathsPlaceholder': 'paths (e.g. **/*.py)',
    'rules.noPaths': '无路径限制',
    'rules.empty': '暂无 Rules',
    'rules.searchPlaceholder': '搜索 Rule...',

    // ────────────────────────────────────────────────────────────────────────
    // Memory 管理页 —— 项目记忆文件的扫描、列表展示、创建、删除
    // ────────────────────────────────────────────────────────────────────────
    'mem.scanning': '扫描项目 memory...',
    'mem.emptyTitle': '未发现任何项目记忆',
    'mem.emptyHint1': 'Memory 文件存放在各项目的 ~/.claude/projects/项目名/memory/ 目录下',
    'mem.emptyHint2': '当你和 Claude 对话中保存记忆时，这里会自动出现',
    'mem.totalFiles': '共 {n} 个记忆文件',
    'mem.refresh': '↻ 刷新',
    'mem.fileCount': '{n} 个文件',
    'mem.newPlaceholder': '新记忆文件名...',
    'mem.loadingFiles': '加载中...',
    'mem.noFiles': '暂无记忆文件，在上方输入文件名创建',
    'mem.confirmDelete': '确定删除 {name} ?',

    // ────────────────────────────────────────────────────────────────────────
    // MCP 配置页 —— 已安装插件列表、启用/禁用状态、自定义 Server 说明
    // ────────────────────────────────────────────────────────────────────────
    'mcp.installed': '已安装插件 · {n} 个',
    'mcp.installedBadge': '已安装',
    'mcp.enabled': '已启用', 'mcp.disabled': '已禁用',
    'mcp.empty': '暂无已安装的 MCP 插件',
    'mcp.customTitle': '自定义 MCP Server',
    'mcp.customDesc': '在 ~/.claude/settings.json 的 mcpServers 字段中配置',
    'mcp.tip': '修改后重启 Claude Code 生效',
    'mcp.serversTitle': 'MCP 服务器',
    'mcp.serversEmpty': '尚未配置 MCP 服务器，点击 + 新增',
    'mcp.newServer': '新增 MCP 服务器',
    'mcp.editServer': '编辑 MCP 服务器',
    'mcp.serverName': '名称',
    'mcp.namePlaceholder': 'my-mcp-server',
    'mcp.deleteConfirm': '确认删除',
    'mcp.deleteHint': '确定删除 MCP 服务器「{name}」吗？',

    // ────────────────────────────────────────────────────────────────────────
    // IM 连接页（im）—— 微信/飞书/钉钉的绑定状态、扫码绑定、解绑、配置说明
    // ────────────────────────────────────────────────────────────────────────
    'im.wechat': '微信', 'im.feishu': '飞书', 'im.dingtalk': '钉钉',
    'im.statusRunning': '已连接', 'im.statusConfigured': '已配置', 'im.statusInactive': '未配置',
    'im.apiAddr': 'API 地址',
    'im.boundUsers': '已绑定用户',
    'im.boundUsersN': '{n} 个',
    'im.bound': '已绑定', 'im.bindQr': '扫码绑定', 'im.bindCred': '绑定凭证',
    'im.unbind': '解绑', 'im.unbindConfirmHint': '将清除凭证和绑定信息，此操作不可撤销。', 'im.unbinding': '解绑中...', 'im.unbound': '已解绑',
    'im.viewConfig': '查看配置',
    'im.noPlatform': '暂无 IM 平台配置',
    'im.noteTitle': '绑定说明',
    'im.note1': 'IM 连接通过 ~/.claude/adapters.json 管理。微信使用 iLink Bot API，飞书/钉钉需在开放平台创建应用获取凭证。',
    'im.note2': '当前微信适配器已集成在 Gateway 中（wechat.mjs），启动 Gateway 后自动开始轮询微信消息。',

    // ────────────────────────────────────────────────────────────────────────
    // 工作区侧栏（ws. 前缀的多个子区域）
    // ------------------------------------------------------------------------
    // 侧栏顶层：项目列表、搜索、会话管理
    // ────────────────────────────────────────────────────────────────────────
    'ws.searchPlaceholder': '搜索项目...',
    'ws.projects': '项目',
    'ws.addProject': '新增项目（选择文件夹）',
    'ws.noMatch': '无匹配项目',
    'ws.notFound': '未找到项目',
    'ws.ensureGateway': '请确保 Gateway 已启动',
    'ws.newSession': '新建会话',
    'ws.sessionsCount': '{n} 会话',
    'ws.activeConn': '活跃连接',
    'ws.showAllSessions': '显示全部 session ({n})',
    'ws.collapse': '收起',
    'ws.showAllProjects': '显示全部项目 ({n})',
    'ws.settings': '设置',
    'ws.workflow': '工作流',
    'ws.refreshReorder': '刷新（按最近活跃重新排序）',

    // ────────────────────────────────────────────────────────────────────────
    // 欢迎页 / 头部 —— 初始引导文案、状态指示、文件面板开关、微信同步
    // ────────────────────────────────────────────────────────────────────────
    'ws.welcomeHint': '选择项目开始会话，或输入自定义目录创建',
    'ws.statusThinking': '思考中', 'ws.statusReady': '就绪', 'ws.statusOffline': '离线',
    'ws.filePanelToggle': '项目文件 / 改动',
    'ws.mirrorOn': '同步开启', 'ws.mirrorOff': '同步关闭', 'ws.mirrorUnbound': '未绑定，请先在设置页配置',
    'ws.wechat': '微信',

    // ────────────────────────────────────────────────────────────────────────
    // 消息气泡 —— 对话气泡中的操作按钮（复制、回填）、工具调用、思考内容
    // ────────────────────────────────────────────────────────────────────────
    'ws.copy': '复制', 'ws.copied': '已复制', 'ws.refill': '回填到输入框',
    'ws.export': '导出', 'ws.exportMD': 'Markdown', 'ws.exportJSON': 'JSON (完整)', 'ws.exportJSONL': 'JSONL (CLI兼容)',
    'ws.exportTime': '导出时间', 'ws.scrollBottom': '回到底部',
    'ws.toolsOps': '{n} 个工具操作',
    'ws.thinkBadge': '思考', 'ws.thinkContent': '思考内容', 'ws.thinking': '深度思考中...', 'ws.thinkDone': '思考完成',

    // ────────────────────────────────────────────────────────────────────────
    // 输入区 —— 消息输入框的 placeholder、队列状态、补充指令操作
    // ────────────────────────────────────────────────────────────────────────
    'ws.inputThinking': '思考中... 输入消息将加入队列',
    'ws.inputPlaceholder': '输入消息... (Enter 发送, Shift+Enter 换行, / 命令, # 文件, @ 代理)',
    'ws.stopRefill': '停止并回填内容',
    'ws.queueSupplement': '补充指令', 'ws.queuePending': '待发送',
    'ws.injectNow': '中断并注入补充指令', 'ws.sendNow': '立即发送', 'ws.remove': '移除',

    // ────────────────────────────────────────────────────────────────────────
    // 确认横幅 —— 工具调用授权提示（允许/拒绝/选择）
    // ────────────────────────────────────────────────────────────────────────
    'ws.needAuth': '需要授权: {tool}',
    'ws.deny': '拒绝', 'ws.allow': '允许', 'ws.choose': '请选择',

    // ────────────────────────────────────────────────────────────────────────
    // Toast 通知 —— 即时反馈提示（操作结果、状态变更、错误提醒）
    // ────────────────────────────────────────────────────────────────────────
    'ws.taskCanceled': '任务已取消',
    'ws.allowed': '已允许 {tool}', 'ws.denied': '已拒绝 {tool}',
    'ws.chose': '已选择: {label}',
    'ws.injected': '已注入补充指令',
    'ws.notConnected': '未连接会话',
    'ws.thinkingWait': '正在思考中，请稍后再执行 /compact',
    'ws.mirrorOnToast': '已开启，回复将同步到对应平台', 'ws.mirrorOffToast': '已关闭同步',
    'ws.gatewayDown': 'Gateway 未启动或已崩溃。日志: exe同目录 gateway.log',

    // ────────────────────────────────────────────────────────────────────────
    // 文件面板 —— 工作目录文件浏览、基线管理、改动查看、DIFF 对比
    // ────────────────────────────────────────────────────────────────────────
    'ws.fpTitle': '项目文件',
    'ws.fpRefresh': '刷新文件列表',
    'ws.close': '关闭',
    'ws.fpAll': '全部', 'ws.fpChanged': '仅改动',
    'ws.fpBaseline': '基线 {time}', 'ws.fpNoBaseline': '无基线',
    'ws.fpMissing': '工作目录不存在',
    'ws.fpNoChanged': '没有改动的文件', 'ws.fpNoFiles': '没有文件',
    'ws.fpTruncated': '文件过多，已截断显示',

    // ────────────────────────────────────────────────────────────────────────
    // 记录点（Checkpoints）—— 每轮 AI 修改自动保存，支持提交和撤销
    // ────────────────────────────────────────────────────────────────────────
    'ws.cpTab': '记录点', 'ws.cpDesc': '记录点 · 每轮 AI 修改自动生成',
    'ws.commit': '提交修改', 'ws.committing': '提交中',
    'ws.commitTitle': '将当前状态定为新基线并清空记录点',
    'ws.cpEmpty': '暂无记录点',
    'ws.cpFiles': '{n} 文件', 'ws.cpNoInput': '(无输入)',
    'ws.revert': '撤销',
    'ws.revertTip': '撤销到此记录点之前的状态', 'ws.revertDisabled': '含二进制/超大文件，不可回退',
    'ws.notRevertible': '不可回退',

    // ────────────────────────────────────────────────────────────────────────
    // Diff / 文件 Modal —— 文件对比和预览弹窗的模式切换
    // ────────────────────────────────────────────────────────────────────────
    'ws.diffMode': 'DIFF', 'ws.fileMode': '文件',
    'ws.binaryNoPreview': '二进制文件，无法预览', 'ws.binaryNoDiff': '二进制文件，无法对比',
    'ws.fileSaved': '文件已保存: {path}',
    'err.saveFail': '保存失败: {msg}',
    'ws.tooLargeNoDiff': '文件过大，无法生成行级对比', 'ws.noDiff': '无差异',

    // ────────────────────────────────────────────────────────────────────────
    // 确认弹窗 —— 提交修改、撤销文件、删除会话的二次确认文案
    // ────────────────────────────────────────────────────────────────────────
    'ws.commitConfirmTitle': '提交修改',
    'ws.commitConfirmBody': '将把当前文件状态记录为新的基线，所有记录点会被清空，之前的改动视为已完成（文件面板「仅改动」归零）。此操作不修改磁盘文件本身，但记录点清空后无法再回退到更早状态。',
    'ws.confirmCommit': '确认提交',
    'ws.commitFilesTitle': '提交文件',
    'ws.commitFilesBody': '已选择 {n} 个变更文件，提交后将更新基线快照并清空记录点。未选中的文件保持当前变更状态。',
    'ws.commitFilesSelectAll': '全选',
    'ws.commitFilesDeselectAll': '取消全选',
    'ws.fpCommit': '提交',
    'ws.rewindTitle': '撤销文件修改',
    'ws.rewindBody': '将把工作目录回退到记录点「{prompt}」之前的状态：该记录点及其之后所有轮次的文件改动都会被还原（新增文件删除、修改/删除文件写回）。此操作直接写磁盘，不可撤销。',
    'ws.confirmRewind': '确认撤销', 'ws.rewinding': '回退中...',
    'ws.unsavedTitle': '未保存的更改',
    'ws.unsavedBody': '文件「{path}」有未保存的更改，是否在关闭前保存？',
    'ws.unsavedSave': '保存并关闭',
    'ws.unsavedDiscard': '放弃更改',
    'ws.deleteSessionTitle': '删除会话',
    'ws.deleteSessionBody': '确定要删除此会话吗？其对话记录将被永久移除，此操作不可撤销。',
    'ws.closeTabTitle': '关闭标签页',
    'ws.closeTabBody': '关闭标签页将断开当前会话的连接，进行中的任务将被中断。未提交的文件变更不受影响。确定关闭？',
    'ws.closeTabConfirm': '确认关闭',

    // ────────────────────────────────────────────────────────────────────────
    // 上下文圆环（Context Ring）—— 上下文用量可视化、token 统计、费用追踪
    // ────────────────────────────────────────────────────────────────────────
    'ws.ctxRingTitle': '点击执行 /compact 压缩上下文',
    'ws.ctxHint': '上下文已用 {pct}%，建议压缩(/compact)或新开会话',
    'ws.ttUsed': '已用', 'ws.ttPct': '占比', 'ws.ttInput': '输入', 'ws.ttThink': '思考',
    'ws.ttOutput': '输出', 'ws.ttCostTurn': '本句费用', 'ws.ttCostTotal': '累计费用', 'ws.ttRemaining': '剩余余额',

    // ────────────────────────────────────────────────────────────────────────
    // 控制条 —— 底部模型选择、权限模式、思考级别切换器
    // ────────────────────────────────────────────────────────────────────────
    'ws.ctlModel': '模型', 'ws.ctlPerm': '权限', 'ws.ctlThink': '思考',
    'ws.tokenMiniTip': '本轮 token · 思考为估算值, 输出已扣除思考估值',

    // ────────────────────────────────────────────────────────────────────────
    // 权限模式（perm）—— 工具调用的四种授权策略
    // ────────────────────────────────────────────────────────────────────────
    'perm.default': '询问权限', 'perm.acceptEdits': '接受编辑', 'perm.plan': '计划模式', 'perm.bypass': '全部自动',

    // ────────────────────────────────────────────────────────────────────────
    // 思考级别（think）—— Claude 深度思考的六个档位
    // ────────────────────────────────────────────────────────────────────────
    'think.auto': '自动', 'think.off': '关闭', 'think.low': '低', 'think.medium': '中', 'think.high': '高', 'think.xhigh': '很高', 'think.max': '最大',

    // ────────────────────────────────────────────────────────────────────────
    // 相对时间（timeAgo）—— 会话列表中"多久之前"的简短表述
    // ────────────────────────────────────────────────────────────────────────
    'time.now': '刚刚', 'time.min': '{n} 分钟前', 'time.hour': '{n} 小时前', 'time.day': '{n} 天前',

    // ────────────────────────────────────────────────────────────────────────
    // 子代理（agent）—— 多 Agent 协作时的状态提示
    // ────────────────────────────────────────────────────────────────────────
    'agent.spawning': '正在启动子代理...',
    'agent.running': '子代理运行中: {name}',
    'agent.done': '子代理完成: {name}',
    'agent.error': '子代理错误: {name}',

    // ────────────────────────────────────────────────────────────────────────
    // 系统/错误消息（sys + err）—— 连接状态、完成统计、回退/提交结果、费用提醒
    // ────────────────────────────────────────────────────────────────────────
    'sys.history': '加载了 {n} 条历史消息',
    'sys.connected': '已连接 · {id}...', 'sys.connectedResume': '已连接 · {id}... (恢复上文)',
    // ── 工作流（wf）── DAG 编排设计器
    'wf.title': '工作流编排',
    'wf.back': '返回工作区',
    'wf.new': '新建工作流',
    'wf.submit': '提交执行',
    'wf.submitting': '提交中...',
    'wf.wave': '第 {n} 波',
    'wf.waveTotal': '第 {n}/{total} 波',
    'wf.pending': '等待中',
    'wf.running': '执行中',
    'wf.done': '已完成',
    'wf.error': '错误',
    'wf.agentToolbox': 'Agent',
    'wf.addStep': '添加节点',
    'wf.isolating': '创建隔离环境...',
    'wf.selectAgent': '选择 Agent 类型',
    'wf.promptLabel': '任务描述',
    'wf.promptPlaceholder': '描述这个 step 要完成的任务...',
    'wf.modelLabel': '模型',
    'wf.maxTurnsLabel': '最大轮数',
    'wf.allowedToolsLabel': '允许工具(逗号分隔,留空=全部)',
    'wf.canvasEmpty': '从左侧拖拽 Agent 到画布, 或点击下方按钮添加节点',
    'wf.drawDependency': '连线建依赖',
    'wf.started': '工作流已启动',

    'sys.model': '模型: {model} · {cwd}',
    'sys.done': '完成 · {turns} 轮 · {ms}ms · ↓{in} ~{think} ↑{out}',
    'sys.reverted': '已撤销到记录点「{prompt}」· 回退 {n} 个文件',
    'sys.revertedSkip': ' · {n} 个不可回退已跳过',
    'sys.committed': '已提交修改 · 新基线含 {n} 个文件，记录点已清空',
    'sys.committedSelective': '已提交 {n} 个文件 · 保留 {kept} 个记录点',
    'err.revertFail': '回退失败: {msg}', 'err.commitFail': '提交失败: {msg}',
    'err.clickSettings': ' 请点设置', 'err.connectFail': '连接失败: {msg}',
    'ws.projAdded': '当前项目已添加',
    'ws.promptDir': '输入项目文件夹绝对路径（如 D:/projects/foo）',
    'ws.costToast': '本会话费用 ¥{cost} 已达余额的 {pct}%，注意 token 消耗',
    'ws.nudgeSwitched': '桌面端已切换到 {label}',
    'ws.nudgeNewSession': '已在 {label} 创建新会话',
    'ws.nudgeStopped': '已发送停止指令',
    'ws.deleteFailed': '删除失败，请重试',
    'ws.hideProject': '隐藏项目',
    'ws.showProject': '显示项目',
    'ws.hiddenProjects': '已隐藏项目',
    'ws.noHiddenProjects': '无隐藏项目',

    // ────────────────────────────────────────────────────────────────────────
    // Claude 未找到弹窗 —— 首次启动时检测到 claude CLI 不可用的引导提示
    // ────────────────────────────────────────────────────────────────────────
    'claudeMissing.title': '未找到 Claude Code',
    'claudeMissing.desc': '程序在以下位置均未找到 Claude Code 安装，请确保已通过以下方式之一安装：',
    'claudeMissing.opt1': 'npm install -g @anthropic-ai/claude-code',
    'claudeMissing.opt2': '或从 anthropic.com 下载原生安装包',
    'claudeMissing.opt3': '安装后请确保 claude 命令在 PATH 中可用，然后重启本程序',
    'claudeMissing.retry': '重新检测',
    'claudeMissing.checking': '检测中...',
    'claudeMissing.manual': '或手动指定 Claude Code 路径',
    'claudeMissing.manualWin': '如 C:\\Users\\用户名\\AppData\\Local\\Claude-3p\\claude-code\\2.1.181\\claude.exe',
    'claudeMissing.manualMac': '如 /Applications/Claude.app/Contents/MacOS/claude 或 /opt/homebrew/bin/claude',
    'claudeMissing.manualLinux': '如 /usr/local/bin/claude 或 ~/.local/bin/claude',
    'claudeMissing.pathLabel': 'Claude Code 可执行文件路径',
    'claudeMissing.pathPlaceholder': '输入 claude 可执行文件的完整路径...',
    'claudeMissing.checkPath': '检测此路径',
    'claudeMissing.checkingPath': '检测中...',
    'claudeMissing.foundOk': '已找到: {path}',
    'claudeMissing.notFound': '此路径不存在或无效',
    'claudeMissing.savePath': '保存并继续',
    'claudeMissing.saved': '已保存',
  },

  // ============================================================================
  // 英文文案字典
  // ============================================================================
  english: {
    // ── Common ──
    'common.loading': 'Loading...',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.saved': 'Saved',
    'common.create': 'Create',
    'common.confirm': 'Confirm',
    'common.tip': 'Tip',
    'common.ok': 'OK',
    'common.new': '+ New',
    'common.all': 'All',
    'common.noDesc': 'No description',
    'common.delete': 'Delete',
    'common.refresh': 'Refresh',
    'common.builtin': 'Built-in',
    'common.custom': 'Custom',
    'common.retry': 'Retry',
    'common.retryMaxed': 'Max retries reached',
    'common.loadFailed': 'Load failed',
    'common.readOnly': 'Read-only',
    'common.createFailed': 'Create failed: ',
    'common.saveFailed': 'Save failed',
    'common.saving': 'Saving...',

    // ── Header / Tabs ──
    'header.back': 'Back to Workspace',
    'header.title': 'Settings',
    'header.sub': 'Claude Desktop Bridge Settings',
    'tab.general': 'General', 'tab.general.desc': 'Model, permissions & connection',
    'tab.skills': 'Skills', 'tab.skills.desc': 'AI skill modules',
    'tab.agents': 'Agents', 'tab.agents.desc': 'Custom sub-agents',
    'tab.commands': 'Commands', 'tab.commands.desc': 'Available slash commands',
    'tab.hooks': 'Hooks', 'tab.hooks.desc': 'Event hooks & automation',
    'tab.rules': 'Rules', 'tab.rules.desc': 'Coding rules & conventions',
    'tab.memory': 'Memory', 'tab.memory.desc': 'Project memory',
    'tab.mcp': 'MCP', 'tab.mcp.desc': 'Protocol servers',
    'tab.im': 'IM', 'tab.im.desc': 'WeChat / Feishu / DingTalk',
    'tab.workflow': 'Workflow', 'tab.workflow.desc': 'Multi-agent JS orchestration',
    'tab.scheduler': 'Scheduler', 'tab.scheduler.desc': 'Cron scheduled tasks',
    'tab.oss': 'Open Source', 'tab.oss.desc': 'Open-source project versions & config',

    // ── General ──
    'gen.provider': 'AI Provider',
    'gen.modelsCount': '{n} models',
    'gen.apiConfig': 'API Config',
    'gen.apiKeyPlaceholder': 'Enter API Key...',
    'gen.apiKeyUnset': 'Not set',
    'gen.officialSite': 'Website',
    'gen.apiDocs': 'API Docs',
    'gen.defaultModel': 'Default Model',
    'gen.modelDynamic': 'dynamic',
    'gen.modelPreset': 'preset',
    'gen.customModelId': 'Custom Model ID',
    'gen.customModelHint': 'No preset models. Enter your model ID in the field above.',
    'gen.other': 'Other Settings',
    'gen.maxContext': 'Max Context (tokens)',
    'gen.costLimit': 'Cost Alert Threshold (% of balance)',
    'gen.costLimitHint': 'Alert once when session cost reaches this % of balance. 0 = off',
    'gen.maxTurns': 'Max Turns per Request',
    'gen.maxTurnsHint': 'Max agent turns per request, prevents runaway tool loops. Default 40',
    'gen.fileInject': '#File Inject Limit (KB)',
    'gen.fileInjectHint': 'Total size of # referenced file content injected per message; over is truncated/skipped. Default 200, 0 = no inject',
    'gen.theme': 'Theme',
    'gen.theme.system': 'System', 'gen.theme.dark': 'Dark', 'gen.theme.light': 'Light',
    'gen.language': 'Language',
    'gen.lang.zh': '中文', 'gen.lang.en': 'English',
    'gen.pet': 'Desktop Pet',
    'gen.pet.repo': 'Project',
    'gen.saveBtn': 'Save',
    'gen.enable': 'Enable',
    'gen.savedOk': 'Saved',
    'gen.updateAvailable': 'New version {version} available',
    'gen.updateDownload': 'Download',
    'gen.updateReady': 'Update Ready',
    'gen.updateReadyHint': 'Version {version} has been downloaded. Restart to install?',
    'gen.updateInstall': 'Restart & Install',
    'gen.updateChecking': 'Checking...',
    'gen.updateCheck': 'Check for Updates',
    'gen.updateUpToDate': 'Up to date',
    'gen.updateFailed': 'Update check failed: {msg}',
    'gen.updateProgress': 'Downloading {pct}%',
    'gen.show': 'Show', 'gen.hide': 'Hide',
    'gen.testConn': 'Test Connection', 'gen.testing': 'Testing...', 'gen.testOk': 'Connected ({n} models)', 'gen.testFail': 'Connection Failed',

    // Caveman output compression
    'gen.caveman.desc': 'Built-in Caveman compression mode to reduce Claude output tokens (MIT)',
    'gen.caveman.level': 'Level',
    'gen.caveman.currentVersion': 'Current version',
    'gen.caveman.selectVersion': 'Switch version',
    'gen.caveman.updateBtn': 'Update',
    'gen.caveman.updateHint': 'Caveman {latest} available (current: {current}). Select version and click Update.',
    'gen.caveman.updateOk': 'Caveman updated!',
    'gen.caveman.updateFail': 'Caveman update failed: {msg}',
    'gen.caveman.repo': 'Repository',

    // RTK bash compression
    'gen.rtk.desc': 'Built-in RTK compression engine to reduce Bash command output tokens (MIT)',
    'gen.rtk.unavailable': 'RTK binary not bundled for this platform — compression unavailable',
    'gen.rtk.updateHint': 'RTK {latest} available (built-in: {current}). Select version and click Update to auto-download and replace.',
    'gen.rtk.updateBtn': 'Update',
    'gen.rtk.updateOk': 'RTK updated successfully!',
    'gen.rtk.updateFail': 'RTK update failed: {msg}',
    'gen.rtk.currentVersion': 'Current version',
    'gen.rtk.selectVersion': 'Switch version',
    'gen.rtk.repo': 'Repository',

    // ── QR bind modal ──
    'qr.wechatTitle': 'WeChat QR Binding', 'qr.feishuTitle': 'Feishu App Binding', 'qr.dingTitle': 'DingTalk App Binding',
    'qr.generating': 'Generating QR code...',
    'qr.wait': 'Scan the QR code with WeChat', 'qr.scanned': 'Scanned, confirm on your phone',
    'qr.confirmed': 'Bound! Refreshing...', 'qr.expired': 'QR code expired, please retry',
    'qr.regen': 'Regenerate',

    // ── Skills ──
    'skills.namePlaceholder': 'Skill name (kebab-case)',
    'skills.descPlaceholder': 'Description (optional)',
    'skills.empty': 'No skills',
    'skills.editTitle': 'Edit: {name}',
    'skills.market': 'Skills Market',
    'skills.marketPlaceholder': 'Search skills.sh marketplace...',
    'skills.searchPlaceholder': 'Filter or Enter to search market...',
    'skills.search': 'Search',
    'skills.install': 'Install',
    'skills.installing': 'Installing...',
    'skills.marketEmpty': 'No matching skills found',
    'skills.installedToast': 'Installed: {name}',

    // ── Agents ──
    'agents.count': '{n} agents · in ~/.claude/agents/',
    'agents.editTitle': 'Edit Agent: {name}',
    'agents.namePlaceholder': 'Agent name (kebab-case)',
    'agents.typePlaceholder': 'Type (select or custom, e.g. reviewer)',
    'agents.languagePlaceholder': 'Language (e.g. java, csharp)',
    'agents.descPlaceholder': 'When to use this agent',
    'agents.toolsPlaceholder': 'Allowed tools (comma-separated, empty = inherit all)',
    'agents.modelInherit': 'inherit (main model)',
    'agents.loaded': 'loaded',
    'agents.inheritAll': 'inherit all tools',
    'agents.empty': 'No custom agents',
    'agents.confirmDelete': 'Delete agent "{name}"? (.bak backup kept)',

    // ── Commands ──
    'cmd.count': '{n} commands',
    'cmd.live': 'live', 'cmd.cached': 'cached',
    'cmd.searchPlaceholder': 'Search commands...',
    'cmd.cacheHint': 'Tip: command list needs an active session. If "cached", open a session in workspace then refresh.',
    'cmd.empty': 'No commands',

    // ── Hooks ──
    'hooks.groupCount': '{n} event groups',
    'hooks.filenamePlaceholder': 'Filename (e.g. my-hook.sh)',
    'hooks.searchPlaceholder': 'Search hooks...',

    // ── Rules ──
    'rules.filenamePlaceholder': 'Filename (e.g. python.md)',
    'rules.pathsPlaceholder': 'paths (e.g. **/*.py)',
    'rules.noPaths': 'No path restriction',
    'rules.empty': 'No rules',
    'rules.searchPlaceholder': 'Search rules...',

    // ── Memory ──
    'mem.scanning': 'Scanning project memory...',
    'mem.emptyTitle': 'No project memory found',
    'mem.emptyHint1': 'Memory files live under each project\'s ~/.claude/projects/<name>/memory/',
    'mem.emptyHint2': 'They appear here automatically when you save memory with Claude',
    'mem.totalFiles': '{n} memory files',
    'mem.refresh': '↻ Refresh',
    'mem.fileCount': '{n} files',
    'mem.newPlaceholder': 'New memory filename...',
    'mem.loadingFiles': 'Loading...',
    'mem.noFiles': 'No memory files yet. Type a filename above to create one.',
    'mem.confirmDelete': 'Delete {name}?',

    // ── MCP ──
    'mcp.installed': 'Installed plugins · {n}',
    'mcp.installedBadge': 'installed',
    'mcp.enabled': 'enabled', 'mcp.disabled': 'disabled',
    'mcp.empty': 'No installed MCP plugins',
    'mcp.customTitle': 'Custom MCP Server',
    'mcp.customDesc': 'Configure in the mcpServers field of ~/.claude/settings.json',
    'mcp.tip': 'Restart Claude Code to take effect',
    'mcp.serversTitle': 'MCP Servers',
    'mcp.serversEmpty': 'No MCP servers configured. Click + to add one.',
    'mcp.newServer': 'New MCP Server',
    'mcp.editServer': 'Edit MCP Server',
    'mcp.serverName': 'Name',
    'mcp.namePlaceholder': 'my-mcp-server',
    'mcp.deleteConfirm': 'Confirm Deletion',
    'mcp.deleteHint': 'Are you sure you want to delete MCP server "{name}"?',

    // ── IM ──
    'im.wechat': 'WeChat', 'im.feishu': 'Feishu', 'im.dingtalk': 'DingTalk',
    'im.statusRunning': 'Connected', 'im.statusConfigured': 'Configured', 'im.statusInactive': 'Not configured',
    'im.apiAddr': 'API URL',
    'im.boundUsers': 'Bound users',
    'im.boundUsersN': '{n}',
    'im.bound': 'Bound', 'im.bindQr': 'Scan to bind', 'im.bindCred': 'Bind credentials',
    'im.unbind': 'Unbind', 'im.unbindConfirmHint': 'This will clear credentials and binding info. This action cannot be undone.', 'im.unbinding': 'Unbinding...', 'im.unbound': 'Unbound',
    'im.viewConfig': 'View config',
    'im.noPlatform': 'No IM platform configured',
    'im.noteTitle': 'Binding notes',
    'im.note1': 'IM connections are managed in ~/.claude/adapters.json. WeChat uses the iLink Bot API; Feishu/DingTalk need an app created on their open platform.',
    'im.note2': 'The WeChat adapter is built into the Gateway (wechat.mjs) and starts polling automatically once the Gateway runs.',

    // ── Workspace sidebar ──
    'ws.searchPlaceholder': 'Search projects...',
    'ws.projects': 'Projects',
    'ws.addProject': 'Add project (pick folder)',
    'ws.noMatch': 'No matching projects',
    'ws.notFound': 'No projects found',
    'ws.ensureGateway': 'Make sure the Gateway is running',
    'ws.newSession': 'New session',
    'ws.sessionsCount': '{n} sessions',
    'ws.activeConn': 'Active connection',
    'ws.showAllSessions': 'Show all sessions ({n})',
    'ws.collapse': 'Collapse',
    'ws.showAllProjects': 'Show all projects ({n})',
    'ws.settings': 'Settings',
    'ws.workflow': 'Workflow',
    'ws.refreshReorder': 'Refresh (reorder by recent activity)',

    // ── Welcome / header ──
    'ws.welcomeHint': 'Pick a project to start, or enter a custom directory',
    'ws.statusThinking': 'Thinking', 'ws.statusReady': 'Ready', 'ws.statusOffline': 'Offline',
    'ws.filePanelToggle': 'Project files / changes',
    'ws.mirrorOn': 'Sync: ON', 'ws.mirrorOff': 'Sync: OFF', 'ws.mirrorUnbound': 'Not bound. Configure in Settings first.',
    'ws.wechat': 'WeChat',

    // ── Bubble ──
    'ws.copy': 'Copy', 'ws.copied': 'Copied', 'ws.refill': 'Refill input',
    'ws.export': 'Export', 'ws.exportMD': 'Markdown', 'ws.exportJSON': 'JSON (full)', 'ws.exportJSONL': 'JSONL (CLI compat)',
    'ws.exportTime': 'Export time', 'ws.scrollBottom': 'Scroll to bottom',
    'ws.toolsOps': '{n} tool ops',
    'ws.thinkBadge': 'Thinking', 'ws.thinkContent': 'Thinking', 'ws.thinking': 'Thinking deeply...', 'ws.thinkDone': 'Thinking done',

    // ── Input ──
    'ws.inputThinking': 'Thinking... your message will be queued',
    'ws.inputPlaceholder': 'Type a message... (Enter send, Shift+Enter newline, / cmd, # file, @ agent)',
    'ws.stopRefill': 'Stop and restore text',
    'ws.queueSupplement': 'Supplement', 'ws.queuePending': 'Pending',
    'ws.injectNow': 'Interrupt and inject', 'ws.sendNow': 'Send now', 'ws.remove': 'Remove',

    // ── Confirm banner ──
    'ws.needAuth': 'Authorization needed: {tool}',
    'ws.deny': 'Deny', 'ws.allow': 'Allow', 'ws.choose': 'Please choose',

    // ── System / toast ──
    'ws.taskCanceled': 'Task canceled',
    'ws.allowed': 'Allowed {tool}', 'ws.denied': 'Denied {tool}',
    'ws.chose': 'Chose: {label}',
    'ws.injected': 'Supplement injected',
    'ws.notConnected': 'No active session',
    'ws.thinkingWait': 'Busy thinking, run /compact later',
    'ws.mirrorOnToast': 'On: replies will sync to bound platforms', 'ws.mirrorOffToast': 'Mirror off',
    'ws.gatewayDown': 'Gateway not running or crashed. Log: gateway.log next to exe',

    // ── File panel ──
    'ws.fpTitle': 'Project Files',
    'ws.fpRefresh': 'Refresh file list',
    'ws.close': 'Close',
    'ws.fpAll': 'All', 'ws.fpChanged': 'Changed',
    'ws.fpBaseline': 'Baseline {time}', 'ws.fpNoBaseline': 'No baseline',
    'ws.fpMissing': 'Working directory not found',
    'ws.fpNoChanged': 'No changed files', 'ws.fpNoFiles': 'No files',
    'ws.fpTruncated': 'Too many files, truncated',

    // ── Checkpoints ──
    'ws.cpTab': 'Checkpoints', 'ws.cpDesc': 'Checkpoints · auto-created each AI turn',
    'ws.commit': 'Commit', 'ws.committing': 'Committing',
    'ws.commitTitle': 'Set current state as new baseline and clear checkpoints',
    'ws.cpEmpty': 'No checkpoints',
    'ws.cpFiles': '{n} files', 'ws.cpNoInput': '(no input)',
    'ws.revert': 'Revert',
    'ws.revertTip': 'Revert to the state before this checkpoint', 'ws.revertDisabled': 'Contains binary/large files, cannot revert',
    'ws.notRevertible': 'not revertible',

    // ── Diff / file modal ──
    'ws.diffMode': 'DIFF', 'ws.fileMode': 'File',
    'ws.binaryNoPreview': 'Binary file, cannot preview', 'ws.binaryNoDiff': 'Binary file, cannot diff',
    'ws.fileSaved': 'File saved: {path}',
    'err.saveFail': 'Save failed: {msg}',
    'ws.tooLargeNoDiff': 'File too large for line diff', 'ws.noDiff': 'No differences',

    // ── Confirm dialogs ──
    'ws.commitConfirmTitle': 'Commit Changes',
    'ws.commitConfirmBody': 'Records the current file state as the new baseline; all checkpoints are cleared and prior changes are considered done (file panel "Changed" resets to zero). This does not modify disk files, but after clearing you cannot revert to earlier states.',
    'ws.confirmCommit': 'Confirm Commit',
    'ws.commitFilesTitle': 'Commit Files',
    'ws.commitFilesBody': '{n} changed files selected. Committing updates the baseline snapshot and clears all checkpoints. Unselected files keep their current change status.',
    'ws.commitFilesSelectAll': 'Select All',
    'ws.commitFilesDeselectAll': 'Deselect All',
    'ws.fpCommit': 'Commit',
    'ws.rewindTitle': 'Revert File Changes',
    'ws.rewindBody': 'Revert the working directory to the state before checkpoint "{prompt}": this checkpoint and all later turns will be restored (added files deleted, modified/deleted files written back). This writes to disk and cannot be undone.',
    'ws.confirmRewind': 'Confirm Revert', 'ws.rewinding': 'Reverting...',
    'ws.deleteSessionTitle': 'Delete Session',
    'ws.deleteSessionBody': 'Delete this session? Its conversation log is permanently removed. This cannot be undone.',
    'ws.closeTabTitle': 'Close Tab',
    'ws.closeTabBody': 'Closing this tab will disconnect the session. In-progress tasks will be interrupted. Uncommitted file changes are unaffected. Close anyway?',
    'ws.closeTabConfirm': 'Close',
    'ws.unsavedTitle': 'Unsaved Changes',
    'ws.unsavedBody': 'File "{path}" has unsaved changes. Save before closing?',
    'ws.unsavedSave': 'Save & Close',
    'ws.unsavedDiscard': 'Discard',

    // ── Context ring ──
    'ws.ctxRingTitle': 'Click to run /compact (compress context)',
    'ws.ctxHint': 'Context at {pct}%, consider compacting (/compact) or starting a new session',
    'ws.ttUsed': 'Used', 'ws.ttPct': 'Ratio', 'ws.ttInput': 'Input', 'ws.ttThink': 'Thinking',
    'ws.ttOutput': 'Output', 'ws.ttCostTurn': 'Turn cost', 'ws.ttCostTotal': 'Total cost', 'ws.ttRemaining': 'Balance',

    // ── Control bar ──
    'ws.ctlModel': 'Model', 'ws.ctlPerm': 'Permission', 'ws.ctlThink': 'Thinking',
    'ws.tokenMiniTip': 'Turn tokens · thinking is estimated, output excludes thinking estimate',

    // ── Permission modes ──
    'perm.default': 'Ask', 'perm.acceptEdits': 'Accept edits', 'perm.plan': 'Plan mode', 'perm.bypass': 'Auto all',

    // ── Thinking levels ──
    'think.auto': 'Auto', 'think.off': 'Off', 'think.low': 'Low', 'think.medium': 'Medium', 'think.high': 'High', 'think.xhigh': 'X-High', 'think.max': 'Max',

    // ── timeAgo ──
    'time.now': 'just now', 'time.min': '{n} min ago', 'time.hour': '{n} h ago', 'time.day': '{n} d ago',

    // ── Subagent ──
    'agent.spawning': 'Spawning sub-agent...',
    'agent.running': 'Sub-agent running: {name}',
    'agent.done': 'Sub-agent done: {name}',
    'agent.error': 'Sub-agent error: {name}',

    // ── System / error messages ──
    'sys.history': 'Loaded {n} history messages',
    'sys.connected': 'Connected · {id}...', 'sys.connectedResume': 'Connected · {id}... (context restored)',
    // ── Workflow (wf) ──
    'wf.title': 'Workflow',
    'wf.back': 'Back to Workspace',
    'wf.new': 'New Workflow',
    'wf.submit': 'Submit',
    'wf.submitting': 'Submitting...',
    'wf.wave': 'Wave {n}',
    'wf.waveTotal': 'Wave {n}/{total}',
    'wf.pending': 'Pending',
    'wf.running': 'Running',
    'wf.done': 'Done',
    'wf.error': 'Error',
    'wf.agentToolbox': 'Agents',
    'wf.addStep': 'Add Node',
    'wf.isolating': 'Creating isolated environment...',
    'wf.selectAgent': 'Select Agent Type',
    'wf.promptLabel': 'Task Prompt',
    'wf.promptPlaceholder': 'Describe what this step should do...',
    'wf.modelLabel': 'Model',
    'wf.maxTurnsLabel': 'Max Turns',
    'wf.allowedToolsLabel': 'Allowed Tools (comma-separated, empty=all)',
    'wf.canvasEmpty': 'Drag an Agent from the left, or click Add Node below',
    'wf.drawDependency': 'Connect nodes to create dependencies',
    'wf.started': 'Workflow started',

    'sys.model': 'Model: {model} · {cwd}',
    'sys.done': 'Done · {turns} turns · {ms}ms · ↓{in} ~{think} ↑{out}',
    'sys.reverted': 'Reverted to checkpoint "{prompt}" · {n} files restored',
    'sys.revertedSkip': ' · {n} not revertible skipped',
    'sys.committed': 'Committed · new baseline has {n} files, checkpoints cleared',
    'sys.committedSelective': 'Committed {n} files · {kept} checkpoints kept',
    'err.revertFail': 'Revert failed: {msg}', 'err.commitFail': 'Commit failed: {msg}',
    'err.clickSettings': ' Open Settings', 'err.connectFail': 'Connection failed: {msg}',
    'ws.projAdded': 'This project is already added',
    'ws.promptDir': 'Enter absolute project folder path (e.g. D:/projects/foo)',
    'ws.costToast': 'Session cost ¥{cost} reached {pct}% of balance',
    'ws.nudgeSwitched': 'Desktop switched to {label}',
    'ws.nudgeNewSession': 'New session created in {label}',
    'ws.nudgeStopped': 'Stop command sent',
    'ws.deleteFailed': 'Delete failed, please retry',
    'ws.hideProject': 'Hide project',
    'ws.showProject': 'Show project',
    'ws.hiddenProjects': 'Hidden projects',
    'ws.noHiddenProjects': 'No hidden projects',

    // ── Claude not found ──
    'claudeMissing.title': 'Claude Code Not Found',
    'claudeMissing.desc': 'Claude Code was not found in any of the following locations. Please install via one of these methods:',
    'claudeMissing.opt1': 'npm install -g @anthropic-ai/claude-code',
    'claudeMissing.opt2': 'Or download the native installer from anthropic.com',
    'claudeMissing.opt3': 'After installation, ensure the claude command is in PATH and restart this application',
    'claudeMissing.retry': 'Re-check',
    'claudeMissing.checking': 'Checking...',
    'claudeMissing.manual': 'Or manually specify the Claude Code path',
    'claudeMissing.manualWin': 'e.g. C:\\Users\\name\\AppData\\Local\\Claude-3p\\claude-code\\2.1.181\\claude.exe',
    'claudeMissing.manualMac': 'e.g. /Applications/Claude.app/Contents/MacOS/claude or /opt/homebrew/bin/claude',
    'claudeMissing.manualLinux': 'e.g. /usr/local/bin/claude or ~/.local/bin/claude',
    'claudeMissing.pathLabel': 'Claude Code executable path',
    'claudeMissing.pathPlaceholder': 'Enter full path to claude executable...',
    'claudeMissing.checkPath': 'Check this path',
    'claudeMissing.checkingPath': 'Checking...',
    'claudeMissing.foundOk': 'Found: {path}',
    'claudeMissing.notFound': 'Path not found or invalid',
    'claudeMissing.savePath': 'Save & Continue',
    'claudeMissing.saved': 'Saved',
  },
}
