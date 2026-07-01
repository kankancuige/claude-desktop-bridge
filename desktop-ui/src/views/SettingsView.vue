<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════════
// SettingsView.vue —— Claude Desktop Bridge 配置管理中心
// ═══════════════════════════════════════════════════════════════════
// 功能说明: 提供 9 个配置 Tab 页的统一管理界面，通过 Gateway REST API 读写配置
// 实现方式: Vue 3 Composition API（ref/computed/watch/onMounted），
//   所有数据通过 Gateway (http://127.0.0.1:3456) 的 REST API 读写，
//   每个 Tab 懒加载数据（首次点击才 fetch），主题和语言保存后才生效
// 涉及模块:
//   1. 常规 - AI 供应商选择、API Key 管理、模型列表、token/轮数等参数
//   2. Skills - AI 技能模块的 CRUD 与分类浏览
//   3. Agents - 子代理的 CRUD（含 .bak 安全备份）
//   4. 命令 - 斜杠命令只读列表，支持搜索过滤，显示 live/cached 状态
//   5. Hooks - 事件钩子按 event 分组查看与编辑
//   6. Rules - 编码规则按语言（C#/Java/Vue/C）分类管理
//   7. Memory - 跨项目 memory 文件扫描/展开/编辑/删除
//   8. MCP - 已安装 MCP 插件展示，附自定义 MCP 配置指引
//   9. IM 连接 - 微信 QR 绑定 / 飞书钉钉凭证配置 / 解绑确认
// ═══════════════════════════════════════════════════════════════════

import {ref, onMounted, onUnmounted, computed, watch} from 'vue'
import {useRouter} from 'vue-router'
import {t, setLocale} from '../i18n'
import WorkflowTab from './WorkflowTab.vue'

// ── Vue Router 实例 ──
// 功能说明: 用于「返回工作区」按钮导航回主页
const router = useRouter()

// ── Gateway 地址常量 ──
// 功能说明: 后端 API 网关基准 URL，所有配置读写都通过此地址的 REST 端点
const GW = 'http://127.0.0.1:3456'

// ── 当前激活的 Tab 页 ──
// 功能说明: 控制左侧导航高亮状态和右侧内容区显示哪个配置模块
// 实现方式: ref<string>，默认 'general'；switchTab() 负责切换并懒加载对应数据
const activeTab = ref('general')
type TabKey = 'general' | 'skills' | 'agents' | 'commands' | 'hooks' | 'rules' | 'memory' | 'mcp' | 'workflow' | 'im' | 'scheduler' | 'oss'

// ── Tab 导航定义列表 ──
// 功能说明: 左侧导航栏的入口项配置，每个包含 key（标识符）/ label（中文名）/ icon / desc（描述文字）
// 实现方式: 静态常量数组，模板用 v-for 遍历渲染为按钮，activeTab 与 key 比对控制高亮
function ri(d: string): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
}

const tabs: { key: TabKey; label: string; icon: string; desc: string }[] = [
  {
    key: 'general',
    label: '常规',
    icon: ri('<circle cx="12" cy="12" r="10"/><path d="M17.5 2.5V10h-7.5"/><path d="M12 2a10 10 0 1 0 9.97 10.57"/>'),
    desc: '模型、权限与连接配置'
  },
  {
    key: 'skills',
    label: 'Skills',
    icon: ri('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
    desc: 'AI 技能模块管理'
  },
  {
    key: 'agents',
    label: 'Agents',
    icon: ri('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    desc: '自定义子代理管理'
  },
  {
    key: 'commands',
    label: '命令',
    icon: ri('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
    desc: '可用斜杠命令列表'
  },
  {
    key: 'hooks',
    label: 'Hooks',
    icon: ri('<path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>'),
    desc: '事件钩子与自动化'
  },
  {
    key: 'rules',
    label: 'Rules',
    icon: ri('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'),
    desc: '编码规则与规范'
  },
  {
    key: 'memory',
    label: 'Memory',
    icon: ri('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
    desc: '项目记忆管理'
  },
  {
    key: 'mcp',
    label: 'MCP',
    icon: ri('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    desc: '协议服务器配置'
  },
  {
    key: 'workflow',
    label: 'Workflow',
    icon: ri('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    desc: '多 Agent 编排脚本'
  },
  {
    key: 'im',
    label: 'IM 连接',
    icon: ri('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
    desc: '微信/飞书/钉钉接入'
  },
  {
    key: 'scheduler',
    label: '定时任务',
    icon: ri('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'),
    desc: 'Cron 定时执行'
  },
  {
    key: 'oss',
    label: '开源集成',
    icon: ri('<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>'),
    desc: '开源项目版本管理与配置'
  },
]

// ── 常规设置数据 (General Tab) - AI 供应商 / API Key / 模型列表 / 会话参数 / 主题语言 ──
const DEFAULT_SETTINGS = {
  // 功能说明: 默认模型 ID，服务端无配置时使用 DeepSeek v4 Pro
  model: 'deepseek-v4-pro',
  // 功能说明: 主题默认跟随操作系统
  theme: 'system',
  // 功能说明: 界面语言默认中文
  language: 'chinese',
  // 功能说明: 最大上下文 token 数，默认 1M
  maxContextTokens: 1000000,
  // 功能说明: 权限模式，默认 default（不跳过任何确认）
  permissionMode: 'default',
  // 功能说明: thinking 深度，默认 auto 由模型自动决定
  thinkingLevel: 'auto',
  // 功能说明: 费用提醒阈值（占余额百分比），默认 50%
  costLimitPercent: 50,
  // 功能说明: 单次请求最大 agent 轮数，防止失控 tool 循环，默认 40
  maxTurns: 40,
  // 功能说明: 单条消息 # 引用文件注入内容上限 (KB)，默认 200
  fileInjectLimitKB: 200,
  // 功能说明: 环境变量子对象，含 Base URL 和 API Key
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: '',
  },
}

// ── settings 响应式状态 ──
// 功能说明: 完整合并后的配置对象（DEFAULT_SETTINGS + 服务端值），null 表示尚未加载
const settings = ref<any>(null)
// 功能说明: 加载中标记，控制 loading 指示器显示
const settingsLoading = ref(false)
// 功能说明: 保存成功标记，显示 ✓ 提示后 3 秒自动消失
const settingsSaved = ref(false)
// 功能说明: 保存失败时的错误消息文本
const settingsError = ref('')
// 功能说明: Token 输入框显示值，支持 "1M"/"200K" 友好格式，失焦时通过 parseTokens 同步到数字值
const tokenInput = ref('')

// ── AI 供应商 (Provider) 数据 ──
// 功能说明: providers 从 /api/config/providers 加载供应商预设列表（含 baseUrl/models/定价等）
// 实现方式: providerId 跟踪当前选中，切换时调用 selectProvider() 更新 BaseURL 和模型列表
// Provider presets
const providers = ref<any[]>([])
const providerId = ref('deepseek')
// 功能说明: true 显示明文输入框，false 显示 ●●●● 掩码或"未设置"
const showApiKey = ref(false)
// 功能说明: loadSettings 时从 settings.env.ANTHROPIC_BASE_URL 缓存，用于供应商推断
const manualBaseUrl = ref('')
// ── 连通性测试状态机 ──
// 功能说明: 调用 Gateway /api/config/test-model 端点测试 API 密钥 + Base URL 是否有效
// 实现方式: testState 四态 idle→testing→ok/fail；testMsg 显示成功模型数或失败原因
const testState = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')
const testMsg = ref('')

// ── 检测 OS 主题偏好 ──
// 功能说明: 通过 matchMedia 查询 prefers-color-scheme 媒体特性，返回 'dark' 或 'light'
function detectSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// ── 应用主题到页面 ──
// 功能说明: 将主题写入 <html data-theme="dark|light">，CSS 变量据此切换颜色方案
//   t==='system' 时调用 detectSystemTheme 获取实际值；dark/light 直接使用
function applyTheme(t: string) {
  document.documentElement.dataset.theme = t === 'system' ? detectSystemTheme() : t
}

// 主题/语言改为「保存配置」后才生效（不在选择时即时预览），故此处不再 watch settings.theme/language
let _stvThemeHandler: (() => void) | null = null
// 自动更新 IPC 监听器取消函数
let _cleanupUpdateAvailable: (() => void) | undefined
let _cleanupUpdateProgress: (() => void) | undefined
let _cleanupUpdateDownloaded: (() => void) | undefined
let _cleanupUpdateError: (() => void) | undefined
if (typeof window !== 'undefined') {
  _stvThemeHandler = () => {
    if (settings.value?.theme === 'system') document.documentElement.dataset.theme = detectSystemTheme()
  }
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', _stvThemeHandler)
}

// ── Token 值格式化: 1000000 → "1M", 200000 → "200K" ──
// 功能说明: 将纯数字 token 值格式化为友好显示，仅整百万/整千加 K/M 后缀，
//   非整倍数保留原始数字以避免精度损失
function formatTokens(n: number): string {
  if (!n || n <= 0) return ''
  if (n >= 1000000 && n % 1000000 === 0) return (n / 1000000) + 'M'
  if (n >= 1000 && n % 1000 === 0) return (n / 1000) + 'K'
  return String(n)
}

// ── Token 值解析: "1M"→1000000, "200K"→200000, "1000000"→1000000 ──
// 功能说明: 将用户输入的友好格式（支持 K/k/M/m 后缀）转回纯数字
// 实现方式: 正则 ^\\d+[mM]$ 匹配百万，^\\d+[kK]$ 匹配千，否则 parseInt 原值
function parseTokens(v: string): number {
  v = v.trim()
  if (/^\d+[mM]$/.test(v)) return parseInt(v) * 1000000
  if (/^\d+[kK]$/.test(v)) return parseInt(v) * 1000
  const n = parseInt(v)
  return isNaN(n) ? 0 : n
}

// ── Token 输入框失焦处理 ──
// 功能说明: 输入框失焦时将显示值解析为纯数字，同步到 settings.maxContextTokens
function onTokenBlur() {
  if (settings.value) settings.value.maxContextTokens = parseTokens(tokenInput.value) || 1000000
}

// ── 当前供应商 derived（计算属性）──
// 功能说明: 根据 providerId 从 providers 查找选中供应商对象，未匹配则 fallback 到 providers[0]
const currentProvider = computed(() => providers.value.find(p => p.id === providerId.value) || providers.value[0])
// ── 当前模型列表 derived（计算属性）──
// 功能说明: 从当前供应商取 models 数组（可能是预设列表，也可能被动态模型覆盖）
const currentModels = computed(() => currentProvider.value?.models || [])

// ── loadSettings: GET /api/config/settings → merge defaults → 推断供应商 → 应用主题 ──
async function loadSettings() {
  settingsLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/settings`)
    if (res.ok) {
      const raw = await res.json()
      if (raw && typeof raw === 'object') {
        // Merge with defaults so nothing is undefined
        settings.value = {
          ...DEFAULT_SETTINGS,
          ...raw,
          env: {...DEFAULT_SETTINGS.env, ...(raw.env || {})},
        }
        const url = settings.value.env?.ANTHROPIC_BASE_URL || ''
        // 供应商推断：按 baseUrl 特征匹配，与 WorkspaceView loadProviderModels 保持一致
        const urlL = url.toLowerCase()
        if (urlL.includes('deepseek')) providerId.value = 'deepseek'
        else if (urlL.includes('opencode')) providerId.value = 'opencode'
        else if (urlL.includes('anthropic')) providerId.value = 'anthropic'
        else if (urlL.includes('openai') || urlL.includes('codex')) providerId.value = 'codex'
        else if (urlL.includes('bigmodel')) providerId.value = 'zhipu'
        else if (urlL.includes('moonshot') || urlL.includes('kimi')) providerId.value = 'moonshot'
        else if (urlL.includes('aliyun')) providerId.value = 'qwen'
        else if (urlL.includes('openrouter')) providerId.value = 'openrouter'
        else if (urlL.includes('ollama')) providerId.value = 'ollama'
        else if (urlL.includes('volces') || urlL.includes('volcengine')) providerId.value = 'volcengine'
        else if (urlL.includes('googleapi')) providerId.value = 'gemini'
        else if (url) providerId.value = 'custom'  // 非预设 URL → 自定义
        manualBaseUrl.value = url
        tokenInput.value = formatTokens(settings.value.maxContextTokens)
      } else {
        // settings.json doesn't exist yet — use defaults
        settings.value = {...DEFAULT_SETTINGS, env: {...DEFAULT_SETTINGS.env}}
        tokenInput.value = formatTokens(DEFAULT_SETTINGS.maxContextTokens)
      }
    } else {
      // Gateway returned 404 — use defaults
      settings.value = {...DEFAULT_SETTINGS, env: {...DEFAULT_SETTINGS.env}}
      tokenInput.value = formatTokens(DEFAULT_SETTINGS.maxContextTokens)
    }
  } catch {
    settings.value = {...DEFAULT_SETTINGS, env: {...DEFAULT_SETTINGS.env}}
    tokenInput.value = formatTokens(DEFAULT_SETTINGS.maxContextTokens)
  }
  settingsLoading.value = false
  applyTheme(settings.value.theme)
  // 从 settings.json 恢复 pet 设置到 localStorage
  if (settings.value.petEnabled !== undefined) {
    petEnabled.value = settings.value.petEnabled
  }
  if (settings.value.pet) {
    petType.value = settings.value.pet
  }
  loadProviders()
  loadCavemanConfig()
  loadRtkConfig()
}

// ── 加载供应商列表 + 叠加动态模型 ──
// 功能说明: 从 Gateway /api/config/providers 获取预设供应商列表（DeepSeek/Anthropic/OpenAI），
//   然后调用 overlayDynamicModels 用 API 实时模型覆盖预设列表
async function loadProviders() {
  try {
    const res = await fetch(`${GW}/api/config/providers`)
    if (res.ok) {
      const data = await res.json()
      providers.value = data.providers || []
    }
  } catch {
    // Gateway 未就绪时保留默认 providers 列表，不阻塞 UI
  }
  // 叠加：用 supportedModels() 动态模型覆盖当前供应商的预设列表（拿不到则保留预设）
  await overlayDynamicModels()
}

// ── 动态模型来源标记 ──
// 功能说明: true 表示当前模型列表来自 API 实时查询（非预设/缓存），界面显示"动态"绿色徽章
const modelsLive = ref(false)

// 供应商连接测试：用当前 baseUrl + apiKey 调 gateway test-model 端点
// ── 供应商连通性测试 ──
// 功能说明: 用当前 BaseURL + API Key 调用 Gateway /api/config/test-model 端点，
//   测试 API 是否可连通并返回可用模型数量；四态流转 idle→testing→ok/fail
async function testConnection() {
  testState.value = 'testing';
  testMsg.value = ''
  const baseUrl = settings.value?.env?.ANTHROPIC_BASE_URL || ''
  const apiKey = settings.value?.env?.ANTHROPIC_AUTH_TOKEN || ''
  if (!baseUrl || !apiKey) {
    testState.value = 'fail';
    testMsg.value = '请先填写 Base URL 和 API Key';
    return
  }
  try {
    const r = await fetch(`${GW}/api/config/test-model`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({baseUrl, apiKey}),
    })
    const d = await r.json()
    if (d.ok) {
      testState.value = 'ok';
      testMsg.value = t('gen.testOk', {n: d.count});
      await overlayDynamicModels()
    } else {
      testState.value = 'fail';
      testMsg.value = d.error || t('gen.testFail')
    }
  } catch (e: any) {
    testState.value = 'fail';
    testMsg.value = e?.message || t('gen.testFail')
  }
}

// 叠加真实模型到当前供应商，保留预设 icon/定价等元信息。
// Anthropic 用 supportedModels()（/api/config/models）；DeepSeek/OpenAI 用其 /models 接口（/api/config/live-models）。
// ── 叠加动态模型列表 ──
// 功能说明: 从 API 端点拉取当前供应商的最新模型列表，覆盖 providers 中的预设 models。
//   Anthropic 用 /api/config/models；DeepSeek/OpenAI 用 /api/config/live-models。
//   传 currentProvider.baseUrl 和 apiKey 确保 gateway 查询的是当前供应商而非全局 env
async function overlayDynamicModels() {
  const pid = providerId.value
  const endpoint = pid === 'anthropic' ? '/api/config/models' : '/api/config/live-models'
  const isAnthropic = pid === 'anthropic'
  // 把当前供应商的 baseUrl 和 apiKey 传给 gateway，否则 gateway 只用全局 env 永远拉同一家的模型
  const p = providers.value.find(pp => pp.id === pid)
  // 优先用户表单的实际 baseUrl（与 testConnection 一致），预设兜底
  const baseUrl = settings.value?.env?.ANTHROPIC_BASE_URL || p?.baseUrl || ''
  if (!baseUrl) { modelsLive.value = false; return }  // 自定义无 URL → 不请求，等用户手动填写
  const ak = settings.value?.env?.ANTHROPIC_AUTH_TOKEN || settings.value?.env?.ANTHROPIC_API_KEY
  try {
    const fetchOpts: any = isAnthropic ? {} : {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({baseUrl, apiKey: ak || ''}),
    }
    const r = await fetch(`${GW}${endpoint}`, fetchOpts)
    if (!r.ok) {
      modelsLive.value = false;
      return
    }
    const data = await r.json()
    const models = data.models
    if (!Array.isArray(models) || !models.length) {
      modelsLive.value = false;
      return
    }
    modelsLive.value = pid === 'anthropic' ? !!data.live : true
    const dyn = models.map((m: any) => ({
      id: m.value,
      name: m.displayName || m.value,
      contextWindow: m.description || ''
    }))
    if (p) p.models = dyn
  } catch {
    modelsLive.value = false
  }
}

// ── 切换供应商 ──
// 功能说明: 更新 providerId，同步修改 settings.env.ANTHROPIC_BASE_URL 为供应商预设的 baseUrl，
//   默认模型切到第一个预设模型，重置连通性测试状态，触发动态模型叠加
function selectProvider(id: string) {
  providerId.value = id
  testState.value = 'idle';
  testMsg.value = ''
  const p = providers.value.find(pp => pp.id === id)
  if (p && settings.value) {
    settings.value.env.ANTHROPIC_BASE_URL = p.baseUrl  // 预设 baseUrl 写入，自定义为空则清空
    if (p.models && p.models.length > 0) settings.value.model = p.models[0].id
    else settings.value.model = ''
  }
  overlayDynamicModels()
}

// ── 保存设置 (PUT /api/config/settings) ──
// 功能说明: 将当前 settings 对象 PUT 回 Gateway 持久化；保存成功后应用主题/语言
//   实现方式: 保存前先调用 parseTokens 确保 token 值已归一化；
//   成功后 setLocale + applyTheme 使主题/语言生效；3 秒后隐藏成功提示
async function saveSettings() {
  settingsSaved.value = false
  settingsError.value = ''
  // Ensure token is parsed before save
  if (settings.value) settings.value.maxContextTokens = parseTokens(tokenInput.value) || 1000000
  try {
    const res = await fetch(`${GW}/api/config/settings`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(settings.value),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    settingsSaved.value = true
    // 保存后才应用主题与语言
    applyTheme(settings.value.theme)
    setLocale(settings.value.language)
    setTimeout(() => {
      settingsSaved.value = false
    }, 3000)
  } catch (e: any) {
    settingsError.value = e.message
  }
}

// ── 桌面宠物选择 ──
const petEnabled = ref(localStorage.getItem('claude-bridge-pet-enabled') !== 'false')
const petType = ref(localStorage.getItem('claude-bridge-pet') || '')
const petOptions = ref<{ id: string; label: string }[]>([])
const petOptionsLoaded = ref(false)  // 选项加载完才渲染 select，避免 v-model 被重置
function savePetEnabled() {
  localStorage.setItem('claude-bridge-pet-enabled', String(petEnabled.value))
  // 通过 __petApi 桥通知 WorkspaceView 立即生效
  const api = (window as any).__petApi
  if (api?.setPetEnabled) api.setPetEnabled(petEnabled.value)
  if (settings.value) {
    settings.value.petEnabled = petEnabled.value
    persistPetSettings()
  }
}
// 用 @change 显式保存，避免 watch 在选项异步加载时误触发
function savePetType() {
  localStorage.setItem('claude-bridge-pet', petType.value)
  // 通知 WorkspaceView 立即切换 + 持久化
  const api = (window as any).__petApi
  if (api?.setPet) api.setPet(petType.value)
  if (settings.value) {
    settings.value.pet = petType.value
    persistPetSettings()
  }
}
// 静默持久化到 Gateway，不触发 UI 提示
let _petPersistTimer: ReturnType<typeof setTimeout> | null = null
function persistPetSettings() {
  if (!settings.value) return
  if (_petPersistTimer) clearTimeout(_petPersistTimer)
  _petPersistTimer = setTimeout(async () => {
    try {
      await fetch(`${GW}/api/config/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings.value),
      })
    } catch (e) { console.error(e) }
  }, 300)
}

// ── 应用自身版本更新 ──
const appVersion = ref('')
const updateChecking = ref(false)
const updateAvailable = ref<any>(null)
const updateDownloading = ref(false)
const updateDownloaded = ref(false)
const updateProgress = ref(0)
const updateError = ref('')

async function checkAppUpdate() {
  updateChecking.value = true
  updateError.value = ''
  updateAvailable.value = null
  try {
    const api = (window as any).electronAPI
    if (!api?.checkForUpdates) {
      updateError.value = '当前环境不支持自动更新'
      updateChecking.value = false
      return
    }
    const result = await api.checkForUpdates()
    if (result?.ok && result.version) {
      updateAvailable.value = { version: result.version }
    } else if (result?.error) {
      updateError.value = result.error
    }
  } catch (e: any) {
    updateError.value = e.message || String(e)
  } finally {
    updateChecking.value = false
  }
}

function downloadAppUpdate() {
  updateDownloading.value = true
  updateError.value = ''
  const api = (window as any).electronAPI
  api?.downloadUpdate?.()
}

function installAppUpdate() {
  const api = (window as any).electronAPI
  api?.installUpdate?.()
}

// 挂载时获取版本号 + 检查更新；监听主进程推送的更新事件
function initAppUpdate() {
  const api = (window as any).electronAPI
  if (!api) return
  api.getAppVersion?.().then((v: string) => { if (v) appVersion.value = v }).catch(() => {})
  // 启动时静默检查一次
  checkAppUpdate()
  // 主进程推送
  // 保存返回的取消函数，供 onUnmounted 清理
  _cleanupUpdateAvailable = api.onUpdateAvailable?.((info: any) => { updateAvailable.value = info })
  _cleanupUpdateProgress = api.onUpdateDownloadProgress?.((p: any) => { updateProgress.value = Math.round(p.percent || 0) })
  _cleanupUpdateDownloaded = api.onUpdateDownloaded?.((info: any) => { updateDownloading.value = false; updateDownloaded.value = true; updateAvailable.value = info })
  _cleanupUpdateError = api.onUpdateError?.((e: any) => { updateDownloading.value = false; updateError.value = e.message || String(e) })
}
onMounted(() => { initAppUpdate() })

// ── Caveman 输出压缩配置 ──
const cavemanConfig = ref({enabled: true, level: 'full', cavemanCurrent: null as string|null, cavemanUpdate: null as any, releases: [] as any[]})
const cavemanUpdateVersion = ref('')
const cavemanUpdating = ref(false)
const cavemanUpdateOk = ref(false)
const cavemanUpdateError = ref('')

async function loadCavemanConfig() {
  try {
    const r = await fetch(`${GW}/api/config/caveman`)
    if (r.ok) {
      const data = await r.json()
      cavemanConfig.value = data
      if (!cavemanUpdateVersion.value) {
        cavemanUpdateVersion.value = data.cavemanUpdate?.latest || data.cavemanCurrent || ''
      }
    }
  } catch (e) { console.error(e) }
}

async function saveCavemanConfig() {
  try {
    await fetch(`${GW}/api/config/caveman`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enabled: cavemanConfig.value.enabled, level: cavemanConfig.value.level}),
    })
  } catch (e) { console.error(e) }
}

async function updateCaveman() {
  cavemanUpdating.value = true
  cavemanUpdateOk.value = false
  cavemanUpdateError.value = ''
  try {
    const r = await fetch(`${GW}/api/config/caveman/update`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({version: cavemanUpdateVersion.value}),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || r.statusText)
    await loadCavemanConfig()
    cavemanConfig.value.cavemanCurrent = cavemanUpdateVersion.value
    cavemanUpdateOk.value = true
    setTimeout(() => { cavemanUpdateOk.value = false }, 5000)
  } catch (e: any) {
    cavemanUpdateError.value = e.message
  }
  cavemanUpdating.value = false
}

// ── RTK Bash 压缩配置 ──
const rtkConfig = ref({enabled: true, rtkAvailable: false, rtkCurrent: null as string|null, rtkUpdate: null as any, releases: [] as any[]})
const rtkUpdateVersion = ref('')
const rtkUpdating = ref(false)
const rtkUpdateOk = ref(false)
const rtkUpdateError = ref('')

async function loadRtkConfig() {
  try {
    const r = await fetch(`${GW}/api/config/rtk`)
    if (r.ok) {
      const data = await r.json()
      rtkConfig.value = data
      // 默认选中 latest，若没有则选 current
      if (!rtkUpdateVersion.value) {
        rtkUpdateVersion.value = data.rtkUpdate?.latest || data.rtkCurrent || ''
      }
    }
  } catch (e) { console.error(e) }
}

async function saveRtkConfig() {
  try {
    await fetch(`${GW}/api/config/rtk`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enabled: rtkConfig.value.enabled}),
    })
  } catch (e) { console.error(e) }
}

async function updateRtk() {
  rtkUpdating.value = true
  rtkUpdateOk.value = false
  rtkUpdateError.value = ''
  try {
    const r = await fetch(`${GW}/api/config/rtk/update`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({version: rtkUpdateVersion.value}),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || r.statusText)
    // 刷新配置
    await loadRtkConfig()
    rtkConfig.value.rtkCurrent = rtkUpdateVersion.value
    rtkUpdateOk.value = true
    setTimeout(() => { rtkUpdateOk.value = false }, 5000)
  } catch (e: any) {
    rtkUpdateError.value = e.message
  }
  rtkUpdating.value = false
}

// ── Skills ──
// ═══════════════════════════════════════════════════════════════
// Skills CRUD 数据 - AI 技能模块管理
// 功能说明: 管理 ~/.claude/skills/ 下的 SKILL.md 文件，支持分类浏览与全屏编辑器
// ═══════════════════════════════════════════════════════════════
// ── Skills 列表，从 /api/config/skills 加载 ──
const skills = ref<any[]>([])
// ── Skills 加载中指示器 ──
const skillsLoading = ref(false)
// ── 当前正在全屏编辑的 skill 对象 ──
const editingSkill = ref<any>(null)
// ── 编辑器中的 SKILL.md 文本内容 ──
const editSkillContent = ref('')
// ── 保存进行中标记（按钮禁用）──
const skillSaving = ref(false)
// ── 保存成功 ✓ 标记（3 秒后消失）──
const skillSaved = ref(false)
// ── 是否显示新建 skill 表单 ──
const showNewSkill = ref(false)
// ── 新建 skill 表单数据: name (kebab-case) + description ──
const newSkillForm = ref({name: '', description: ''})
// ── Skills 来源筛选: ''=全部, 'builtin'=内置, 'custom'=自定义 ──
const activeSkillSource = ref('')
// ── Skills 来源计数 ──
const skillsSourceCounts = computed(() => {
  const builtin = skills.value.filter(s => s.source === 'builtin').length
  return {builtin, custom: skills.value.length - builtin}
})

// ── Skills 启用/禁用 ──
const disabledSkills = ref<string[]>([])
async function loadDisabledSkills() {
  try {
    const res = await fetch(`${GW}/api/config/disabled-skills`)
    if (res.ok) {
      const d = await res.json()
      disabledSkills.value = d.disabled || []
    }
  } catch (e) { console.error(e) }
}
async function toggleSkillEnabled(skill: any) {
  const name = skill.name
  const disabled = !disabledSkills.value.includes(name)
  try {
    const res = await fetch(`${GW}/api/config/disabled-skills`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, disabled}),
    })
    if (res.ok) {
      if (disabled) disabledSkills.value.push(name)
      else disabledSkills.value = disabledSkills.value.filter(n => n !== name)
    }
  } catch (e) { console.error(e) }
}

// ── Skills 搜索（同时用于本地过滤 + 市场搜索）──
const skillSearch = ref('')
const marketResults = ref<any[]>([])
const marketSearching = ref(false)
const marketInstalling = ref<string | null>(null)
function searchMarket() {
  const q = skillSearch.value.trim()
  if (!q) { marketResults.value = []; return }
  marketSearching.value = true
  fetch(`${GW}/api/config/skills-market?q=${encodeURIComponent(q)}`)
    .then(r => r.ok ? r.json() : Promise.reject(r))
    .then(d => { marketResults.value = d.results || [] })
    .catch(() => {})
    .finally(() => { marketSearching.value = false })
}
async function installFromMarket(item: any) {
  // GitHub 完整名如 owner/repo/name → 取最后一段做 name
  const rawName = item.name || item.id || ''
  const shortName = rawName.includes('/') ? rawName.split('/').pop()! : rawName
  const name = shortName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const url = item.url || item.downloadUrl || item.rawUrl || ''
  if (!name || !url) { showAlert('缺少 name 或 url'); return }
  marketInstalling.value = name
  try {
    const res = await fetch(`${GW}/api/config/skills-market/install`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, url}),
    })
    if (res.ok) {
      skillSearch.value = ''; marketResults.value = []
      await loadSkills()
      showAlert(t('skills.installedToast').replace('{name}', name))
    } else {
      const d = await res.json()
      showAlert('安装失败: ' + (d.error || ''))
    }
  } catch (e: any) { showAlert('安装失败: ' + (e.message || '')) }
  marketInstalling.value = null
}

// ── 待删除的 skill（二次确认）──
const pendingDeleteSkill = ref<string | null>(null)
let pendingDeleteSkillTimer: ReturnType<typeof setTimeout> | null = null

async function deleteSkill(name: string) {
  if (pendingDeleteSkill.value === name) {
    // 二次确认后执行删除
    try {
      const res = await fetch(`${GW}/api/config/skills/${name}`, { method: 'DELETE' })
      if (res.ok) {
        await loadSkills()
        pendingDeleteSkill.value = null
        showAlert('已删除: ' + name)
      } else {
        const d = await res.json()
        showAlert('删除失败: ' + (d.error || ''))
      }
    } catch (e: any) { showAlert('删除失败: ' + (e.message || '')) }
  } else {
    pendingDeleteSkill.value = name
    if (pendingDeleteSkillTimer) clearTimeout(pendingDeleteSkillTimer)
    pendingDeleteSkillTimer = setTimeout(() => { if (pendingDeleteSkill.value === name) pendingDeleteSkill.value = null }, 4000)
  }
}

// ── 按来源+搜索词过滤后的 skills 列表 ──
const filteredSkills = computed(() => {
  let list = skills.value
  if (activeSkillSource.value) list = list.filter(s => s.source === activeSkillSource.value)
  const q = skillSearch.value.trim().toLowerCase()
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
  return list
})

async function loadSkills() {
  skillsLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/skills`)
    if (res.ok) {
      const data = await res.json()
      skills.value = data.skills || []
    }
  } catch {
  }
  skillsLoading.value = false
}

// ── 进入 Skill 全屏编辑模式 ──
// 功能说明: 设置 editingSkill 为当前 skill，将 content 加载到编辑器中
function startEditSkill(skill: any) {
  editingSkill.value = skill
  editSkillContent.value = skill.content || ''
  skillSaved.value = false
}

// ── 保存 Skill 内容 ──
// 功能说明: PUT /api/config/skills/:name，将编辑器内容写回 SKILL.md 文件
async function saveSkill() {
  if (!editingSkill.value) return
  skillSaving.value = true
  skillSaved.value = false
  try {
    const res = await fetch(`${GW}/api/config/skills/${editingSkill.value.name}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editSkillContent.value}),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    editingSkill.value.content = editSkillContent.value
    skillSaved.value = true
    setTimeout(() => {
      skillSaved.value = false
    }, 3000)
  } catch {
  }
  skillSaving.value = false
}

// ── 退出 Skill 编辑模式，清空编辑状态 ──
function cancelEditSkill() {
  editingSkill.value = null;
  editSkillContent.value = ''
}

// ── 创建新 Skill ──
// 功能说明: POST /api/config/skills，传入 name(必填) 和 description(可选)，创建后重新加载列表
async function createSkill() {
  const name = newSkillForm.value.name.trim()
  if (!name) return
  skillSaving.value = true
  try {
    const res = await fetch(`${GW}/api/config/skills`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, description: newSkillForm.value.description}),
    })
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error)
    }
    newSkillForm.value = {name: '', description: ''}
    showNewSkill.value = false
    await loadSkills()
  } catch (e: any) {
    showAlert(t('common.createFailed') + (e.message || ''))
  }
  skillSaving.value = false
}

// ── Agents（自定义子代理，CRUD 镜像 Skills）──
// ═══════════════════════════════════════════════════════════════
// Agents CRUD 数据 - 自定义子代理管理
// 功能说明: 管理 ~/.claude/agents/ 下的代理配置文件，支持 name/description/tools/model
//   删除时 Gateway 自动保留 .bak 备份
// ═══════════════════════════════════════════════════════════════
// ── Agents 列表，从 /api/config/agents 加载 ──
const agents = ref<any[]>([])
// ── Agents 加载中指示器 ──
const agentsLoading = ref(false)
// ── 当前全屏编辑的 agent 对象 ──
const editingAgent = ref<any>(null)
// ── 编辑器中的 agent 配置文件文本内容 ──
const editAgentContent = ref('')
// ── 保存进行中标记 ──
const agentSaving = ref(false)
// ── 保存成功 ✓ 标记 ──
const agentSaved = ref(false)
// ── 是否显示新建 agent 表单 ──
const showNewAgent = ref(false)
const newAgentForm = ref({name: '', type: '', language: '', description: '', tools: '', model: 'inherit'})
const activeAgentSource = ref('')
const agentsSourceCounts = computed(() => ({
  builtin: agents.value.filter(function (a) {
    return a.source === 'builtin'
  }).length,
  custom: agents.value.filter(function (a) {
    return a.source !== 'builtin'
  }).length,
}))

async function loadAgents() {
  agentsLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/agents`)
    if (res.ok) {
      const data = await res.json();
      agents.value = data.agents || []
    }
  } catch {
  }
  agentsLoading.value = false
}

// ── 进入 Agent 全屏编辑模式 ──
function startEditAgent(agent: any) {
  editingAgent.value = agent
  editAgentContent.value = agent.content || ''
  agentSaved.value = false
}

async function saveAgent() {
  if (!editingAgent.value) return
  agentSaving.value = true
  agentSaved.value = false
  try {
    const res = await fetch(`${GW}/api/config/agents/${encodeURIComponent(editingAgent.value.name)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editAgentContent.value}),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    editingAgent.value.content = editAgentContent.value
    agentSaved.value = true
    setTimeout(() => {
      agentSaved.value = false
    }, 3000)
  } catch {
  }
  agentSaving.value = false
}

// ── 退出 Agent 编辑模式 ──
function cancelEditAgent() {
  editingAgent.value = null;
  editAgentContent.value = ''
}

async function createAgent() {
  const name = newAgentForm.value.name.trim()
  if (!name) return
  agentSaving.value = true
  try {
    const res = await fetch(`${GW}/api/config/agents`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(newAgentForm.value),
    })
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error)
    }
    newAgentForm.value = {name: '', type: '', language: '', description: '', tools: '', model: 'inherit'}
    showNewAgent.value = false
    await loadAgents()
  } catch (e: any) {
    showAlert(t('common.createFailed') + (e.message || ''))
  }
  agentSaving.value = false
}

// ── 删除 Agent ──
// 功能说明: 确认后 DELETE /api/config/agents/:name，Gateway 会自动保留 .bak 备份
async function deleteAgent(agent: any) {
  showConfirm(`确定删除 agent「${agent.name}」?（会保留 .bak 备份）`, async () => {
    appConfirm.value = null
    try {
      await fetch(`${GW}/api/config/agents/${encodeURIComponent(agent.name)}`, {method: 'DELETE'})
      await loadAgents()
    } catch {
    }
  })
}

// ── 斜杠命令（只读列表，来自 supportedCommands()）──
// ═══════════════════════════════════════════════════════════════
// 斜杠命令展示 (只读) - 搜索过滤 + live/cached 状态
// 功能说明: 展示所有可用斜杠命令，支持按名称/描述搜索，显示实时/缓存来源标记
// ═══════════════════════════════════════════════════════════════
// ── 命令列表，从 /api/config/commands 加载 ──
const commands = ref<any[]>([])
// ── 加载中指示器 ──
const commandsLoading = ref(false)
// ── 是否来自 live 查询（true=运行时实时, false=缓存/预设）──
const commandsLive = ref(false)
// ── 搜索关键词（实时过滤）──
const commandSearch = ref('')
// ── Commands 来源筛选 ──
const activeCommandSource = ref('')
const commandsSourceCounts = computed(() => {
  const builtin = commands.value.filter(c => c.source === 'builtin').length
  return {builtin, custom: commands.value.length - builtin}
})

// ── 加载命令列表 ──
// 功能说明: GET /api/config/commands，返回 { commands: [{name, description, argumentHint}], live: bool }
async function loadCommands() {
  commandsLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/commands`)
    if (res.ok) {
      const data = await res.json();
      commands.value = data.commands || [];
      commandsLive.value = !!data.live
    }
  } catch {
  }
  commandsLoading.value = false
}

// ── 按搜索词过滤后的命令列表 ──
// 功能说明: 搜索空时显示全部；否则按命令名和描述做不区分大小写的子串匹配
// 实现方式: computed 属性，依赖 commandSearch 和 commands，自动响应式更新
const filteredCommands = computed(() => {
  let list = commands.value
  if (activeCommandSource.value) list = list.filter(c => c.source === activeCommandSource.value)
  const q = commandSearch.value.trim().toLowerCase()
  if (q) list = list.filter(c => (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
  return list
})

// ── Hooks ──
// ═══════════════════════════════════════════════════════════════
// Hooks CRUD - 事件钩子管理
// 功能说明: 管理 ~/.claude/hooks/ 下的钩子脚本，
//   按 event 类型（如 PostToolUse/Stop/PreToolUse）分组展示，
//   每组内含多个 entry（matcher+timeout），每个 entry 含多个 hook 文件
// ═══════════════════════════════════════════════════════════════
// ── Hooks 数据: Record<eventType, entry[]>，null 表示未加载 ──
const hooks = ref<any>(null)
const hooksLoading = ref(false)
// ── 当前全屏编辑的 hook 对象 ──
const editingHook = ref<any>(null)
const editHookContent = ref('')
const hookSaving = ref(false)
const hookSaved = ref(false)
// ── 是否显示新建 hook 表单 ──
const showNewHook = ref(false)
// ── 新建 hook 表单: filename + eventType（默认 PostToolUse）──
const newHookForm = ref({filename: '', eventType: 'PostToolUse'})

async function loadHooks() {
  hooksLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/hooks`)
    if (res.ok) hooks.value = await res.json()
  } catch {
  }
  hooksLoading.value = false
}

// ── Hook 搜索关键词 ──
const hookSearch = ref('')
// ── 按搜索词过滤后的 hooks（匹配 filename 或 eventType 或 matcher）──
const filteredHooks = computed(() => {
  const q = hookSearch.value.trim().toLowerCase()
  if (!q) return hooks.value
  const result: Record<string, any[]> = {}
  for (const [et, entries] of Object.entries<any[]>(hooks.value || {})) {
    const matchedEntry = entries.filter(e => {
      if (et.toLowerCase().includes(q)) return true
      if ((e.matcher || '*').toLowerCase().includes(q)) return true
      return (e.hooks || []).some((h: any) =>
        (h.filename || '').toLowerCase().includes(q) ||
        (h.command || '').toLowerCase().includes(q)
      )
    })
    if (matchedEntry.length) result[et] = matchedEntry
  }
  return result
})

// ── 进入 Hook 全屏编辑模式 ──
function startEditHook(hook: any) {
  editingHook.value = hook
  editHookContent.value = hook.content || ''
  hookSaved.value = false
}

async function saveHook() {
  if (!editingHook.value) return
  hookSaving.value = true
  hookSaved.value = false
  try {
    const res = await fetch(`${GW}/api/config/hooks/${editingHook.value.filename}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editHookContent.value}),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    editingHook.value.content = editHookContent.value
    hookSaved.value = true
    setTimeout(() => {
      hookSaved.value = false
    }, 3000)
  } catch {
  }
  hookSaving.value = false
}

// ── 退出 Hook 编辑模式 ──
function cancelEditHook() {
  editingHook.value = null;
  editHookContent.value = ''
}

async function createHook() {
  const fn = newHookForm.value.filename.trim()
  if (!fn) return
  hookSaving.value = true
  try {
    const res = await fetch(`${GW}/api/config/hooks`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: fn}),
    })
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error)
    }
    newHookForm.value = {filename: '', eventType: 'PostToolUse'}
    showNewHook.value = false
    await loadHooks()
  } catch (e: any) {
    showAlert(t('common.createFailed') + (e.message || ''))
  }
  hookSaving.value = false
}

// ═══════════════════════════════════════════════════════════════
// Rules CRUD - 编码规则文件管理
// 功能说明: 管理 ~/.claude/rules/ 下的规则文件（.md 格式），
//   根据 frontmatter 的 paths 字段（如 ".cs" ".java" ".vue"）自动分类到语言组
// ═══════════════════════════════════════════════════════════════
// ── Rules 列表，从 /api/config/rules 加载 ──
const rules = ref<any[]>([])
const rulesLoading = ref(false)
// ── 当前全屏编辑的 rule ──
const editingRule = ref<any>(null)
const editRuleContent = ref('')
const ruleSaving = ref(false)
const ruleSaved = ref(false)
// ── 新建 rule 表单：filename + paths（如 ".cs,.java"）──
const showNewRule = ref(false)
const newRuleForm = ref({filename: '', paths: ''})
// ── 当前选中的语言分类筛选项 ──
const activeRuleCategory = ref('')
// ── Rules 来源筛选 ──
const activeRuleSource = ref('')
const pendingDeleteRule = ref<string | null>(null)
let pendingDeleteRuleTimer: ReturnType<typeof setTimeout> | null = null
const ruleSearch = ref('')
const rulesSourceCounts = computed(() => {
  const builtin = rules.value.filter(r => r.source === 'builtin').length
  return {builtin, custom: rules.value.length - builtin}
})

// ── 规则语言分类定义 ──
// 功能说明: 4 种语言 + Other，根据 frontmatter.paths 字段匹配文件扩展名
// 实现方式: label 为中文分类名，patterns 为文件扩展名数组（含点）
const ruleCategories: Record<string, { label: string; patterns: string[] }> = {
  'C#': {label: 'C#', patterns: ['.cs']},
  'Java': {label: 'Java', patterns: ['.java']},
  'TypeScript': {label: 'TypeScript', patterns: ['.ts', '.tsx']},
  'Vue': {label: 'Vue', patterns: ['.vue', '.nvue']},
  'C': {label: 'C', patterns: ['.c', '.h']},
}
// ── 根据 rule.frontmatter.paths 推断语言分类 ──
// 功能说明: 遍历 ruleCategories 的 patterns，检查 paths 字符串是否包含对应扩展名
function ruleCategory(rule: any) {
  const paths = rule.frontmatter?.paths || ''
  for (const [key, cat] of Object.entries(ruleCategories)) {
    if (cat.patterns.some(p => paths.includes(p))) return key
  }
  return 'Other'
}

// ── 按语言分类过滤后的 rules 列表 ──
const filteredRules = computed(() => {
  let list = rules.value
  if (activeRuleSource.value) list = list.filter(r => r.source === activeRuleSource.value)
  if (activeRuleCategory.value) list = list.filter(r => ruleCategory(r) === activeRuleCategory.value)
  const q = ruleSearch.value.trim().toLowerCase()
  if (q) list = list.filter(r => (r.filename || '').toLowerCase().includes(q) || (r.frontmatter?.paths || '').toLowerCase().includes(q))
  return list
})

async function loadRules() {
  rulesLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/rules`)
    if (res.ok) {
      const data = await res.json()
      rules.value = data.rules || []
    }
  } catch {
  }
  rulesLoading.value = false
}

function startEditRule(rule: any) {
  editingRule.value = rule
  editRuleContent.value = rule.content || ''
  ruleSaved.value = false
}

async function saveRule() {
  if (!editingRule.value) return
  ruleSaving.value = true
  ruleSaved.value = false
  try {
    const res = await fetch(`${GW}/api/config/rules/${editingRule.value.filename}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editRuleContent.value}),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    editingRule.value.content = editRuleContent.value
    ruleSaved.value = true
    setTimeout(() => {
      ruleSaved.value = false
    }, 3000)
  } catch {
  }
  ruleSaving.value = false
}

function cancelEditRule() {
  editingRule.value = null;
  editRuleContent.value = ''
}

async function createRule() {
  const fn = newRuleForm.value.filename.trim()
  if (!fn) return
  ruleSaving.value = true
  try {
    const res = await fetch(`${GW}/api/config/rules`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: fn, paths: newRuleForm.value.paths || undefined}),
    })
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error)
    }
    newRuleForm.value = {filename: '', paths: ''}
    showNewRule.value = false
    await loadRules()
  } catch (e: any) {
    showAlert(t('common.createFailed') + (e.message || ''))
  }
  ruleSaving.value = false
}

async function deleteRule(filename: string) {
  if (pendingDeleteRule.value === filename) {
    try {
      const res = await fetch(`${GW}/api/config/rules/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      if (res.ok) {
        await loadRules()
        pendingDeleteRule.value = null
        showAlert('已删除: ' + filename)
      } else {
        const d = await res.json()
        showAlert('删除失败: ' + (d.error || ''))
      }
    } catch (e: any) { showAlert('删除失败: ' + (e.message || '')) }
  } else {
    pendingDeleteRule.value = filename
    if (pendingDeleteRuleTimer) clearTimeout(pendingDeleteRuleTimer)
    pendingDeleteRuleTimer = setTimeout(() => { if (pendingDeleteRule.value === filename) pendingDeleteRule.value = null }, 4000)
  }
}

// ── Memory (all projects summary view) ──
// ═══════════════════════════════════════════════════════════════
// Memory 管理 - 跨项目 memory 文件管理
// 功能说明: 扫描各项目的 memory 文件（~/.claude/projects/*/memory/），
//   按项目分组，点击展开加载项目下所有 memory 文件，支持编辑/新建/删除
// ═══════════════════════════════════════════════════════════════
// ── 项目列表摘要，含 encodedDir/workDir/fileCount ──
const memoryProjects = ref<any[]>([])
const memoryLoading = ref(false)
// ── 当前展开的项目 encodedDir（'' 表示无展开）──
const expandedMemoryProj = ref('')
// ── 当前编辑的 memory 文件对象 ──
const editingMemory = ref<any>(null)
const editMemoryContent = ref('')
const memorySaving = ref(false)
const memorySaved = ref(false)
// ── 新建 memory 文件名输入（自动补 .md 后缀）──
const newMemoryName = ref('')

// ── 加载 Memory 项目摘要 ──
// 功能说明: GET /api/config/memory-summary，返回 { projects: [{encodedDir, workDir, fileCount}] }
async function loadMemorySummary() {
  memoryLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/memory-summary`)
    if (res.ok) {
      const data = await res.json()
      memoryProjects.value = data.projects || []
    }
  } catch {
  }
  memoryLoading.value = false
}

// ── 加载特定项目的 memory 文件列表 ──
// 功能说明: GET /api/projects/:encodedDir/memory，返回 { files: [{filename, content, size}] }
async function loadMemoryForProject(encodedDir: string) {
  // Load full content for files in a specific project
  const proj = memoryProjects.value.find(p => p.encodedDir === encodedDir)
  if (!proj) return
  proj._loading = true
  try {
    const res = await fetch(`${GW}/api/projects/${encodedDir}/memory`)
    if (res.ok) {
      const data = await res.json()
      proj.files = data.files || []
    }
  } catch {
  }
  proj._loading = false
}

// ── 展开/收起 Memory 项目 ──
// 功能说明: 点击切换展开状态，展开时自动调用 loadMemoryForProject 加载文件列表
function toggleMemoryProject(encodedDir: string) {
  if (expandedMemoryProj.value === encodedDir) {
    expandedMemoryProj.value = ''
  } else {
    expandedMemoryProj.value = encodedDir
    loadMemoryForProject(encodedDir)
  }
}

function startEditMemory(file: any, encodedDir: string) {
  editingMemory.value = {...file, encodedDir}
  editMemoryContent.value = file.content || ''
  memorySaved.value = false
}

async function saveMemory() {
  if (!editingMemory.value) return
  const {encodedDir, filename} = editingMemory.value
  memorySaving.value = true
  memorySaved.value = false
  try {
    const res = await fetch(`${GW}/api/projects/${encodedDir}/memory/${filename}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editMemoryContent.value}),
    })
    if (!res.ok) throw new Error(t('common.saveFailed'))
    editingMemory.value.content = editMemoryContent.value
    memorySaved.value = true
    setTimeout(() => {
      memorySaved.value = false
    }, 3000)
    await loadMemoryForProject(encodedDir)
  } catch {
  }
  memorySaving.value = false
}

async function createMemory(encodedDir: string) {
  const name = newMemoryName.value.trim()
  if (!name) return
  const filename = name.endsWith('.md') ? name : name + '.md'
  memorySaving.value = true
  try {
    await fetch(`${GW}/api/projects/${encodedDir}/memory/${filename}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: '# ' + name + '\n'}),
    })
    newMemoryName.value = ''
    await loadMemoryForProject(encodedDir)
  } catch {
  }
  memorySaving.value = false
}

async function deleteMemory(filename: string, encodedDir: string) {
  showConfirm(`确定删除 ${filename} ?`, async () => {
    appConfirm.value = null
    try {
      await fetch(`${GW}/api/projects/${encodedDir}/memory/${filename}`, {method: 'DELETE'})
      await loadMemoryForProject(encodedDir)
    } catch {
    }
  })
}

function cancelEditMemory() {
  editingMemory.value = null;
  editMemoryContent.value = ''
}

// ── MCP ──
// ═══════════════════════════════════════════════════════════════
// MCP 管理 - 已安装 MCP 插件展示 + MCP 服务器 CRUD
// 功能说明: 显示 Gateway 管理的 MCP 插件列表（name/version/scope/enabled），
//   并提供 MCP 服务器（settings.json mcpServers）的增删改查 UI
// ═══════════════════════════════════════════════════════════════
// ── MCP 插件列表，从 /api/config/mcp 加载 ──
const mcpPlugins = ref<any[]>([])
const mcpLoading = ref(false)
// ── MCP 来源筛选 ──
const activeMcpSource = ref('')
const mcpSourceCounts = computed(() => {
  const builtin = mcpPlugins.value.filter(p => p.source === 'builtin').length
  return {builtin, custom: mcpPlugins.value.length - builtin + mcpServers.value.length}
})

// ── 统一 MCP 列表（插件 + 服务器合并）──
const mcpAll = computed(() => {
  const items: any[] = []
  for (const p of mcpPlugins.value) {
    items.push({_kind: p.source === 'builtin' ? 'builtin' : 'plugin', name: p.name, source: p.source, enabled: !disabledMcpPlugins.value.includes(p.name), version: p.version, scope: p.scope})
  }
  for (const s of mcpServers.value) {
    items.push({_kind: 'server', name: s.name, source: 'custom', enabled: s.enabled !== false, transport: s.transport, command: s.command, url: s.url, args: s.args, env: s.env, headers: s.headers})
  }
  return items
})

// ── 按来源 + 搜索词过滤后的统一 MCP 列表 ──
const filteredMcpItems = computed(() => {
  let list = mcpAll.value
  if (activeMcpSource.value) list = list.filter(item => item.source === activeMcpSource.value)
  const q = mcpSearch.value.trim().toLowerCase()
  if (q) list = list.filter(item => {
    if (item._kind === 'server') return (item.name || '').toLowerCase().includes(q) || (item.transport || '').toLowerCase().includes(q) || (item.command || '').toLowerCase().includes(q) || (item.url || '').toLowerCase().includes(q)
    return (item.name || '').toLowerCase().includes(q) || (item.scope || '').toLowerCase().includes(q) || (item.version || '').toLowerCase().includes(q)
  })
  return list
})

// ── MCP 服务器管理状态 ──
const mcpServers = ref<any[]>([])
const mcpServersLoading = ref(false)
// ── 新增/编辑 MCP 服务器弹窗 ──
const showMcpForm = ref(false)
const editingMcpServer = ref<any>(null) // null=新建, 有值=编辑
const mcpForm = ref({name: '', transport: 'stdio', command: '', args: '', envText: '', url: '', headersText: ''})
const mcpFormSaving = ref(false)
const mcpFormError = ref('')
// ── 已禁用的 MCP 插件名称列表 ──
const disabledMcpPlugins = ref<string[]>([])
// ── MCP 搜索关键词 ──
const mcpSearch = ref('')
// ── 待删除的 MCP 服务器（二次确认）──
const pendingDeleteMcp = ref<string | null>(null)

// ── 加载 MCP 插件 ──
// 功能说明: GET /api/config/mcp，返回 { plugins: [{name, version, scope, enabled}] }
async function loadMcp() {
  mcpLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/mcp`)
    if (res.ok) {
      const data = await res.json()
      mcpPlugins.value = data.plugins || []
    }
  } catch {
  }
  mcpLoading.value = false
}

// ── 加载已禁用的 MCP 插件列表 ──
async function loadDisabledMcpPlugins() {
  try {
    const res = await fetch(`${GW}/api/config/disabled-mcp-plugins`)
    if (res.ok) {
      const d = await res.json()
      disabledMcpPlugins.value = d.disabled || []
    }
  } catch (e) { console.error(e) }
}

// ── 切换 MCP 插件启用/禁用 ──
async function toggleMcpPlugin(plugin: any) {
  const name = plugin.name
  const disabled = !disabledMcpPlugins.value.includes(name)
  try {
    const res = await fetch(`${GW}/api/config/disabled-mcp-plugins`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, disabled}),
    })
    if (res.ok) {
      if (disabled) disabledMcpPlugins.value.push(name)
      else disabledMcpPlugins.value = disabledMcpPlugins.value.filter(n => n !== name)
    }
  } catch (e) { console.error(e) }
}

// ── 切换 MCP 服务器启用/禁用 ──
async function toggleMcpServer(srv: any) {
  const enabled = !srv.enabled
  try {
    const res = await fetch(`${GW}/api/config/mcp-servers`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: srv.name, transport: srv.transport, command: srv.command || undefined, args: srv.args || [], env: srv.env || {}, url: srv.url || undefined, headers: srv.headers || {}, enabled}),
    })
    const d = await res.json()
    if (res.ok && d.ok) {
      srv.enabled = enabled
    }
  } catch (e) { console.error(e) }
}

// ── 加载 MCP 服务器列表 ──
// 功能说明: GET /api/config/mcp-servers，返回 { servers: [{name, transport, command, args, env, url, headers}] }
async function loadMcpServers() {
  mcpServersLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/mcp-servers`)
    if (res.ok) {
      const data = await res.json()
      mcpServers.value = data.servers || []
    }
  } catch (e) { console.error(e) }
  mcpServersLoading.value = false
}

// ── 统一刷新 MCP（插件 + 服务器）──
async function refreshMcp() {
  await Promise.all([loadMcp(), loadDisabledMcpPlugins(), loadMcpServers()])
}

// ── 打开 MCP 服务器新建表单 ──
function openNewMcpServer() {
  editingMcpServer.value = null
  mcpForm.value = {name: '', transport: 'stdio', command: '', args: '', envText: '', url: '', headersText: ''}
  mcpFormError.value = ''
  showMcpForm.value = true
}

// ── 打开 MCP 服务器编辑表单 ──
function editMcpServer(s: any) {
  editingMcpServer.value = s
  mcpForm.value = {
    name: s.name,
    transport: s.transport || 'stdio',
    command: s.command || '',
    args: (s.args || []).join('\n'),
    envText: s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    url: s.url || '',
    headersText: s.headers ? JSON.stringify(s.headers, null, 2) : '',
  }
  mcpFormError.value = ''
  showMcpForm.value = true
}

// ── 保存 MCP 服务器 ──
async function saveMcpServer() {
  const f = mcpForm.value
  if (!f.name.trim()) { mcpFormError.value = '名称必填'; return }
  if (f.transport === 'stdio' && !f.command.trim()) { mcpFormError.value = 'stdio 类型需填写 command'; return }
  if ((f.transport === 'sse' || f.transport === 'http') && !f.url.trim()) { mcpFormError.value = 'sse/http 类型需填写 URL'; return }
  mcpFormSaving.value = true
  mcpFormError.value = ''
  const body: any = {name: f.name.trim(), transport: f.transport}
  if (f.transport === 'stdio') {
    body.command = f.command.trim()
    if (f.args.trim()) body.args = f.args.trim().split('\n').map(a => a.trim()).filter(Boolean)
    if (f.envText.trim()) {
      const env: Record<string, string> = {}
      for (const line of f.envText.trim().split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
      }
      if (Object.keys(env).length) body.env = env
    }
  } else {
    body.url = f.url.trim()
    if (f.headersText.trim()) {
      try { body.headers = JSON.parse(f.headersText.trim()) }
      catch { mcpFormError.value = 'Headers JSON 格式错误'; mcpFormSaving.value = false; return }
    }
  }
  try {
    const res = await fetch(`${GW}/api/config/mcp-servers`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    })
    const d = await res.json()
    if (res.ok && d.ok) {
      showMcpForm.value = false
      await loadMcpServers()
    } else {
      mcpFormError.value = d.error || '保存失败'
    }
  } catch (e: any) {
    mcpFormError.value = e.message || '保存失败'
  }
  mcpFormSaving.value = false
}

// ── 删除 MCP 服务器（二次确认后执行）──
async function confirmDeleteMcp() {
  const name = pendingDeleteMcp.value
  if (!name) return
  pendingDeleteMcp.value = null
  try {
    const res = await fetch(`${GW}/api/config/mcp-servers/${encodeURIComponent(name)}`, {method: 'DELETE'})
    const d = await res.json()
    if (res.ok && d.ok) await loadMcpServers()
    else showAlert('删除失败: ' + (d.error || ''))
  } catch (e: any) { showAlert('删除失败: ' + (e.message || '')) }
}

// ── 定时任务 Scheduler ──
const scheduledTasks = ref<any[]>([])
const schedLoading = ref(false)
const showSchedForm = ref(false)
const editingSchedId = ref<string | null>(null)
const schedForm = ref({cron: '', prompt: '', workDir: '', model: '', enabled: true})
const schedSaving = ref(false)
const schedSearch = ref('')
const filteredScheduledTasks = computed(() => {
  const q = schedSearch.value.trim().toLowerCase()
  if (!q) return scheduledTasks.value
  return scheduledTasks.value.filter(t =>
    (t.prompt || '').toLowerCase().includes(q) ||
    (t.cron || '').toLowerCase().includes(q) ||
    (t.workDir || '').toLowerCase().includes(q)
  )
})

// 可视化 Cron 表单状态
const schedFreq = ref<'daily'|'weekday'|'weekly'|'monthly'|'custom'>('daily')
const schedTime = ref('09:00')
const schedWeekdays = ref<number[]>([1,2,3,4,5])
const schedMonthDay = ref(1)

const weekdayLabels = ['日','一','二','三','四','五','六']

// 从可视化表单生成 cron 表达式
function freqToCron(): string {
  const [h, m] = schedTime.value.split(':').map(Number)
  switch (schedFreq.value) {
    case 'daily':   return `${m} ${h} * * *`
    case 'weekday': return `${m} ${h} * * 1-5`
    case 'weekly':  return `${m} ${h} * * ${schedWeekdays.value.sort((a,b)=>a-b).join(',')}`
    case 'monthly': return `${m} ${h} ${schedMonthDay.value} * *`
    default:        return schedForm.value.cron
  }
}

// 从 cron 表达式反向解析到可视化表单
function parseCronToForm(cron: string) {
  schedForm.value.cron = cron
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) { schedFreq.value = 'custom'; return }
  const [m, h, dom, , dow] = parts
  schedTime.value = `${h.padStart(2,'0')}:${m.padStart(2,'0')}`
  if (dom === '*' && dow === '*') { schedFreq.value = 'daily'; return }
  if (dom === '*' && dow === '1-5') { schedFreq.value = 'weekday'; return }
  if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
    schedFreq.value = 'weekly'
    schedWeekdays.value = dow.split(',').map(Number)
    return
  }
  if (/^\d{1,2}$/.test(dom) && dow === '*') {
    schedFreq.value = 'monthly'
    schedMonthDay.value = parseInt(dom)
    return
  }
  schedFreq.value = 'custom'
}

function resetSchedVisualForm() {
  schedFreq.value = 'daily'
  schedTime.value = '09:00'
  schedWeekdays.value = [1,2,3,4,5]
  schedMonthDay.value = 1
}

async function loadScheduledTasks() {
  schedLoading.value = true
  try {
    const r = await fetch(`${GW}/api/config/scheduled-tasks`)
    if (r.ok) { const d = await r.json(); scheduledTasks.value = d.tasks || [] }
  } catch (e) { console.error(e) }
  schedLoading.value = false
}
function openNewSched() {
  editingSchedId.value = null
  resetSchedVisualForm()
  schedForm.value = {cron: '0 9 * * *', prompt: '', workDir: '', model: '', enabled: true}
  showSchedForm.value = true
}
function editSched(t: any) {
  editingSchedId.value = t.id
  parseCronToForm(t.cron)
  schedForm.value = {cron: t.cron, prompt: t.prompt, workDir: t.workDir, model: t.model || '', enabled: t.enabled}
  showSchedForm.value = true
}
async function saveSched() {
  const f = schedForm.value
  f.cron = freqToCron()
  if (!f.cron || !f.prompt || !f.workDir) { showAlert('cron/prompt/workDir 必填'); return }
  schedSaving.value = true
  try {
    let r
    if (editingSchedId.value) {
      r = await fetch(`${GW}/api/config/scheduled-tasks/${editingSchedId.value}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(f),
      })
    } else {
      r = await fetch(`${GW}/api/config/scheduled-tasks`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(f),
      })
    }
    if (r.ok) { showSchedForm.value = false; await loadScheduledTasks() }
    else { const d = await r.json(); showAlert('保存失败: ' + (d.error || '')) }
  } catch (e: any) { showAlert('保存失败: ' + (e.message || '')) }
  schedSaving.value = false
}
async function toggleSched(t: any) {
  try {
    await fetch(`${GW}/api/config/scheduled-tasks/${t.id}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({enabled: !t.enabled}),
    })
    await loadScheduledTasks()
  } catch (e) { console.error(e) }
}
async function runSchedNow(t: any) {
  try {
    const r = await fetch(`${GW}/api/config/scheduled-tasks/${t.id}/run`, {method: 'POST'})
    if (!r.ok) { const d = await r.json(); showAlert(d.error || '执行失败'); return }
    showAlert('任务已触发')
  } catch (e: any) { showAlert('执行失败: ' + (e.message || '')) }
}
async function deleteSched(id: string) {
  showConfirm('确定删除此定时任务？', async () => {
    appConfirm.value = null
    try {
      await fetch(`${GW}/api/config/scheduled-tasks/${id}`, {method: 'DELETE'})
      await loadScheduledTasks()
    } catch (e) { console.error(e) }
  })
}

// ── IM 连接 ──
const imPlatforms = ref<any[]>([])
const imLoading = ref(false)
const editingPlatform = ref<any>(null)
const editPlatformConfig = ref('')

async function loadIM() {
  imLoading.value = true
  try {
    const res = await fetch(`${GW}/api/config/adapters`)
    if (res.ok) {
      const data = await res.json()
      imPlatforms.value = data.platforms || []
    }
  } catch {
  }
  imLoading.value = false
}

// ── 查看平台配置（JSON 格式展示）──
// 功能说明: 将平台的 accountId/baseUrl/pairedUsers 序列化为 JSON 在 code-editor 中展示
function startEditPlatform(p: any) {
  editingPlatform.value = p
  editPlatformConfig.value = JSON.stringify({
    accountId: p.accountId,
    baseUrl: p.baseUrl,
    pairedUsers: p.pairedUsers || [],
  }, null, 2)
}

// ── 保存平台配置 ──
// 功能说明: 当前版本仅做备忘展示，需手动编辑 ~/.claude/adapters.json
async function savePlatformConfig() {
  editingPlatform.value = null
  showAlert('配置已备忘。当前版本需手动编辑 ~/.claude/adapters.json 应用更改。')
}

// ── 退出平台配置查看 ──
function cancelEditPlatform() {
  editingPlatform.value = null;
  editPlatformConfig.value = ''
}

// ── IM 平台状态文案映射 ──
// 功能说明: running→"运行中"(绿色), configured→"已配置"(蓝色), 其他→"未激活"(灰色)
function statusLabel(s: string) {
  if (s === 'running') return {text: t('im.statusRunning'), cls: 'active'}
  if (s === 'configured') return {text: t('im.statusConfigured'), cls: 'configured'}
  return {text: t('im.statusInactive'), cls: 'inactive'}
}

// ── QR 绑定弹窗 / 表单配置弹窗 ──
const showBindModal = ref('')
const qrImgUrl = ref('')
const qrStatus = ref('wait')
// ── QR 状态轮询定时器 ID（每 2 秒 poll 一次扫码状态）──
let qrPollTimer: any = null

// 飞书/钉钉表单
const bindForm = ref<Record<string, string>>({})
const bindSaving = ref(false)
const bindSaved = ref(false)
const unbindId = ref('')  // 正在解绑中的平台 id
const unbindTarget = ref<any>(null)  // 待解绑的平台对象，非 null 时显示确认弹窗

// ── 通用玻璃态确认弹窗 / 提示弹窗 ──
// 替代浏览器原生 confirm() / showAlert()，统一使用 glass 风格
const appConfirm = ref<{ message: string; onOk: () => void } | null>(null)
const appAlert = ref<{ message: string } | null>(null)

function showConfirm(message: string, onOk: () => void) {
  appConfirm.value = {message, onOk}
}

function showAlert(message: string) {
  appAlert.value = {message}
}

// ── 开始绑定 IM 平台 ──
// 功能说明: 打开绑定弹窗，根据平台 bindMethod 分两路：
//   'app_config'(飞书/钉钉): 显示凭证配置表单，预留空字段
//   其他(微信): POST /api/config/adapters/:id/qrcode 获取 QR 码，启动轮询
async function startBind(platformId: string) {
  showBindModal.value = platformId
  qrImgUrl.value = ''
  qrStatus.value = 'wait'
  bindForm.value = {}
  bindSaved.value = false

  const p = imPlatforms.value.find(x => x.id === platformId)
  if (!p) return

  if (p.bindMethod === 'app_config') {
    // 飞书/钉钉: 根据平台 configFields 预填空凭证表单
    for (const f of (p.configFields || [])) bindForm.value[f.key] = ''
  } else {
    // 微信: 请求 gateway 生成 QR 码并开始轮询扫码状态
    try {
      const res = await fetch(`${GW}/api/config/adapters/${platformId}/qrcode`, {method: 'POST'})
      if (res.ok) {
        const d = await res.json()
        qrImgUrl.value = d.qrImgUrl
        startQRPoll(platformId)
      } else {
        qrStatus.value = 'expired'
      }
    } catch {
      qrStatus.value = 'expired'
    }
  }
}

// ── 启动 QR 码扫码状态轮询 ──
// 功能说明: 每 2 秒 POST /api/config/adapters/:id/qrcode/poll 查询扫码状态
//   状态映射: scaned→scanned, confirmed→confirmed(成功), expired→expired
//   confirmed 时清除定时器，2 秒后自动关闭弹窗并刷新平台列表
function startQRPoll(platformId: string) {
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${GW}/api/config/adapters/${platformId}/qrcode/poll`, {method: 'POST'})
      if (res.ok) {
        const d = await res.json()
        qrStatus.value = d.status === 'scaned' ? 'scanned' : d.status === 'confirmed' ? 'confirmed' : d.status === 'expired' ? 'expired' : 'wait'
        if (d.status === 'confirmed') {
          clearInterval(qrPollTimer);
          setTimeout(() => {
            closeBindModal();
            loadIM()
          }, 2000)
        }
      }
    } catch {
    }
  }, 2000)
}

// ── 保存 IM 凭证配置（飞书/钉钉）──
// 功能说明: PUT /api/config/adapters/:id 提交凭证表单，成功后自动关闭弹窗刷新列表
async function saveBindConfig(platformId: string) {
  const p = imPlatforms.value.find(x => x.id === platformId)
  if (!p) return
  const body: any = {}
  for (const f of (p.configFields || [])) body[f.key] = bindForm.value[f.key] || ''
  bindSaving.value = true
  try {
    const res = await fetch(`${GW}/api/config/adapters/${platformId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json();
      showAlert('保存失败: ' + (d.error || ''))
    } else {
      bindSaved.value = true
      setTimeout(() => {
        closeBindModal();
        loadIM()
      }, 1500)
    }
  } catch (e: any) {
    showAlert('保存失败: ' + (e.message || ''))
  }
  bindSaving.value = false
}

// ── 关闭绑定弹窗 + 清除 QR 轮询 ──
function closeBindModal() {
  showBindModal.value = ''
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null
  }
}

// 解绑 IM 平台：弹出确认弹窗 → 调 gateway DELETE /api/config/adapters/:id
function confirmUnbind(p: any) {
  unbindTarget.value = p
}

// ── 取消解绑操作 ──
function cancelUnbind() {
  unbindTarget.value = null
}

// ── 执行解绑 ──
// 功能说明: DELETE /api/config/adapters/:id 解绑 IM 平台，成功后刷新列表
async function doUnbind() {
  const p = unbindTarget.value
  if (!p) return
  unbindId.value = p.id
  try {
    const r = await fetch(`${GW}/api/config/adapters/${p.id}`, {method: 'DELETE'})
    if (r.ok) {
      unbindTarget.value = null;
      await loadIM()
    } else showAlert('解绑失败')
  } catch {
    showAlert('解绑失败')
  }
  unbindId.value = ''
}

// ── Tab 切换 + 懒加载 ──
// 功能说明: 更新 activeTab，首次访问对应 Tab 时自动加载数据（避免不必要的 API 请求）
//   general 检查 settings===null（未加载），其他 Tab 检查列表长度===0
function switchTab(key: TabKey) {
  activeTab.value = key
  // 所有模块在 onMounted 时已并行自动加载；general 的 settings 首次检查保留
  if (key === 'general' && !settings.value) {
    loadSettings();
    loadProviders()
  }
  if (key === 'oss') {
    loadCavemanConfig()
    loadRtkConfig()
    loadPetOptions()
  }
}

// ── 自动加载所有模块 + 失败重试基础设施 ──
// 模块加载失败标记，key 为模块名
const loadErrors = ref<Record<string, boolean>>({})
// 每个模块独立重试计数
const retryCount = ref<Record<string, number>>({})
const MAX_RETRIES = 3
// 自动重试定时器
let retryTimer: ReturnType<typeof setInterval> | null = null
let petPollTimer: ReturnType<typeof setInterval> | null = null

// 并行加载所有模块数据
async function loadAllModules() {
  const modules: Array<{ key: string; fn: () => Promise<void> }> = [
    {key: 'skills', fn: loadSkills},
    {key: 'disabledSkills', fn: loadDisabledSkills},
    {key: 'agents', fn: loadAgents},
    {key: 'commands', fn: loadCommands},
    {key: 'hooks', fn: loadHooks},
    {key: 'rules', fn: loadRules},
    {key: 'memory', fn: loadMemorySummary},
    {key: 'mcp', fn: loadMcp},
    {key: 'disabledMcpPlugins', fn: loadDisabledMcpPlugins},
    {key: 'mcpServers', fn: loadMcpServers},
    {key: 'im', fn: loadIM},
    {key: 'scheduler', fn: loadScheduledTasks},
  ]
  await Promise.all(modules.map(m =>
      m.fn().catch(() => {
        loadErrors.value[m.key] = true
      })
  ))
}

function moduleLoadFailed(key: string): boolean {
  return loadErrors.value[key] === true
}

async function retryModule(key: string) {
  const count = retryCount.value[key] || 0
  if (count >= MAX_RETRIES) return
  retryCount.value[key] = count + 1
  delete loadErrors.value[key]
  const map: Record<string, () => Promise<void>> = {
    skills: loadSkills, disabledSkills: loadDisabledSkills, agents: loadAgents, commands: loadCommands,
    hooks: loadHooks, rules: loadRules, memory: loadMemorySummary,
    mcp: loadMcp, disabledMcpPlugins: loadDisabledMcpPlugins, mcpServers: loadMcpServers, im: loadIM, scheduler: loadScheduledTasks,
  }
  if (map[key]) {
    try {
      await map[key]()
    } catch {
      loadErrors.value[key] = true
    }
  }
}

// 30 秒间隔自动重试，全部成功后停止
function startAutoRetryLoop() {
  retryTimer = setInterval(() => {
    const failed = Object.entries(loadErrors.value).filter(([, v]) => v)
    if (failed.length === 0) {
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null
      }
      ;
      return
    }
    for (const [key] of failed) retryModule(key)
  }, 30000)
}

function loadPetOptions() {
  const info = (window as any).__petInfo
  if (info) {
    petOptions.value = info.getPets()
    petOptionsLoaded.value = true
    if (!petType.value && petOptions.value.length > 0) {
      petType.value = petOptions.value[0].id
    }
  } else {
    petPollTimer = setInterval(() => {
      const p = (window as any).__petInfo
      if (p) {
        petOptions.value = p.getPets()
        petOptionsLoaded.value = true
        clearInterval(petPollTimer!)
        petPollTimer = null
        if (!petType.value && petOptions.value.length > 0) {
          petType.value = petOptions.value[0].id
        }
      }
    }, 300)
    setTimeout(() => { if (!petOptionsLoaded.value && petPollTimer) { clearInterval(petPollTimer); petPollTimer = null; petOptionsLoaded.value = true } }, 5000)
  }
}

onMounted(() => {
  loadSettings()
  loadAllModules()
  loadPetOptions()
  startAutoRetryLoop()
})

onUnmounted(() => {
  if (retryTimer) clearInterval(retryTimer)
  if (petPollTimer) clearInterval(petPollTimer)
  if (pendingDeleteSkillTimer) clearTimeout(pendingDeleteSkillTimer)
  if (pendingDeleteRuleTimer) clearTimeout(pendingDeleteRuleTimer)
  if (_stvThemeHandler) window.matchMedia?.('(prefers-color-scheme: dark)').removeEventListener('change', _stvThemeHandler)
  _cleanupUpdateAvailable?.()
  _cleanupUpdateProgress?.()
  _cleanupUpdateDownloaded?.()
  _cleanupUpdateError?.()
})
</script>

<template>
  <div class="settings-app">
    <!-- ═══ 顶部栏 ═══ -->
    <header class="settings-header">
      <button class="back-btn" @click="router.push('/')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <span>{{ t('header.back') }}</span>
      </button>
      <div class="header-center">
        <h1>{{ t('header.title') }}</h1>
        <span class="header-sub">{{ t('header.sub') }}</span>
      </div>
      <div class="header-right"></div>
    </header>

    <div class="settings-body">
      <!-- ═══ 左侧 Tab ═══ -->
      <nav class="tab-nav">
        <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="switchTab(tab.key)"
        >
          <span class="tab-icon" v-html="tab.icon"></span>
          <div class="tab-info">
            <span class="tab-label">{{ t('tab.' + tab.key) }}</span>
            <span class="tab-desc">{{ t('tab.' + tab.key + '.desc') }}</span>
          </div>
        </button>
      </nav>

      <!-- ═══ 右侧内容 ═══ -->
      <main class="tab-content">
        <!-- ──── 常规 Tab: AI 供应商 + API 配置 + 模型选择 + 其他设置 + 主题/语言 ──── -->
        <template v-if="activeTab === 'general'">
          <div v-if="settingsLoading" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else-if="settings">
            <!-- 供应商选择: provider-card 卡片列表，选中高亮+打勾，点击切换 selectProvider -->
            <section class="section-block">
              <h2 class="section-title">{{ t('gen.provider') }}</h2>
              <div class="provider-cards">
                <button
                    v-for="p in providers"
                    :key="p.id"
                    class="provider-card"
                    :class="{ active: providerId === p.id }"
                    @click="selectProvider(p.id)"
                >
                  <span class="provider-icon">{{ p.icon }}</span>
                  <div class="provider-info">
                    <span class="provider-name">{{ p.name }}</span>
                    <span class="provider-models-count">{{ t('gen.modelsCount', {n: p.models.length}) }}</span>
                  </div>
                  <svg v-if="providerId === p.id" class="provider-check" width="18" height="18" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                       stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
              </div>
            </section>

            <!-- API 配置: BaseURL + API Key(显示/隐藏掩码) + 连通性测试按钮 + provider 外链 -->
            <section class="section-block">
              <h2 class="section-title">{{ t('gen.apiConfig') }}</h2>
              <div class="api-config-card">
                <div class="field">
                  <label>Base URL</label>
                  <div class="input-with-link">
                    <input v-model="settings.env.ANTHROPIC_BASE_URL" class="field-input mono"/>
                    <a :href="currentProvider?.officialUrl" target="_blank" class="inline-link"
                       :title="t('gen.officialSite')">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  </div>
                </div>
                <div class="field">
                  <label>API Key</label>
                  <div class="api-key-row">
                    <input
                        v-model="settings.env.ANTHROPIC_AUTH_TOKEN"
                        class="field-input mono"
                        :type="showApiKey ? 'text' : 'password'"
                        :placeholder="t('gen.apiKeyPlaceholder')"
                    />
                    <button class="key-toggle-btn" @click="showApiKey = !showApiKey"
                            :title="showApiKey ? t('gen.hide') : t('gen.show')">
                      <svg v-if="!showApiKey" width="16" height="16" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path
                            d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path
                            d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>
                        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>
                        <path
                            d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>
                        <path d="m2 2 20 20"/>
                      </svg>
                    </button>
                  </div>
                  <button class="test-conn-btn" :class="testState" :disabled="testState === 'testing'"
                          @click="testConnection">
                    <svg v-if="testState === 'testing'" class="test-spinner" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
                      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
                    </svg>
                    <svg v-else-if="testState === 'ok'" width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else-if="testState === 'fail'" width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    <span>{{ testState === 'testing' ? t('gen.testing') : t('gen.testConn') }}</span>
                  </button>
                  <span v-if="testState === 'ok'" class="test-msg test-msg-ok">{{ testMsg }}</span>
                  <span v-if="testState === 'fail'" class="test-msg test-msg-fail">{{ testMsg }}</span>
                </div>
                <div v-if="currentProvider" class="provider-links">
                  <a :href="currentProvider.officialUrl" target="_blank" class="ext-link">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    {{ t('gen.officialSite') }}
                  </a>
                  <a :href="currentProvider.docsUrl" target="_blank" class="ext-link">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    {{ t('gen.apiDocs') }}
                  </a>
                  <span class="pricing-tag">{{ currentProvider.pricing?.input || '' }}</span>
                </div>
              </div>
            </section>

            <!-- 模型选择: model-card 卡片列表(动态+预设) + 自定义模型 ID 输入框 -->
            <section class="section-block">
              <h2 class="section-title">{{ t('gen.defaultModel') }} <span class="cat-badge"
                                                                          :class="modelsLive ? 'device' : ''"
                                                                          style="font-size:11px;vertical-align:middle">{{
                  modelsLive ? t('gen.modelDynamic') : t('gen.modelPreset')
                }}</span></h2>
              <div class="model-list">
                <button
                    v-for="m in currentModels"
                    :key="m.id"
                    class="model-card"
                    :class="{ active: settings.model === m.id }"
                    @click="settings.model = m.id"
                >
                  <span class="model-id">{{ m.id }}</span>
                  <span class="model-name">{{ m.name }}</span>
                  <span class="model-ctx">{{ m.contextWindow }}</span>
                </button>
                <div v-if="currentModels.length === 0" class="empty-hint-sm">{{ t('gen.customModelHint') }}</div>
              </div>
              <div class="field" style="margin-top:16px">
                <label>{{ t('gen.customModelId') }}</label>
                <input v-model="settings.model" class="field-input mono"/>
              </div>
            </section>

            <!-- 其他设置: maxContext(tokens,K/M格式) + costLimit%(滑块) + maxTurns + fileInject(KB) + theme + language -->
            <section class="section-block">
              <h2 class="section-title">{{ t('gen.other') }}</h2>
              <div class="settings-grid">
                <div class="field">
                  <label>{{ t('gen.maxContext') }}</label>
                  <input v-model="tokenInput" class="field-input mono" placeholder="1M / 200K / 1000000"
                         @blur="onTokenBlur"/>
                </div>
                <div class="field">
                  <label>{{ t('gen.costLimit') }}</label>
                  <input v-model.number="settings.costLimitPercent" type="number" min="0" max="100"
                         class="field-input mono" placeholder="50"/>
                  <span class="field-hint">{{ t('gen.costLimitHint') }}</span>
                </div>
                <div class="field">
                  <label>{{ t('gen.maxTurns') }}</label>
                  <input v-model.number="settings.maxTurns" type="number" min="1" max="500" class="field-input mono"
                         placeholder="40"/>
                  <span class="field-hint">{{ t('gen.maxTurnsHint') }}</span>
                </div>
                <div class="field">
                  <label>{{ t('gen.fileInject') }}</label>
                  <input v-model.number="settings.fileInjectLimitKB" type="number" min="0" max="2048"
                         class="field-input mono" placeholder="200"/>
                  <span class="field-hint">{{ t('gen.fileInjectHint') }}</span>
                </div>
                <div class="field">
                  <label>{{ t('gen.theme') }}</label>
                  <select v-model="settings.theme" class="field-input">
                    <option value="system">{{ t('gen.theme.system') }}</option>
                    <option value="dark">{{ t('gen.theme.dark') }}</option>
                    <option value="light">{{ t('gen.theme.light') }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>{{ t('gen.language') }}</label>
                  <select v-model="settings.language" class="field-input">
                    <option value="chinese">{{ t('gen.lang.zh') }}</option>
                    <option value="english">{{ t('gen.lang.en') }}</option>
                  </select>
                </div>
              </div>
            </section>

            <!-- 应用版本与更新 -->
            <section class="section-block">
              <h2 class="section-title">应用更新</h2>
              <p class="section-desc">更新通过 GitHub Releases 分发，检测到新版本后可一键下载安装</p>
              <div v-if="appVersion" class="field">
                <label>当前版本</label>
                <span class="field-value">v{{ appVersion }}</span>
              </div>
              <div v-if="updateAvailable" class="field">
                <label>最新版本</label>
                <span class="field-value" style="color:var(--success);font-weight:600">v{{ updateAvailable.version }}</span>
              </div>
              <div v-if="updateError" class="hint-warn" style="margin-top:6px">{{ updateError }}</div>
              <div v-if="updateAvailable && !updateDownloaded && !updateDownloading" style="margin-top:10px">
                <button class="btn-primary" @click="downloadAppUpdate">{{ t('gen.updateDownload') }}</button>
              </div>
              <div v-if="updateDownloading" style="margin-top:10px">
                <div class="progress-bar-wrap" style="height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden">
                  <div :style="{width:updateProgress+'%',height:'100%',background:'var(--accent-blue)',transition:'width .3s'}"></div>
                </div>
                <span style="font-size:12px;color:var(--text-muted)">{{ t('gen.updateProgress', {pct: updateProgress}) }}</span>
              </div>
              <div v-if="updateDownloaded" style="margin-top:10px">
                <div class="hint-warn" style="margin-bottom:8px">{{ t('gen.updateReadyHint', {version: updateAvailable?.version || ''}) }}</div>
                <button class="btn-primary" @click="installAppUpdate">{{ t('gen.updateInstall') }}</button>
              </div>
              <div style="margin-top:12px">
                <button class="btn-secondary btn-sm" :disabled="updateChecking" @click="checkAppUpdate">
                  {{ updateChecking ? t('gen.updateChecking') : t('gen.updateCheck') }}
                </button>
              </div>
            </section>

          </div>

          <div class="action-bar">
            <span v-if="settingsSaved" class="save-ok">{{ t('gen.savedOk') }}</span>
            <span v-if="settingsError" class="save-err">{{ settingsError }}</span>
            <button class="btn-primary" @click="saveSettings">{{ t('gen.saveBtn') }}</button>
          </div>
        </template>

        <!-- ──── Skills Tab: 分类标签 + 新建表单 + 列表(含分类徽章) + 全屏 code-editor 编辑 ──── -->
        <template v-if="activeTab === 'skills'">
          <div v-if="skillsLoading && skills.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else class="list-panel">
            <div v-if="editingSkill" class="editor-full">
              <div class="editor-header">
                <h3>{{ t('skills.editTitle', {name: editingSkill.name}) }}</h3>
                <button class="btn-text" @click="cancelEditSkill">{{ t('common.cancel') }}</button>
              </div>
              <textarea v-model="editSkillContent" class="code-editor" spellcheck="false"></textarea>
              <div class="editor-footer">
                <span v-if="skillSaved" class="save-ok">{{ t('common.saved') }}</span>
                <button class="btn-primary" :disabled="skillSaving" @click="saveSkill">{{ t('common.save') }}</button>
              </div>
            </div>
            <template v-else>
              <!-- 错误横幅 -->
              <div v-if="moduleLoadFailed('skills')" class="error-banner">
                <span>{{ t('common.loadFailed') }}</span>
                <button class="retry-btn" @click="retryModule('skills')"
                        :disabled="(retryCount['skills'] || 0) >= MAX_RETRIES">
                  {{ (retryCount['skills'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
                </button>
              </div>
              <!-- 模块标题 + 刷新按钮 -->
              <div class="module-header">
                <div class="module-header-left">
                  <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{
                      t('tab.skills')
                    }}</span>
                  <span class="cat-badge device">{{ t('common.builtin') }} {{ skillsSourceCounts.builtin }}</span>
                  <span class="cat-badge custom-badge">{{ t('common.custom') }} {{ skillsSourceCounts.custom }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button class="btn-add" @click="showNewSkill = true" :title="t('common.new')">+</button>
                  <button class="refresh-btn" :class="{ spinning: skillsLoading }" @click="loadSkills"
                          :disabled="skillsLoading" :title="t('common.refresh')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="cat-row" style="flex-wrap:wrap;gap:8px">
                <div class="cat-tags">
                  <button class="cat-tag" :class="{ active: !activeSkillSource }" @click="activeSkillSource = ''">
                    {{ t('common.all') }}
                  </button>
                  <button class="cat-tag" :class="{ active: activeSkillSource === 'builtin' }"
                          @click="activeSkillSource = 'builtin'">{{ t('common.builtin') }}
                  </button>
                  <button class="cat-tag" :class="{ active: activeSkillSource === 'custom' }"
                          @click="activeSkillSource = 'custom'">{{ t('common.custom') }}
                  </button>
                </div>
                <input v-model="skillSearch" :placeholder="t('skills.searchPlaceholder')" class="field-input"
                       style="max-width:180px;margin-left:auto" @keydown.enter="searchMarket"/>
              </div>
              <!-- ── 市场搜索结果 ── -->
              <div v-if="marketResults.length" class="item-list" style="margin-top:8px">
                <div v-for="item in marketResults" :key="item.name || item.id" class="list-item">
                  <div class="item-info">
                    <div class="item-name">
                      {{ item.name || item.id }}
                      <span class="cat-badge" :class="{ device: item.source === 'github' }"
                            :title="item.source">{{ item.source || 'unknown' }}</span>
                      <span v-if="item.stars" class="cat-badge" style="background:rgba(212,168,83,0.1);color:#d4a853">&#9733; {{ item.stars }}</span>
                      <span v-if="item.version" class="cat-badge" style="background:rgba(107,150,224,0.1);color:#6b96e0">v{{ item.version }}</span>
                    </div>
                    <div class="item-desc">{{ item.description || item.summary || '' }}</div>
                  </div>
                  <button class="btn-primary" style="padding:6px 16px;font-size:13px"
                          :disabled="marketInstalling === (item.name || item.id)"
                          @click="installFromMarket(item)">
                    {{ marketInstalling === (item.name || item.id) ? t('skills.installing') : t('skills.install') }}
                  </button>
                </div>
              </div>
              <div v-if="marketResults.length === 0 && skillSearch.trim() && !marketSearching" class="empty-state-sm">{{ t('skills.marketEmpty') }}</div>
              <!-- 列表: 内置只显示名称+徽章(只读)，自定义可编辑+开关 -->
              <div class="item-list">
                <div v-for="skill in filteredSkills" :key="skill.name" class="list-item"
                     :class="{ readonly: skill.source === 'builtin', disabled: skill.source === 'custom' && disabledSkills.includes(skill.name) }"
                     @click="skill.content !== null && startEditSkill(skill)" style="opacity:1">
                  <div class="item-icon"
                       v-html="skill.source === 'builtin' ? ri('<rect x=&quot;3&quot; y=&quot;11&quot; width=&quot;18&quot; height=&quot;11&quot; rx=&quot;2&quot; ry=&quot;2&quot;/><path d=&quot;M7 11V7a5 5 0 0 1 10 0v4&quot;/>') : ri('<polygon points=&quot;12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2&quot;/>')"></div>
                  <div class="item-info">
                    <div class="item-name">
                      {{ skill.name }}
                      <span class="cat-badge" :class="{ device: skill.source === 'builtin' }">{{
                          skill.source === 'builtin' ? t('common.builtin') : t('common.custom')
                        }}</span>
                      <span v-if="skill.source === 'custom' && disabledSkills.includes(skill.name)" class="cat-badge" style="background:rgba(233,69,96,0.08);color:var(--error)">{{ t('common.disabled') }}</span>
                    </div>
                  </div>
                  <!-- 仅自定义 skill 可开关/删除；已禁用的才能删除 -->
                  <template v-if="skill.source === 'custom'">
                    <button v-if="disabledSkills.includes(skill.name) && pendingDeleteSkill !== skill.name" class="btn-icon" title="删除"
                            @click.stop="deleteSkill(skill.name)"
                            style="padding:4px 8px;margin-right:6px;color:var(--error);border:1px solid var(--error);border-radius:6px;font-size:12px;background:transparent;cursor:pointer">
                      {{ t('common.delete') }}
                    </button>
                    <button v-else-if="disabledSkills.includes(skill.name)" class="btn-icon" title="确认删除"
                            @click.stop="deleteSkill(skill.name)"
                            style="padding:4px 8px;margin-right:6px;color:#fff;background:var(--error);border:1px solid var(--error);border-radius:6px;font-size:12px;cursor:pointer">
                      {{ t('common.confirm') }}
                    </button>
                    <label class="toggle-switch" @click.stop="toggleSkillEnabled(skill)" style="margin-right:10px">
                      <input type="checkbox" :checked="!disabledSkills.includes(skill.name)" @click.stop @change="toggleSkillEnabled(skill)"/>
                      <span class="toggle-slider"></span>
                    </label>
                    <svg v-if="skill.content !== null" class="item-arrow" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </template>
                  <span v-else class="item-right-tag">{{ t('common.readOnly') }}</span>
                </div>
                <div v-if="filteredSkills.length === 0" class="empty-state-sm">{{ t('skills.empty') }}</div>
              </div>
            </template>
          </div>
        </template>

        <!-- ──── Agents Tab: 新建表单(name/desc/tools/model) + 列表(含 loaded徽章+model徽章+删除) + 全屏编辑 ──── -->
        <template v-if="activeTab === 'agents'">
          <div v-if="agentsLoading && agents.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else class="list-panel">
            <div v-if="editingAgent" class="editor-full">
              <div class="editor-header">
                <h3>{{ t('agents.editTitle', {name: editingAgent.name}) }}</h3>
                <button class="btn-text" @click="cancelEditAgent">{{ t('common.cancel') }}</button>
              </div>
              <textarea v-model="editAgentContent" class="code-editor" spellcheck="false"></textarea>
              <div class="editor-footer">
                <span v-if="agentSaved" class="save-ok">{{ t('common.saved') }}</span>
                <button class="btn-primary" :disabled="agentSaving" @click="saveAgent">{{ t('common.save') }}</button>
              </div>
            </div>
            <template v-else>
              <!-- 错误横幅 -->
              <div v-if="moduleLoadFailed('agents')" class="error-banner">
                <span>{{ t('common.loadFailed') }}</span>
                <button class="retry-btn" @click="retryModule('agents')"
                        :disabled="(retryCount['agents'] || 0) >= MAX_RETRIES">
                  {{ (retryCount['agents'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
                </button>
              </div>
              <!-- 模块标题 + 刷新 -->
              <div class="module-header">
                <div class="module-header-left">
                  <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{
                      t('tab.agents')
                    }}</span>
                  <span class="cat-badge device">{{ t('common.builtin') }} {{ agentsSourceCounts.builtin }}</span>
                  <span class="cat-badge custom-badge">{{ t('common.custom') }} {{ agentsSourceCounts.custom }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button class="btn-add" @click="showNewAgent = true" :title="t('common.new')">+</button>
                  <button class="refresh-btn" :class="{ spinning: agentsLoading }" @click="loadAgents"
                          :disabled="agentsLoading" :title="t('common.refresh')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                </div>
              </div>
              <!-- 来源筛选 + 类型筛选 + 新建按钮 -->
              <div class="cat-row" style="flex-wrap:wrap;gap:8px">
                <div class="cat-tags">
                  <button class="cat-tag" :class="{ active: !activeAgentSource }" @click="activeAgentSource = ''">
                    {{ t('common.all') }}
                  </button>
                  <button class="cat-tag" :class="{ active: activeAgentSource === 'builtin' }"
                          @click="activeAgentSource = 'builtin'">{{ t('common.builtin') }}
                  </button>
                  <button class="cat-tag" :class="{ active: activeAgentSource === 'custom' }"
                          @click="activeAgentSource = 'custom'">{{ t('common.custom') }}
                  </button>
                </div>
              </div>
              <!-- 列表: 每项显示名称+徽章+描述，内置只读项不可点击编辑 -->
              <div class="item-list">
                <div
                    v-for="agent in (activeAgentSource ? agents.filter(function(a){return a.source===activeAgentSource}) : agents)"
                    :key="agent.filename || agent.name" class="list-item" :class="{ readonly: agent.content === null }">
                  <div class="item-icon"
                       v-html="agent.content === null && agent.source === 'builtin' ? ri('<rect x=&quot;3&quot; y=&quot;11&quot; width=&quot;18&quot; height=&quot;11&quot; rx=&quot;2&quot; ry=&quot;2&quot;/><path d=&quot;M7 11V7a5 5 0 0 1 10 0v4&quot;/>') : ri('<path d=&quot;M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2&quot;/><circle cx=&quot;9&quot; cy=&quot;7&quot; r=&quot;4&quot;/><path d=&quot;M22 21v-2a4 4 0 0 0-3-3.87&quot;/><path d=&quot;M16 3.13a4 4 0 0 1 0 7.75&quot;/>')"></div>
                  <div class="item-info" @click="agent.content !== null && startEditAgent(agent)"
                       :style="{ cursor: agent.content !== null ? 'pointer' : 'default' }">
                    <div class="item-name">
                      {{ agent.name }}
                      <span class="cat-badge" :class="{ device: agent.source === 'builtin' }">{{
                          agent.source === 'builtin' ? t('common.builtin') : t('common.custom')
                        }}</span>
                      <span v-if="agent.type" class="cat-badge badge-type">{{ agent.type }}</span>
                      <span v-if="agent.language" class="cat-badge badge-lang">{{ agent.language }}</span>
                      <span v-if="agent.loaded" class="cat-badge device">{{ t('agents.loaded') }}</span>
                      <span class="cat-badge">{{ agent.model || 'inherit' }}</span>
                    </div>
                    <div class="item-desc">{{ agent.description || t('common.noDesc') }}</div>
                  </div>
                  <span class="skill-allowed">{{ agent.tools || t('agents.inheritAll') }}</span>
                  <button v-if="agent.content !== null" class="btn-danger-sm" @click.stop="deleteAgent(agent)"
                          :title="t('common.delete')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                  </button>
                </div>
                <div v-if="agents.length === 0" class="empty-state-sm">{{ t('agents.empty') }}</div>
              </div>
            </template>
          </div>
        </template>

        <!-- ──── 命令 Tab: 搜索框 + live/cached 状态徽章 + 只读斜杠命令列表（名称+描述+参数提示）──── -->
        <template v-if="activeTab === 'commands'">
          <div v-if="commandsLoading && commands.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else class="list-panel">
            <!-- 错误横幅 -->
            <div v-if="moduleLoadFailed('commands')" class="error-banner">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="retryModule('commands')"
                      :disabled="(retryCount['commands'] || 0) >= MAX_RETRIES">
                {{ (retryCount['commands'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <!-- 模块标题 + 刷新 -->
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{
                    t('tab.commands')
                  }}</span>
                <span class="cat-badge device">{{ t('common.builtin') }} {{ commandsSourceCounts.builtin }}</span>
                <span class="cat-badge custom-badge">{{ t('common.custom') }} {{ commandsSourceCounts.custom }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
                <button class="refresh-btn" :class="{ spinning: commandsLoading }" @click="loadCommands"
                      :disabled="commandsLoading" :title="t('common.refresh')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
            </div>
            <div class="cat-row" style="flex-wrap:wrap;gap:8px">
              <div class="cat-tags">
                <button class="cat-tag" :class="{ active: !activeCommandSource }" @click="activeCommandSource = ''">
                  {{ t('common.all') }}
                </button>
                <button class="cat-tag" :class="{ active: activeCommandSource === 'builtin' }"
                        @click="activeCommandSource = 'builtin'">{{ t('common.builtin') }}
                </button>
                <button class="cat-tag" :class="{ active: activeCommandSource === 'custom' }"
                        @click="activeCommandSource = 'custom'">{{ t('common.custom') }}
                </button>
              </div>
              <span class="cat-badge" :class="commandsLive ? 'device' : ''"
                    style="margin-left:8px">{{ commandsLive ? t('cmd.live') : t('cmd.cached') }}</span>
              <input v-model="commandSearch" :placeholder="t('cmd.searchPlaceholder')" class="field-input"
                     style="max-width:180px;margin-left:auto"/>
            </div>
            <div v-if="!commandsLive" class="empty-hint-sm" style="margin:8px 0">{{ t('cmd.cacheHint') }}</div>
            <div class="item-list">
              <div v-for="cmd in filteredCommands" :key="cmd.name" class="list-item">
                <div class="item-icon"
                     v-html="ri('<polyline points=&quot;4 17 10 11 4 5&quot;/><line x1=&quot;12&quot; y1=&quot;19&quot; x2=&quot;20&quot; y2=&quot;19&quot;/>')"></div>
                <div class="item-info">
                  <div class="item-name">
                    /{{ cmd.name }}
                    <span v-if="cmd.argumentHint" class="mono"
                          style="color:var(--text-muted);font-size:12px;font-weight:400">{{ cmd.argumentHint }}</span>
                    <span class="cat-badge" :class="{ device: cmd.source === 'builtin' }" style="margin-left:6px">{{
                        cmd.source === 'builtin' ? t('common.builtin') : t('common.custom')
                      }}</span>
                  </div>
                  <div class="item-desc">{{ cmd.description || t('common.noDesc') }}</div>
                </div>
              </div>
              <div v-if="filteredCommands.length === 0" class="empty-state-sm">{{ t('cmd.empty') }}</div>
            </div>
          </div>
        </template>

        <!-- ──── Hooks Tab: event 组列表(matcher+timeout+hook文件) + 新建表单 + 全屏编辑 ──── -->
        <template v-if="activeTab === 'hooks'">
          <div v-if="hooksLoading && !hooks" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else-if="editingHook" class="editor-full">
            <div class="editor-header">
              <h3>{{ editingHook.filename }}</h3>
              <button class="btn-text" @click="cancelEditHook">{{ t('common.cancel') }}</button>
            </div>
            <textarea v-model="editHookContent" class="code-editor" spellcheck="false"></textarea>
            <div class="editor-footer">
              <span v-if="hookSaved" class="save-ok">{{ t('common.saved') }}</span>
              <button class="btn-primary" :disabled="hookSaving" @click="saveHook">{{ t('common.save') }}</button>
            </div>
          </div>
          <div v-else-if="hooks" class="list-panel">
            <!-- 错误横幅 -->
            <div v-if="moduleLoadFailed('hooks')" class="error-banner">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="retryModule('hooks')"
                      :disabled="(retryCount['hooks'] || 0) >= MAX_RETRIES">
                {{ (retryCount['hooks'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <!-- 模块标题 + 刷新按钮 -->
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{ t('tab.hooks') }}</span>
                <span class="cat-badge custom-badge">{{
                    t('common.custom')
                  }} {{
                    Object.keys(hooks).reduce((s, e) => s + (hooks[e] || []).reduce((a, en) => a + (en.hooks || []).length, 0), 0)
                  }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <button class="btn-add" @click="showNewHook = true" :title="t('common.new')">+</button>
                <button class="refresh-btn" :class="{ spinning: hooksLoading }" @click="loadHooks"
                        :disabled="hooksLoading" :title="t('common.refresh')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="cat-row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
              <input v-model="hookSearch" :placeholder="t('hooks.searchPlaceholder')" class="field-input"
                     style="max-width:200px;margin-left:auto"/>
            </div>
            <div v-for="(eventHooks, eventType) in filteredHooks" :key="eventType" class="hook-group">
              <h3 class="hook-event-title">{{ eventType }}</h3>
              <div v-for="(entry, ei) in eventHooks" :key="ei" class="hook-entry">
                <div class="hook-header">
                  <span class="hook-matcher">{{ entry.matcher || '*' }}</span>
                  <span class="hook-timeout">{{ entry.timeout || 0 }}s</span>
                </div>
                <div
                    v-for="(h, hi) in entry.hooks"
                    :key="hi"
                    class="list-item hook-file"
                    @click="startEditHook(h)"
                >
                  <div class="item-icon"
                       v-html="ri('<path d=&quot;M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16&quot;/>')"></div>
                  <div class="item-info">
                    <div class="item-name">
                      {{ h.command }}
                      <span class="cat-badge custom-badge" style="margin-left:6px">{{ t('common.custom') }}</span>
                    </div>
                    <div class="item-desc">{{ h.type }}</div>
                  </div>
                  <svg class="item-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ──── Rules Tab: 语言分类标签 + 新建表单(filename+paths) + 列表(含语言徽章+文件大小) + 全屏编辑 ──── -->
        <template v-if="activeTab === 'rules'">
          <div v-if="rulesLoading && rules.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else-if="editingRule" class="editor-full">
            <div class="editor-header">
              <h3>{{ editingRule.filename }}</h3>
              <button class="btn-text" @click="cancelEditRule">{{ t('common.cancel') }}</button>
            </div>
            <textarea v-model="editRuleContent" class="code-editor" spellcheck="false"></textarea>
            <div class="editor-footer">
              <span v-if="ruleSaved" class="save-ok">{{ t('common.saved') }}</span>
              <button class="btn-primary" :disabled="ruleSaving" @click="saveRule">{{ t('common.save') }}</button>
            </div>
          </div>
          <template v-else>
            <!-- 错误横幅 -->
            <div v-if="moduleLoadFailed('rules')" class="error-banner">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="retryModule('rules')"
                      :disabled="(retryCount['rules'] || 0) >= MAX_RETRIES">
                {{ (retryCount['rules'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <!-- 模块标题 + 刷新 -->
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{ t('tab.rules') }}</span>
                <span class="cat-badge device">{{ t('common.builtin') }} {{ rulesSourceCounts.builtin }}</span>
                <span class="cat-badge custom-badge">{{ t('common.custom') }} {{ rulesSourceCounts.custom }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <button class="btn-add" @click="showNewRule = true" :title="t('common.new')">+</button>
                <button class="refresh-btn" :class="{ spinning: rulesLoading }" @click="loadRules"
                        :disabled="rulesLoading" :title="t('common.refresh')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
              </div>
            </div>
            <!-- 来源筛选 + 搜索 -->
            <div class="cat-row" style="flex-wrap:wrap;gap:8px">
              <div class="cat-tags">
                <button class="cat-tag" :class="{ active: !activeRuleSource }" @click="activeRuleSource = ''">
                  {{ t('common.all') }}
                </button>
                <button class="cat-tag" :class="{ active: activeRuleSource === 'builtin' }"
                        @click="activeRuleSource = 'builtin'">{{ t('common.builtin') }}
                </button>
                <button class="cat-tag" :class="{ active: activeRuleSource === 'custom' }"
                        @click="activeRuleSource = 'custom'">{{ t('common.custom') }}
                </button>
              </div>
              <input v-model="ruleSearch" :placeholder="t('rules.searchPlaceholder')" class="field-input" style="width:200px;margin-left:auto"/>
            </div>
            <div class="list-panel">
              <div v-for="rule in filteredRules" :key="rule.filename" class="list-item">
                <div class="item-icon"
                     v-html="ri('<path d=&quot;M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z&quot;/><polyline points=&quot;14 2 14 8 20 8&quot;/><line x1=&quot;16&quot; y1=&quot;13&quot; x2=&quot;8&quot; y2=&quot;13&quot;/><line x1=&quot;16&quot; y1=&quot;17&quot; x2=&quot;8&quot; y2=&quot;17&quot;/>')" @click="startEditRule(rule)"></div>
                <div class="item-info" @click="startEditRule(rule)">
                  <div class="item-name">
                    {{ rule.filename }}
                    <span class="cat-badge" :class="{ device: rule.source === 'builtin' }">{{
                        rule.source === 'builtin' ? t('common.builtin') : t('common.custom')
                      }}</span>
                    <span class="cat-badge">{{ ruleCategories[ruleCategory(rule)]?.label || 'Other' }}</span>
                  </div>
                  <div class="item-desc">{{ rule.frontmatter?.paths || t('rules.noPaths') }} ·
                    {{ (rule.size / 1024).toFixed(1) }}KB
                  </div>
                </div>
                <button v-if="rule.source === 'custom'" class="btn-danger-sm" @click.stop="deleteRule(rule.filename)" :title="t('common.delete')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
                <svg class="item-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" @click="startEditRule(rule)">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
              <div v-if="filteredRules.length === 0" class="empty-state-sm">{{ t('rules.empty') }}</div>
            </div>
          </template>
        </template>

        <!-- ──── Memory Tab: 项目摘要列表 + 展开查看文件 + 新建/编辑/删除 memory 文件 ──── -->
        <template v-if="activeTab === 'memory'">
          <!-- Memory 编辑模式: 全屏 code-editor 编辑 markdown 内容，点保存写回文件 -->
          <div v-if="editingMemory" class="editor-full">
            <div class="editor-header">
              <h3>{{ editingMemory.filename }} <span class="editor-sub">— {{ editingMemory.encodedDir }}</span></h3>
              <button class="btn-text" @click="cancelEditMemory">{{ t('common.cancel') }}</button>
            </div>
            <textarea v-model="editMemoryContent" class="code-editor" spellcheck="false"></textarea>
            <div class="editor-footer">
              <span v-if="memorySaved" class="save-ok">{{ t('common.saved') }}</span>
              <button class="btn-primary" :disabled="memorySaving" @click="saveMemory">{{ t('common.save') }}</button>
            </div>
          </div>

          <!-- Memory 摘要视图: 项目列表 + 展开查看文件 + 新建/删除 -->
          <div v-else class="list-panel">
            <!-- 错误横幅 -->
            <div v-if="moduleLoadFailed('memory')" class="error-banner">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="retryModule('memory')"
                      :disabled="(retryCount['memory'] || 0) >= MAX_RETRIES">
                {{ (retryCount['memory'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{
                    t('tab.memory')
                  }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
                <button class="refresh-btn" :class="{ spinning: memoryLoading }" @click="loadMemorySummary"
                      :disabled="memoryLoading" :title="t('common.refresh')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
            </div>
            <div v-if="memoryLoading" class="loading-state">{{ t('mem.scanning') }}</div>
            <div v-else-if="memoryProjects.length === 0" class="empty-state-lg">
              <div class="empty-icon"
                   v-html="ri('<path d=&quot;M12 20h9&quot;/><path d=&quot;M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z&quot;/>')"></div>
              <p>{{ t('mem.emptyTitle') }}</p>
              <span>{{ t('mem.emptyHint1') }}</span>
              <span>{{ t('mem.emptyHint2') }}</span>
            </div>
            <div v-else>
              <div class="memory-summary-header">
                <span>{{ t('mem.totalFiles', {n: memoryProjects.reduce((s, p) => s + p.fileCount, 0)}) }}</span>
              </div>
              <div v-for="proj in memoryProjects" :key="proj.encodedDir" class="memory-project-group">
                <div class="memory-proj-header" @click="toggleMemoryProject(proj.encodedDir)">
                  <svg class="proj-chevron" :class="{ open: expandedMemoryProj === proj.encodedDir }" width="12"
                       height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  <span class="proj-name">{{ proj.workDir.split('/').pop() || proj.workDir }}</span>
                  <span class="proj-path">{{ proj.workDir }}</span>
                  <span class="proj-count">{{ t('mem.fileCount', {n: proj.fileCount}) }}</span>
                </div>
                <div v-if="expandedMemoryProj === proj.encodedDir" class="memory-files">
                  <div class="memory-create">
                    <input v-model="newMemoryName" :placeholder="t('mem.newPlaceholder')" class="field-input"
                           @keydown.enter="createMemory(proj.encodedDir)"/>
                    <button class="btn-primary" :disabled="!newMemoryName.trim() || memorySaving"
                            @click="createMemory(proj.encodedDir)">{{ t('common.create') }}
                    </button>
                  </div>
                  <div v-for="file in proj.files" :key="file.filename" class="list-item">
                    <div class="item-icon"
                         v-html="ri('<path d=&quot;M12 20h9&quot;/><path d=&quot;M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z&quot;/>')"></div>
                    <div class="item-info" @click="startEditMemory(file, proj.encodedDir)" style="cursor:pointer">
                      <div class="item-name">{{ file.filename }}</div>
                      <div class="item-desc">{{ (file.size / 1024).toFixed(1) }}KB</div>
                    </div>
                    <button class="btn-danger-sm" @click="deleteMemory(file.filename, proj.encodedDir)"
                            :title="t('common.delete')">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                  <div v-if="proj._loading" class="empty-hint-sm">{{ t('mem.loadingFiles') }}</div>
                  <div v-else-if="!proj.files || proj.files.length === 0" class="empty-hint-sm">{{ t('mem.noFiles') }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ──── Workflow Tab: DAG 设计器 → 指令注入 ──── -->
        <template v-if="activeTab === 'workflow'">
          <WorkflowTab/>
        </template>

        <!-- ──── IM 连接 Tab: 平台卡片(状态+配置+绑定指南+按钮) + 查看配置编辑器 + 绑定弹窗 + 解绑确认 ──── -->
        <template v-if="activeTab === 'im'">
          <div v-if="imLoading && imPlatforms.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else-if="editingPlatform" class="editor-full">
            <div class="editor-header">
              <h3><span class="im-icon" v-html="editingPlatform.icon"></span> {{ editingPlatform.name }} —
                {{ t('im.viewConfig') }}</h3>
              <button class="btn-text" @click="cancelEditPlatform">{{ t('common.cancel') }}</button>
            </div>
            <textarea v-model="editPlatformConfig" class="code-editor" spellcheck="false"
                      style="min-height:200px"></textarea>
            <div class="editor-footer">
              <button class="btn-primary" @click="savePlatformConfig">{{ t('common.save') }}</button>
            </div>
          </div>
          <div v-else class="list-panel">
            <!-- 错误横幅 -->
            <div v-if="moduleLoadFailed('im')" class="error-banner">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="retryModule('im')" :disabled="(retryCount['im'] || 0) >= MAX_RETRIES">
                {{ (retryCount['im'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <!-- 模块标题 + 刷新 -->
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{ t('tab.im') }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
                <button class="refresh-btn" :class="{ spinning: imLoading }" @click="loadIM" :disabled="imLoading"
                      :title="t('common.refresh')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
            </div>
            <!-- IM 平台卡片: 图标+名称+状态+API地址+绑定用户数+配置指南+绑定/解绑按钮 -->
            <div v-for="p in imPlatforms" :key="p.id" class="im-card">
              <div class="im-card-header">
                <div class="im-card-title">
                  <span class="im-icon" v-html="p.icon"></span>
                  <div>
                    <span class="im-name">{{ p.name }}</span>
                    <span class="im-id" v-if="p.accountId">{{ p.accountId }}</span>
                  </div>
                </div>
                <span class="im-status" :class="statusLabel(p.status).cls">
                  <span class="im-status-dot"></span>
                  {{ statusLabel(p.status).text }}
                </span>
              </div>

              <div class="im-card-body">
                <div class="im-row">
                  <span class="im-label">{{ t('im.apiAddr') }}</span>
                  <code class="im-value">{{ p.baseUrl }}</code>
                </div>
                <div class="im-row" v-if="p.pairedUsers?.length">
                  <span class="im-label">{{ t('im.boundUsers') }}</span>
                  <span class="im-value">{{ t('im.boundUsersN', {n: p.pairedUsers.length}) }}</span>
                </div>
              </div>

              <div class="im-guide">
                <div class="im-guide-title">{{ p.guideTitle }}</div>
                <div class="im-guide-steps">
                  <div v-for="(s, i) in p.guideSteps" :key="i" class="im-step">{{ s }}</div>
                </div>
              </div>

              <div class="im-card-actions">
                <button class="btn-bind" :class="{ bound: p.hasAccount }"
                        @click="p.hasAccount ? startEditPlatform(p) : startBind(p.id)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  {{ p.hasAccount ? t('im.bound') : p.id === 'wechat' ? t('im.bindQr') : t('im.bindCred') }}
                </button>
                <button v-if="p.hasAccount" class="btn-unbind" :disabled="unbindId === p.id" @click="confirmUnbind(p)">
                  <template v-if="unbindId === p.id">{{ t('im.unbinding') }}</template>
                  <template v-else>{{ t('im.unbind') }}</template>
                </button>
              </div>
            </div>

            <div v-if="imPlatforms.length === 0 && !imLoading" class="empty-state-sm">{{ t('im.noPlatform') }}</div>

            <div class="mcp-note" style="margin-top:20px">
              <h3>{{ t('im.noteTitle') }}</h3>
              <p>{{ t('im.note1') }}</p>
              <p style="margin-top:8px">{{ t('im.note2') }}</p>
            </div>
          </div>
        </template>

        <!-- ──── Scheduler Tab: 定时任务列表 + CRUD ──── -->
        <template v-if="activeTab === 'scheduler'">
          <div v-if="schedLoading && scheduledTasks.length === 0" class="loading-state">{{ t('common.loading') }}</div>
          <div v-else class="list-panel">
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">定时任务</span>
                <span class="cat-badge device">{{ scheduledTasks.length }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
                <button class="btn-add" @click="openNewSched">+</button>
              <button class="refresh-btn" :class="{ spinning: schedLoading }" @click="loadScheduledTasks"
                      :disabled="schedLoading" :title="t('common.refresh')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
              </div>
            </div>
            <div style="display:flex;margin-bottom:8px">
              <input v-model="schedSearch" class="field-input" placeholder="搜索定时任务..." style="max-width:180px;margin-left:auto"/>
            </div>
            <div v-if="scheduledTasks.length === 0 && !schedLoading" class="empty-state-sm">暂无定时任务</div>
            <div v-for="t in filteredScheduledTasks" :key="t.id" class="list-item" style="cursor:pointer" @click="editSched(t)">
              <div class="item-icon" v-html="ri('<circle cx=&quot;12&quot; cy=&quot;12&quot; r=&quot;10&quot;/><polyline points=&quot;12 6 12 12 16 14&quot;/>')"></div>
              <div class="item-info">
                <div class="item-name">
                  {{ t.prompt?.slice(0, 50) || '(无 prompt)' }}
                </div>
                <div class="item-desc">
                  <span class="cat-badge" style="background:var(--bg-deep);color:var(--text-muted);font-family:var(--font-mono);font-size:11px">{{ t.cron }}</span>
                  <span style="margin-left:8px;font-size:12px;color:var(--text-muted)">{{ t.workDir }}</span>
                </div>
              </div>
              <label class="toggle-switch" @click.stop style="margin-left:auto">
                <input type="checkbox" :checked="t.enabled" @change="toggleSched(t)"/>
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-run-sm" @click.stop="runSchedNow(t)" style="margin-left:4px" title="立即执行一次">
                <!-- play icon -->
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
              <button class="btn-danger-sm" @click.stop="deleteSched(t.id)" style="margin-left:4px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>
            </div>
          </div>
        </template>

        <!-- ──── 开源集成 Tab: 宠物 + Caveman + RTK 三合一管理 ──── -->
        <template v-if="activeTab === 'oss'">
          <div class="oss-cards">
            <!-- 桌面宠物 -->
            <section class="section-block oss-card">
              <h2 class="section-title">WindowPet</h2>
              <p class="oss-repo">项目地址：<a class="repo-link" href="https://github.com/SeakMengs/WindowPet" target="_blank">github.com/SeakMengs/WindowPet</a></p>
              <p class="section-desc">基于 Tauri + React 的桌面宠物叠层应用，支持多种萌宠/动漫角色伴行（MIT 开源）</p>
              <div class="field">
                <label>{{ t('gen.enable') }}</label>
                <label class="toggle-switch">
                  <input type="checkbox" v-model="petEnabled" @change="savePetEnabled" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="field" v-if="petEnabled">
                <label>选择宠物</label>
                <select v-if="petOptionsLoaded" v-model="petType" @change="savePetType" class="field-input" style="width:180px">
                  <option v-for="p in petOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
                <span v-else class="field-value">{{ t('common.loading') }}</span>
              </div>
            </section>

            <!-- Caveman -->
            <section class="section-block oss-card">
              <h2 class="section-title">Caveman</h2>
              <p class="oss-repo">项目地址：<a class="repo-link" href="https://github.com/JuliusBrussee/caveman" target="_blank">github.com/JuliusBrussee/caveman</a></p>
              <p class="section-desc">{{ t('gen.caveman.desc') }}</p>
              <div class="field">
                <label>{{ t('gen.enable') }}</label>
                <label class="toggle-switch">
                  <input type="checkbox" v-model="cavemanConfig.enabled" @change="saveCavemanConfig" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div v-if="cavemanConfig.enabled" style="margin-top:10px">
                <div class="field">
                  <label>{{ t('gen.caveman.level') }}</label>
                  <select v-model="cavemanConfig.level" @change="saveCavemanConfig" class="field-input" style="width:140px">
                    <option value="lite">Lite</option>
                    <option value="full">Full</option>
                    <option value="ultra">Ultra</option>
                    <option value="wenyan">Wenyan</option>
                  </select>
                </div>
                <div v-if="cavemanConfig.cavemanCurrent" class="field">
                  <label>{{ t('gen.caveman.currentVersion') }}</label>
                  <span class="field-value">{{ cavemanConfig.cavemanCurrent }}</span>
                </div>
                <div v-if="cavemanConfig.releases.length" class="field">
                  <label>{{ t('gen.caveman.selectVersion') }}</label>
                  <div class="field-right">
                    <select v-model="cavemanUpdateVersion" class="field-input" style="width:160px">
                      <option v-for="rel in cavemanConfig.releases" :key="rel.tag" :value="rel.tag">{{ rel.tag }}</option>
                    </select>
                    <button class="btn-primary btn-sm" :disabled="cavemanUpdating || cavemanUpdateVersion === cavemanConfig.cavemanCurrent" @click="updateCaveman">
                      {{ cavemanUpdating ? t('common.loading') + '...' : t('gen.caveman.updateBtn') }}
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="cavemanConfig.cavemanUpdate" class="hint-warn" style="margin-top:8px">
                {{ t('gen.caveman.updateHint', {current: cavemanConfig.cavemanUpdate.current, latest: cavemanConfig.cavemanUpdate.latest}) }}
              </div>
              <div v-if="cavemanUpdateOk" class="save-ok" style="margin-top:6px">{{ t('gen.caveman.updateOk') }}</div>
              <div v-if="cavemanUpdateError" class="save-err" style="margin-top:6px">{{ t('gen.caveman.updateFail', {msg: cavemanUpdateError}) }}</div>
            </section>

            <!-- RTK -->
            <section class="section-block oss-card">
              <h2 class="section-title">RTK</h2>
              <p class="oss-repo">项目地址：<a class="repo-link" href="https://github.com/rtk-ai/rtk" target="_blank">github.com/rtk-ai/rtk</a></p>
              <p class="section-desc">{{ t('gen.rtk.desc') }}</p>
              <div class="field">
                <label>{{ t('gen.enable') }}</label>
                <label class="toggle-switch">
                  <input type="checkbox" v-model="rtkConfig.enabled" @change="saveRtkConfig" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div v-if="!rtkConfig.rtkAvailable" class="hint-warn">{{ t('gen.rtk.unavailable') }}</div>
              <div v-if="rtkConfig.rtkAvailable && rtkConfig.rtkCurrent" style="margin-top:10px">
                <div class="field">
                  <label>{{ t('gen.rtk.currentVersion') }}</label>
                  <span class="field-value">{{ rtkConfig.rtkCurrent }}</span>
                </div>
                <div v-if="rtkConfig.releases.length" class="field">
                  <label>{{ t('gen.rtk.selectVersion') }}</label>
                  <div class="field-right">
                    <select v-model="rtkUpdateVersion" class="field-input" style="width:160px">
                      <option v-for="rel in rtkConfig.releases" :key="rel.tag" :value="rel.tag">{{ rel.tag }}</option>
                    </select>
                    <button class="btn-primary btn-sm" :disabled="rtkUpdating || rtkUpdateVersion === rtkConfig.rtkCurrent" @click="updateRtk">
                      {{ rtkUpdating ? t('common.loading') + '...' : t('gen.rtk.updateBtn') }}
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="rtkConfig.rtkUpdate" class="hint-warn" style="margin-top:8px">
                {{ t('gen.rtk.updateHint', {current: rtkConfig.rtkUpdate.current, latest: rtkConfig.rtkUpdate.latest}) }}
              </div>
              <div v-if="rtkUpdateOk" class="save-ok" style="margin-top:6px">{{ t('gen.rtk.updateOk') }}</div>
              <div v-if="rtkUpdateError" class="save-err" style="margin-top:6px">{{ t('gen.rtk.updateFail', {msg: rtkUpdateError}) }}</div>
            </section>
          </div>
        </template>

        <!-- ──── MCP Tab: 服务器 + 插件统一管理 ──── -->
        <template v-if="activeTab === 'mcp'">
          <div class="list-panel">
            <!-- ── 统一标题栏 ── -->
            <div class="module-header">
              <div class="module-header-left">
                <span style="font-family:var(--font-heading);font-size:17px;font-weight:600">{{ t('tab.mcp') }}</span>
                <span class="cat-badge device">{{ t('common.builtin') }} {{ mcpSourceCounts.builtin }}</span>
                <span class="cat-badge custom-badge">{{ t('common.custom') }} {{ mcpSourceCounts.custom }}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
                <button class="btn-add" @click="openNewMcpServer">+</button>
              <button class="refresh-btn" :class="{ spinning: mcpLoading || mcpServersLoading }" @click="refreshMcp" :disabled="mcpLoading || mcpServersLoading"
                      :title="t('common.refresh')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
            </div>

            <!-- ── 来源筛选 + 搜索 ── -->
            <div class="cat-row" style="flex-wrap:wrap;gap:8px;margin-top:20px">
              <div class="cat-tags">
                <button class="cat-tag" :class="{ active: !activeMcpSource }" @click="activeMcpSource = ''">{{ t('common.all') }}</button>
                <button class="cat-tag" :class="{ active: activeMcpSource === 'builtin' }" @click="activeMcpSource = 'builtin'">{{ t('common.builtin') }}</button>
                <button class="cat-tag" :class="{ active: activeMcpSource === 'custom' }" @click="activeMcpSource = 'custom'">{{ t('common.custom') }}</button>
              </div>
              <input v-model="mcpSearch" :placeholder="t('cmd.searchPlaceholder')" class="field-input"
                     style="max-width:180px;margin-left:auto"/>
            </div>

            <!-- ── 错误/加载/空状态 ── -->
            <div v-if="moduleLoadFailed('mcp') || moduleLoadFailed('mcpServers')" class="error-banner" style="margin-top:8px">
              <span>{{ t('common.loadFailed') }}</span>
              <button class="retry-btn" @click="refreshMcp" :disabled="(retryCount['mcp'] || 0) >= MAX_RETRIES && (retryCount['mcpServers'] || 0) >= MAX_RETRIES">
                {{ (retryCount['mcp'] || 0) >= MAX_RETRIES && (retryCount['mcpServers'] || 0) >= MAX_RETRIES ? t('common.retryMaxed') : t('common.retry') }}
              </button>
            </div>
            <div v-if="(mcpLoading || mcpServersLoading) && filteredMcpItems.length === 0" class="loading-state" style="margin-top:12px">{{ t('common.loading') }}</div>
            <div v-else-if="mcpAll.length === 0 && !mcpLoading && !mcpServersLoading" class="empty-state-sm" style="margin-top:12px">{{ t('mcp.empty') }}</div>

            <!-- ── 统一 MCP 列表 ── -->
            <div v-for="item in filteredMcpItems" :key="item._kind + ':' + item.name" class="list-item" :style="item._kind === 'server' ? {cursor:'pointer'} : {}" @click="item._kind === 'server' && editMcpServer(item)">
              <div class="item-icon" v-html="item._kind === 'server'
                ? ri('<circle cx=&quot;12&quot; cy=&quot;12&quot; r=&quot;10&quot;/><line x1=&quot;2&quot; y1=&quot;12&quot; x2=&quot;22&quot; y2=&quot;12&quot;/><path d=&quot;M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z&quot;/>')
                : ri('<polyline points=&quot;16 18 22 12 16 6&quot;/><polyline points=&quot;8 6 2 12 8 18&quot;/>')"></div>
              <div class="item-info">
                <div class="item-name">
                  {{ item.name }}
                  <span class="cat-badge" :class="{ device: item._kind === 'builtin' }">{{ item._kind === 'builtin' ? t('common.builtin') : item._kind === 'plugin' ? t('common.custom') : 'server' }}</span>
                  <span v-if="item._kind === 'server'" class="cat-badge" :class="{ transport: true, stdio: item.transport === 'stdio', sse: item.transport === 'sse', http: item.transport === 'http' }">{{ item.transport }}</span>
                  <span v-if="item.command" class="cat-badge" style="background:var(--bg-deep);color:var(--text-muted);font-size:11px;font-family:var(--font-mono)">{{ item.command }}</span>
                  <span v-if="!item.enabled" class="cat-badge" style="background:rgba(233,69,96,0.08);color:var(--error)">已禁用</span>
                </div>
                <div class="item-desc">{{ item._kind === 'server' ? (item.url || '') : (item.version + ' · ' + item.scope) }}</div>
              </div>
              <label class="toggle-switch" @click.stop="item._kind === 'server' ? toggleMcpServer(item) : toggleMcpPlugin(item)" style="margin-right:10px">
                <input type="checkbox" :checked="item.enabled" @click.stop @change="item._kind === 'server' ? toggleMcpServer(item) : toggleMcpPlugin(item)"/>
                <span class="toggle-slider"></span>
              </label>
              <button v-if="item._kind === 'server'" class="btn-danger-sm" @click.stop="pendingDeleteMcp = item.name" :title="t('common.delete')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>
            </div>

            <!-- 自定义 MCP 配置指引 -->
            <div class="mcp-note" style="margin-top:24px">
              <h3>{{ t('mcp.customTitle') }}</h3>
              <p>{{ t('mcp.customDesc') }}</p>
              <pre class="mcp-code-sample">{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "my-mcp-server"
    }
  }
}</pre>
              <p class="mcp-tip">{{ t('mcp.tip') }}</p>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- ── MCP 服务器新增/编辑弹窗 ── -->
    <div v-if="showMcpForm" class="qr-overlay" @click.self="showMcpForm = false">
      <div class="qr-modal glass" style="max-width:540px;max-height:85vh;overflow-y:auto">
        <button class="qr-close" @click="showMcpForm = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ editingMcpServer ? t('mcp.editServer') : t('mcp.newServer') }}</h2>
        <div class="mcp-form">
          <div class="field">
            <label>{{ t('mcp.serverName') }}</label>
            <input v-model="mcpForm.name" class="field-input mono" :placeholder="t('mcp.namePlaceholder')" :disabled="!!editingMcpServer"/>
          </div>
          <div class="field">
            <label>Transport</label>
            <select v-model="mcpForm.transport" class="field-input">
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="http">http</option>
            </select>
          </div>
          <template v-if="mcpForm.transport === 'stdio'">
            <div class="field">
              <label>Command</label>
              <input v-model="mcpForm.command" class="field-input mono" placeholder="npx / uvx / python"/>
            </div>
            <div class="field">
              <label>Args <span class="field-hint">一行一个参数</span></label>
              <textarea v-model="mcpForm.args" class="code-editor" style="height:46px" placeholder="-a&#10;--verbose" spellcheck="false"></textarea>
            </div>
            <div class="field">
              <label>Env <span class="field-hint">KEY=VALUE 格式，一行一个</span></label>
              <textarea v-model="mcpForm.envText" class="code-editor" style="height:46px" placeholder="API_KEY=sk-xxx&#10;DEBUG=1" spellcheck="false"></textarea>
            </div>
          </template>
          <template v-else>
            <div class="field">
              <label>URL</label>
              <input v-model="mcpForm.url" class="field-input mono" placeholder="http://localhost:8080/sse"/>
            </div>
            <div class="field">
              <label>Headers <span class="field-hint">JSON 格式</span></label>
              <textarea v-model="mcpForm.headersText" class="code-editor" style="height:60px" placeholder='{"Authorization": "Bearer xxx"}' spellcheck="false"></textarea>
            </div>
          </template>
          <div v-if="mcpFormError" class="save-err" style="margin-bottom:8px">{{ mcpFormError }}</div>
          <div class="qr-actions" style="margin-top:20px">
            <button class="btn-text" @click="showMcpForm = false">{{ t('common.cancel') }}</button>
            <button class="btn-primary" :disabled="mcpFormSaving" @click="saveMcpServer">
              {{ mcpFormSaving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Scheduler 任务新增/编辑弹窗 ── -->
    <div v-if="showSchedForm" class="qr-overlay" @click.self="showSchedForm = false">
      <div class="qr-modal glass" style="max-width:540px;max-height:85vh;overflow-y:auto">
        <button class="qr-close" @click="showSchedForm = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ editingSchedId ? '编辑' : '新增' }}定时任务</h2>
        <div class="mcp-form">
          <div class="field"><label>执行频率</label>
            <select v-model="schedFreq" class="field-input" style="width:140px">
              <option value="daily">每天</option>
              <option value="weekday">工作日</option>
              <option value="weekly">每周指定</option>
              <option value="monthly">每月指定</option>
              <option value="custom">自定义 Cron</option>
            </select>
          </div>
          <div class="field"><label>执行时间</label>
            <input type="time" v-model="schedTime" class="field-input" style="width:140px"/>
          </div>
          <div class="field" v-if="schedFreq === 'weekly'"><label>选择周几</label>
            <div class="weekday-row">
              <label v-for="(lb, idx) in weekdayLabels" :key="idx" class="chip-check" :class="{checked: schedWeekdays.includes(idx)}">
                <input type="checkbox" :value="idx" v-model="schedWeekdays" style="display:none"/>
                {{ lb }}
              </label>
            </div>
          </div>
          <div class="field" v-if="schedFreq === 'monthly'"><label>几号</label>
            <select v-model.number="schedMonthDay" class="field-input" style="width:80px">
              <option v-for="d in 28" :key="d" :value="d">{{ d }}</option>
            </select>
            <span class="field-hint">每月 1-28 号（避免 29/30/31 因月份跳过）</span>
          </div>
          <div class="field" v-if="schedFreq === 'custom'"><label>Cron 表达式</label>
            <input v-model="schedForm.cron" class="field-input mono" placeholder="0 9 * * *"/>
            <span class="field-hint">分 时 日 月 周</span>
          </div>
          <div class="field"><label>预览</label>
            <span class="field-value mono">{{ freqToCron() }}</span>
          </div>
          <div class="field"><label>工作目录</label>
            <input v-model="schedForm.workDir" class="field-input mono" placeholder="D:/projects/my-project"/>
          </div>
          <div class="field"><label>Prompt</label>
            <textarea v-model="schedForm.prompt" class="code-editor" style="height:100px" spellcheck="false"></textarea>
          </div>
          <div class="field"><label>模型 (可选)</label>
            <input v-model="schedForm.model" class="field-input mono" placeholder="deepseek-v4-pro"/>
          </div>
<div class="qr-actions">
            <button class="btn-text" @click="showSchedForm = false">{{ t('common.cancel') }}</button>
            <button class="btn-primary" :disabled="schedSaving" @click="saveSched">{{ t('common.save') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── MCP 服务器删除确认弹窗 ── -->
    <div v-if="pendingDeleteMcp" class="qr-overlay" @click.self="pendingDeleteMcp = null">
      <div class="qr-modal glass">
        <button class="qr-close" @click="pendingDeleteMcp = null">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ t('mcp.deleteConfirm') }}</h2>
        <p class="qr-note">{{ t('mcp.deleteHint', {name: pendingDeleteMcp}) }}</p>
        <div class="qr-actions">
          <button class="btn-text" @click="pendingDeleteMcp = null">{{ t('common.cancel') }}</button>
          <button class="btn-primary danger" @click="confirmDeleteMcp">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- ── IM 绑定弹窗: 微信QR码(生成+轮询+状态) / 飞书钉钉凭证表单 ── -->
    <div v-if="showBindModal" class="qr-overlay" @click.self="closeBindModal">
      <div class="qr-modal glass">
        <button class="qr-close" @click="closeBindModal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">
          <template v-if="showBindModal === 'wechat'">{{ t('qr.wechatTitle') }}</template>
          <template v-else-if="showBindModal === 'feishu'">{{ t('qr.feishuTitle') }}</template>
          <template v-else>{{ t('qr.dingTitle') }}</template>
        </h2>

        <!-- 微信: QR 码 -->
        <template v-if="showBindModal === 'wechat'">
          <div class="qr-img-box">
            <div v-if="!qrImgUrl" class="qr-loading">
              <span class="spinner-qr"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                            stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"
                                                                                            stroke-opacity="0.25"/><path
                  d="M12 2a10 10 0 0 1 10 10"/></svg></span>
              <p>{{ t('qr.generating') }}</p>
            </div>
            <img v-else :src="qrImgUrl" alt="QR Code" class="qr-img"/>
          </div>
          <div class="qr-status" :class="qrStatus">
            <span v-if="qrStatus === 'wait'">{{ t('qr.wait') }}</span>
            <span v-else-if="qrStatus === 'scanned'">{{ t('qr.scanned') }}</span>
            <span v-else-if="qrStatus === 'confirmed'">{{ t('qr.confirmed') }}</span>
            <span v-else>{{ t('qr.expired') }}</span>
          </div>
          <button class="qr-refresh" v-if="qrStatus === 'expired'" @click="startBind('wechat')">{{
              t('qr.regen')
            }}
          </button>
        </template>

        <!-- 飞书 / 钉钉: 凭证配置表单 -->
        <template v-else>
          <div class="bind-form">
            <div class="bind-platform-info">
              <div class="bind-method-badge">
                <template v-if="showBindModal === 'feishu'">WebSocket 长连接 (Lark WS SDK)</template>
                <template v-else>Stream 模式 (WebSocket)</template>
              </div>
              <p class="bind-note">无需公网域名，填入开发平台获取的凭证即可</p>
            </div>
            <div v-for="f in (imPlatforms.find(p => p.id === showBindModal)?.configFields || [])" :key="f.key"
                 class="app-config-field">
              <label>{{ f.label }}</label>
              <input :type="f.type === 'password' ? 'password' : 'text'" v-model="bindForm[f.key]"
                     :placeholder="f.placeholder" class="field-input mono"/>
            </div>
            <button class="btn-primary" :disabled="bindSaving || bindSaved" @click="saveBindConfig(showBindModal)">
              <template v-if="bindSaving">保存中...</template>
              <template v-else-if="bindSaved">已保存</template>
              <template v-else>保存凭证</template>
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- ── 解绑确认弹窗: 确认信息 + 取消/确认按钮(DELETE /api/config/adapters/:id) ── -->
    <div v-if="unbindTarget" class="qr-overlay" @click.self="cancelUnbind">
      <div class="qr-modal glass">
        <button class="qr-close" @click="cancelUnbind">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ t('im.unbind') }} {{ unbindTarget.icon }} {{ unbindTarget.name }}</h2>
        <p class="qr-note">{{ t('im.unbindConfirmHint') }}</p>
        <div class="qr-actions">
          <button class="btn-text" :disabled="!!unbindId" @click="cancelUnbind">{{ t('common.cancel') }}</button>
          <button class="btn-primary danger" :disabled="!!unbindId" @click="doUnbind">
            <template v-if="unbindId">{{ t('im.unbinding') }}</template>
            <template v-else>{{ t('im.unbind') }}</template>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Rules 新增弹窗 ── -->
    <div v-if="showNewRule" class="qr-overlay" @click.self="showNewRule = false">
      <div class="qr-modal glass" style="max-width:480px">
        <button class="qr-close" @click="showNewRule = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 class="qr-title">{{ t('common.new') }} Rule</h2>
        <div class="field"><label>{{ t('rules.filenamePlaceholder') }}</label>
        <input v-model="newRuleForm.filename" class="field-input" placeholder="my-rule" @keydown.enter="createRule"/></div>
        <div class="field" style="margin-top:14px"><label>{{ t('rules.pathsPlaceholder') }}</label>
        <input v-model="newRuleForm.paths" class="field-input mono" placeholder="**/*.cs"/></div>
        <div class="qr-actions" style="margin-top:20px">
          <button class="btn-text" @click="showNewRule = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="ruleSaving || !newRuleForm.filename.trim()" @click="createRule">{{ t('common.create') }}</button>
        </div>
      </div>
    </div>

    <!-- ── Hooks 新增弹窗 ── -->
    <div v-if="showNewHook" class="qr-overlay" @click.self="showNewHook = false">
      <div class="qr-modal glass" style="max-width:480px">
        <button class="qr-close" @click="showNewHook = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 class="qr-title">{{ t('common.new') }} Hook</h2>
        <div class="field"><label>Filename</label>
        <input v-model="newHookForm.filename" class="field-input mono" placeholder="hook-name" @keydown.enter="createHook"/></div>
        <div class="field" style="margin-top:14px"><label>Event</label>
        <select v-model="newHookForm.eventType" class="field-input">
          <option>PostToolUse</option><option>PreToolUse</option><option>Stop</option><option>Notification</option>
        </select></div>
        <div class="qr-actions" style="margin-top:20px">
          <button class="btn-text" @click="showNewHook = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="hookSaving || !newHookForm.filename.trim()" @click="createHook">{{ t('common.create') }}</button>
        </div>
      </div>
    </div>

    <!-- ── Agents 新增弹窗 ── -->
    <div v-if="showNewAgent" class="qr-overlay" @click.self="showNewAgent = false">
      <div class="qr-modal glass" style="max-width:500px;max-height:85vh;overflow-y:auto">
        <button class="qr-close" @click="showNewAgent = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 class="qr-title">{{ t('common.new') }} Agent</h2>
        <div class="field"><label>Name</label>
        <input v-model="newAgentForm.name" class="field-input mono" placeholder="my-agent" @keydown.enter="createAgent"/></div>
        <div class="field" style="margin-top:14px"><label>{{ t('agents.type') }}</label>
        <input v-model="newAgentForm.type" class="field-input" placeholder="general-purpose"/></div>
        <div class="field" style="margin-top:14px"><label>{{ t('agents.desc') }}</label>
        <input v-model="newAgentForm.description" class="field-input" placeholder="描述"/></div>
        <div class="field" style="margin-top:14px"><label>Tools</label>
        <input v-model="newAgentForm.tools" class="field-input mono" placeholder="Read,Write,Bash"/></div>
        <div class="field" style="margin-top:14px"><label>Model</label>
        <input v-model="newAgentForm.model" class="field-input mono" placeholder="inherit"/></div>
        <div class="field" style="margin-top:14px"><label>Language</label>
        <input v-model="newAgentForm.language" class="field-input" placeholder="中文"/></div>
        <div class="qr-actions" style="margin-top:20px">
          <button class="btn-text" @click="showNewAgent = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="agentSaving || !newAgentForm.name.trim()" @click="createAgent">{{ t('common.create') }}</button>
        </div>
      </div>
    </div>

    <!-- ── Skills 新增弹窗 ── -->
    <div v-if="showNewSkill" class="qr-overlay" @click.self="showNewSkill = false">
      <div class="qr-modal glass" style="max-width:480px">
        <button class="qr-close" @click="showNewSkill = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 class="qr-title">{{ t('common.new') }} Skill</h2>
        <div class="field"><label>Name (kebab-case)</label>
        <input v-model="newSkillForm.name" class="field-input mono" placeholder="my-skill" @keydown.enter="createSkill"/></div>
        <div class="field" style="margin-top:14px"><label>{{ t('skills.desc') }}</label>
        <input v-model="newSkillForm.description" class="field-input" placeholder="描述"/></div>
        <div class="qr-actions" style="margin-top:20px">
          <button class="btn-text" @click="showNewSkill = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" :disabled="skillSaving || !newSkillForm.name.trim()" @click="createSkill">{{ t('common.create') }}</button>
        </div>
      </div>
    </div>

    <!-- ── 通用确认弹窗 (替代原生 confirm) ── -->
    <div v-if="appConfirm" class="qr-overlay" @click.self="appConfirm = null">
      <div class="qr-modal glass">
        <button class="qr-close" @click="appConfirm = null">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ t('common.confirm') }}</h2>
        <p class="qr-note">{{ appConfirm.message }}</p>
        <div class="qr-actions">
          <button class="btn-text" @click="appConfirm = null">{{ t('common.cancel') }}</button>
          <button class="btn-primary danger" @click="appConfirm.onOk">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- ── 通用提示弹窗 (替代原生 alert) ── -->
    <div v-if="appAlert" class="qr-overlay" @click.self="appAlert = null">
      <div class="qr-modal glass">
        <button class="qr-close" @click="appAlert = null">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="qr-title">{{ t('common.tip') }}</h2>
        <p class="qr-note">{{ appAlert.message }}</p>
        <div class="qr-actions">
          <button class="btn-primary" @click="appAlert = null">{{ t('common.ok') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════ */
/* 整体布局: flex column 全高，bg-deep 深色背景 */
/* ═══════════ Layout ═══════════ */
.settings-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-body);
}

/* Header */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-center {
  text-align: center;
}

.header-center h1 {
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.3px;
}

.header-sub {
  font-size: 14px;
  color: var(--text-muted);
}

.header-right {
  width: 120px;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 7px 14px;
  border-radius: var(--radius-btn);
  font-size: 15px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-raised);
}

/* Body */
.settings-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Tab Nav */
.tab-nav {
  width: 234px;
  background: var(--bg-base);
  border-right: 1px solid var(--border);
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  overflow-y: auto;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: var(--radius-btn);
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  font-family: var(--font-body);
}

.tab-btn:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: rgba(233, 69, 96, 0.2);
  box-shadow: inset 3px 0 0 var(--accent);
}

.tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  flex-shrink: 0;
}

.tab-icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.tab-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tab-label {
  font-size: 16px;
  font-weight: 500;
}

.tab-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 1px;
}

/* Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Loading / Empty */
.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 17px;
}

.empty-state-sm {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
  font-size: 16px;
}

/* Section blocks */
.section-block {
  margin-bottom: 28px;
}

.section-title {
  font-family: var(--font-heading);
  font-size: 19px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

/* Provider cards */
.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-base);
  border: 2px solid var(--border);
  border-radius: var(--radius-card);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.provider-card:hover {
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.provider-card.active {
  border-color: var(--accent);
  background: rgba(233, 69, 96, 0.05);
}

.provider-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-heading);
  font-size: 21px;
  font-weight: 700;
  color: var(--accent);
  flex-shrink: 0;
}

.provider-card.active .provider-icon {
  background: var(--accent);
  color: #fff;
}

.provider-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.provider-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.provider-models-count {
  font-size: 13px;
  color: var(--text-muted);
}

.provider-check {
  color: var(--accent);
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

/* API config */
.api-config-card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-with-link {
  display: flex;
  gap: 6px;
  align-items: center;
}

.input-with-link .field-input {
  flex: 1;
}

.inline-link {
  color: var(--text-muted);
  padding: 6px;
  border-radius: var(--radius-btn);
  transition: all var(--transition-fast);
  display: flex;
}

.inline-link:hover {
  color: var(--accent-blue);
  background: var(--bg-raised);
}

.api-key-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.api-key-row .field-input {
  flex: 1;
}

.secret-dots {
  letter-spacing: 4px;
  font-size: 10px !important;
  color: var(--text-muted);
  cursor: default;
}

.key-toggle-btn {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.key-toggle-btn:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
  background: var(--bg-raised);
}

.test-conn-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--border);
  background: var(--bg-deep);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.test-conn-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.test-conn-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-conn-btn.ok {
  border-color: #22c55e;
  color: #22c55e;
}

.test-conn-btn.fail {
  border-color: #ef4444;
  color: #ef4444;
}

@keyframes test-spin {
  to {
    transform: rotate(360deg);
  }
}

.test-spinner {
  animation: test-spin 0.8s linear infinite;
}

.test-msg {
  font-size: 12px;
  margin-left: 4px;
}

.test-msg-ok {
  color: #22c55e;
}

.test-msg-fail {
  color: #ef4444;
}

.provider-links {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 4px;
}

.ext-link {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  color: var(--accent-blue);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.ext-link svg {
  width: 14px;
  height: 14px;
}

.ext-link:hover {
  color: var(--text-primary);
}

.pricing-tag {
  font-size: 13px;
  color: var(--accent-gold);
  background: rgba(212, 168, 83, 0.08);
  padding: 3px 10px;
  border-radius: 10px;
  margin-left: auto;
}

/* Model cards */
.model-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.model-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  background: var(--bg-base);
  border: 2px solid var(--border);
  border-radius: var(--radius-card);
  cursor: pointer;
  transition: all var(--transition-normal);
  min-width: 160px;
}

.model-card:hover {
  border-color: var(--border-hover);
  transform: translateY(-1px);
}

.model-card.active {
  border-color: var(--accent);
  background: rgba(233, 69, 96, 0.05);
}

.model-id {
  font-size: 15px;
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--text-primary);
}

.model-name {
  font-size: 13px;
  color: var(--text-muted);
}

.model-ctx {
  font-size: 12px;
  color: var(--accent-gold);
  font-weight: 500;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

/* Settings grid */
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.row-inputs {
  display: flex;
  gap: 8px;
}

.row-inputs .field-input {
  flex: 1;
}

.field-row {
  flex-direction: row !important;
  justify-content: space-between;
  align-items: center;
}

.field-hint {
  font-size: 12px;
  color: var(--text-muted);
  display: block;
  margin-top: 2px;
  font-weight: 400;
}

.hint-warn {
  font-size: 13px;
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-gold) 25%, transparent);
  border-radius: 8px;
  padding: 10px 14px;
  margin-top: 12px;
  line-height: 1.5;
}

.field-value {
  font-size: 14px;
  color: var(--text);
  padding: 8px 0;
  font-family: var(--mono, monospace);
}

.btn-sm {
  padding: 4px 14px;
  font-size: 13px;
  border-radius: 6px;
}

.field-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Fields */
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field:has(.toggle-switch) {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.field label {
  font-size: 14px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-input {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 9px 12px;
  border-radius: var(--radius-input);
  font-size: 15px;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-fast);
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input:-webkit-autofill,
.field-input:-webkit-autofill:hover,
.field-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--text-primary);
  -webkit-box-shadow: 0 0 0px 1000px var(--bg-deep) inset;
  caret-color: var(--text-primary);
  transition: background-color 5000s ease-in-out 0s;
}

.field-input.mono {
  font-family: var(--font-mono);
  font-size: 14px;
}

.secret-field {
  position: relative;
}

.secret-field .field-input {
  color: var(--text-muted);
  cursor: default;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 22px;
  transition: all var(--transition-fast);
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  top: 3px;
  left: 3px;
  transition: all var(--transition-fast);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--accent);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
}

/* Chip checkbox (Cron 周几选择器，匹配项目 cat-badge 风格) */
.chip-check {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 32px; height: 28px; padding: 0 8px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--border);
  font-size: 12px; font-weight: 500; color: var(--text-muted);
  cursor: pointer; user-select: none;
  transition: all var(--transition-fast);
}
.chip-check.checked {
  background: rgba(233, 69, 96, 0.12); border-color: var(--accent);
  color: var(--accent); font-weight: 600;
}
.weekday-row {
  display: flex; flex-wrap: wrap; gap: 6px;
}

/* time input dark-mode 适配 */
input[type="time"].field-input {
  color-scheme: dark;
}
input[type="time"].field-input::-webkit-calendar-picker-indicator {
  filter: invert(0.7);
}

/* Action bar */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.save-ok {
  font-size: 14px;
  color: var(--success);
  font-weight: 500;
}

.save-err {
  font-size: 14px;
  color: var(--error);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 9px 22px;
  border-radius: var(--radius-btn);
  font-size: 16px;
  font-family: var(--font-body);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary:hover:not(:disabled) {
  background: #d43d54;
  box-shadow: var(--shadow-glow);
}

.btn-primary:disabled {
  opacity: 0.3;
  cursor: default;
}

.btn-secondary {
  background: transparent;
  color: var(--accent-blue);
  border: 1px solid var(--border);
  padding: 8px 18px;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-raised);
  border-color: var(--accent-blue);
}
.btn-secondary:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-text {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  font-family: var(--font-body);
  padding: 4px 8px;
  border-radius: 4px;
}

.btn-text:hover {
  color: var(--text-primary);
  background: var(--bg-raised);
}

/* List panel */
.list-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  border: 1px solid transparent;
  transition: all var(--transition-fast);
  cursor: pointer;
}

.list-item:hover {
  background: var(--bg-base);
  border-color: var(--border);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  flex-shrink: 0;
  color: var(--accent-gold);
}

.item-icon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 17px;
  font-weight: 500;
  color: var(--text-primary);
}

.item-desc {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  flex-shrink: 0;
}

.skill-allowed {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  opacity: 0.6;
}

.item-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0.4;
  width: 16px;
  height: 16px;
}

.item-right-tag {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  width: 32px;
  text-align: center;
}

/* Code Editor */
.editor-full {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.editor-header h3 {
  font-family: var(--font-heading);
  font-size: 19px;
  font-weight: 600;
}

.code-editor {
  flex: 1;
  min-height: 400px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 15px;
  line-height: 1.6;
  padding: 16px;
  resize: vertical;
  outline: none;
  tab-size: 2;
}

.code-editor:focus {
  border-color: var(--accent);
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
}

/* Hooks */
.hook-group {
  margin-bottom: 20px;
}

.hook-event-title {
  font-family: var(--font-heading);
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-gold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}

.hook-entry {
  margin-bottom: 8px;
}

.hook-header {
  display: flex;
  justify-content: space-between;
  padding: 4px 14px;
  font-size: 14px;
  color: var(--text-muted);
}

.hook-matcher {
  font-family: var(--font-mono);
}

.hook-timeout {
  opacity: 0.6;
}

.hook-file {
  margin-left: 8px;
}

/* Memory */
.memory-summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px 16px;
  font-size: 14px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}

.memory-project-group {
  margin-bottom: 4px;
}

.memory-proj-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.memory-proj-header:hover {
  background: var(--bg-raised);
  border-color: var(--border);
}

.proj-chevron {
  color: var(--text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.proj-chevron.open {
  transform: rotate(90deg);
}

.proj-name {
  font-size: 17px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--font-heading);
}

.proj-path {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proj-count {
  font-size: 13px;
  color: var(--accent-gold);
  font-weight: 500;
  flex-shrink: 0;
}

.proj-chevron {
  width: 14px;
  height: 14px;
}

.memory-files {
  margin-left: 22px;
  border-left: 2px solid var(--border);
  padding-left: 12px;
  margin-bottom: 16px;
}

.memory-create {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 0;
}

.memory-create .field-input {
  flex: 1;
  max-width: 300px;
}

.editor-sub {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
  font-family: var(--font-mono);
}

.empty-state-lg {
  text-align: center;
  padding: 64px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto;
  color: var(--text-muted);
  opacity: 0.3;
}

.empty-icon :deep(svg) {
  width: 32px;
  height: 32px;
  display: block;
}

.empty-state-lg p {
  font-size: 16px;
  color: var(--text-secondary);
  font-weight: 500;
}

.empty-state-lg span {
  font-size: 13px;
  color: var(--text-muted);
  max-width: 420px;
}

.empty-hint-sm {
  padding: 12px 0;
  font-size: 14px;
  color: var(--text-muted);
}

.btn-danger-sm {
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
}

.btn-danger-sm svg {
  width: 16px;
  height: 16px;
}

.btn-danger-sm:hover {
  color: var(--error);
  border-color: rgba(248, 81, 73, 0.3);
  background: rgba(248, 81, 73, 0.08);
}

.btn-run-sm {
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex; align-items: center;
}
.btn-run-sm:hover {
  color: var(--accent-blue);
  border-color: rgba(107, 174, 224, 0.3);
  background: rgba(107, 174, 224, 0.08);
}

/* MCP */
.plugin-status {
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 10px;
  background: rgba(63, 185, 80, 0.08);
  color: var(--success);
  font-weight: 500;
}

.plugin-status.active {
  background: rgba(63, 185, 80, 0.1);
  color: var(--success);
}

/* Category tags */
.cat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.cat-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cat-tag {
  background: var(--bg-base);
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 14px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cat-tag:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.cat-tag.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.cat-label {
  font-size: 14px;
  color: var(--text-muted);
}

.cat-badge {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(107, 174, 224, 0.1);
  color: var(--accent-blue);
  margin-left: 8px;
  vertical-align: middle;
}

.cat-badge.device {
  background: rgba(63, 185, 80, 0.1);
  color: var(--success);
}

.badge-type {
  background: rgba(233, 69, 96, 0.08);
  color: var(--accent);
}

.badge-lang {
  background: rgba(107, 174, 224, 0.08);
  color: var(--accent-blue);
}

/* Form row (并行字段) */
.form-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

/* New item button */
.btn-add {
  background: none;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  padding: 7px 16px;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.btn-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(233, 69, 96, 0.05);
}

/* Create form */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: var(--radius-card);
}

.create-form .field-input {
  flex: 1;
  max-width: 100%;
}

.form-row .field-input {
  max-width: 100%;
}

.create-form .field-input.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}

/* IM cards */
.im-card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  margin-bottom: 16px;
  transition: all var(--transition-normal);
}

.im-card:hover {
  border-color: var(--border-hover);
}

.im-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.im-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.im-icon {
  display: flex;
  align-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.im-icon :deep(svg) {
  width: 24px;
  height: 24px;
  display: block;
}

.im-icon :deep(svg[width="28"]) {
  width: 24px;
  height: 24px;
}

.im-name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-heading);
  display: block;
}

.im-id {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.im-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
}

.im-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.im-status.active {
  background: rgba(63, 185, 80, 0.1);
  color: var(--success);
}

.im-status.active .im-status-dot {
  background: var(--success);
  box-shadow: 0 0 6px rgba(63, 185, 80, 0.4);
}

.im-status.configured {
  background: rgba(91, 155, 213, 0.1);
  color: var(--accent-blue);
}

.im-status.configured .im-status-dot {
  background: var(--accent-blue);
}

.im-status.inactive {
  background: rgba(86, 91, 110, 0.1);
  color: var(--text-muted);
}

.im-status.inactive .im-status-dot {
  background: var(--text-muted);
}

.im-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.im-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.im-label {
  font-size: 13px;
  color: var(--text-muted);
}

.im-value {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.im-guide {
  background: var(--bg-deep);
  border-radius: var(--radius-input);
  padding: 12px 14px;
  margin-bottom: 14px;
}

.im-guide-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-gold);
  margin-bottom: 8px;
}

.im-guide-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.im-step {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
}

.im-card-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}


.btn-bind {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 9px 18px;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.btn-bind svg {
  width: 16px;
  height: 16px;
}

.btn-bind:hover {
  background: #d43d54;
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.btn-bind.bound {
  background: rgba(63, 185, 80, 0.12);
  color: var(--success);
  border: 1px solid rgba(63, 185, 80, 0.25);
}

.btn-bind.bound:hover {
  background: rgba(63, 185, 80, 0.18);
  box-shadow: none;
}

.btn-unbind {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-unbind:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}

.btn-unbind:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* QR overlay & modal */
.qr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(4px);
}

.qr-modal {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-modal);
  padding: 32px 36px;
  text-align: center;
  max-width: 400px;
  width: 90vw;
  position: relative;
}

.qr-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-btn);
  transition: all var(--transition-fast);
}

.qr-close:hover {
  color: var(--text-primary);
  background: var(--bg-raised);
}

.qr-title {
  font-family: var(--font-heading);
  font-size: 18px;
  margin-bottom: 20px;
  color: var(--text-primary);
}

.qr-img-box {
  width: 280px;
  height: 280px;
  margin: 0 auto 16px;
  background: #fff;
  border-radius: var(--radius-card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-img {
  width: 260px;
  height: 260px;
}

.qr-loading {
  text-align: center;
  color: var(--text-muted);
}

.qr-loading p {
  margin-top: 8px;
  font-size: 13px;
}

.qr-status {
  font-size: 14px;
  font-weight: 500;
  padding: 6px 0;
}

.qr-status.wait {
  color: var(--text-secondary);
}

.qr-status.scanned {
  color: var(--accent-gold);
}

.qr-status.confirmed {
  color: var(--success);
}

.qr-status.expired {
  color: var(--error);
}

.qr-refresh {
  margin-top: 12px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 16px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.qr-refresh:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.qr-manual {
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.qr-manual p {
  color: var(--text-muted);
  font-size: 14px;
}

/* App config form in modal */
.bind-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.bind-platform-info {
  text-align: center;
  margin-bottom: 4px;
}

.bind-method-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  background: rgba(91, 155, 213, 0.1);
  color: var(--accent-blue);
  padding: 4px 12px;
  border-radius: 10px;
}

.bind-note {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
}

.app-config-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
}

.app-config-field label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.app-config-field .field-input {
  width: 100%;
}

.spinner-qr {
  display: inline-block;
  animation: spin 0.8s linear infinite;
  color: var(--accent-gold);
}

/* 通用 modal 段落文字 */
.qr-note {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 24px;
  line-height: 1.6;
}

.qr-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}
.btn-primary.danger {
  background: #ef4444;
}

.btn-primary.danger:hover:not(:disabled) {
  background: #dc2626;
}

/* MCP code sample */
.mcp-note h3 {
  font-family: var(--font-heading);
  font-size: 16px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.mcp-code-sample {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre;
  overflow-x: auto;
  margin: 10px 0;
  line-height: 1.5;
}

.mcp-tip {
  font-size: 13px;
  color: var(--accent-gold);
}

.mcp-note {
  margin-top: 20px;
  padding: 12px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.6;
}

.mcp-note code {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--accent-gold);
}

/* ══════════════════════════════════════════ */
/* 模块标题栏 + 刷新按钮 + 错误横幅 */
/* ══════════════════════════════════════════ */
.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.module-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 刷新按钮 */
.refresh-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-primary);
  background: var(--bg-raised);
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.refresh-btn.spinning svg {
  animation: test-spin 0.8s linear infinite;
}

/* 自定义徽章（红色调） */
.cat-badge.custom-badge {
  background: rgba(233, 69, 96, 0.08);
  color: var(--accent);
}

/* 只读列表项 */
.list-item.readonly {
  opacity: 0.7;
  cursor: default;
}

.list-item.readonly:hover {
  background: transparent;
  border-color: transparent;
  transform: none;
  box-shadow: none;
}

/* 错误横幅 */
.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  margin-bottom: 12px;
  background: rgba(248, 81, 73, 0.08);
  border: 1px solid rgba(248, 81, 73, 0.2);
  border-radius: var(--radius-input);
  font-size: 14px;
  color: var(--error);
}

.retry-btn {
  background: none;
  border: 1px solid rgba(248, 81, 73, 0.3);
  color: var(--error);
  padding: 4px 12px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.retry-btn:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.12);
}

.retry-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 开源项目链接 */
.repo-link {
  color: var(--accent);
  font-size: 13px;
  text-decoration: none;
}
.repo-link:hover {
  text-decoration: underline;
}

/* 开源集成卡片 */
.oss-cards {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.oss-card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 20px 24px;
  margin-bottom: 0;
}
.oss-repo {
  margin: 2px 0 8px;
  font-size: 13px;
  color: var(--text-muted);
}
.oss-repo .repo-link {
  font-size: 14px;
}

</style>
