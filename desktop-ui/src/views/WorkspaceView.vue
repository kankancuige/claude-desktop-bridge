<script setup lang="ts">
/**
 * WorkspaceView - Claude Desktop Bridge 主工作区视图
 *
 * 负责整个应用的核心交互界面，包含以下功能模块：
 * 1. 项目列表与会话管理 — 侧栏展示所有项目及其历史会话，支持新建/删除/恢复会话
 * 2. WebSocket 实时通信 — 通过 Gateway 与 Claude CLI 进程双向通信，接收流式消息
 * 3. 消息气泡渲染 — 区分系统消息/用户气泡/AI气泡/思考块/工具调用记录/错误消息
 * 4. 斜杠命令/文件/Agent 自动补全 — 输入 `/` `#` `@` 触发下拉菜单，支持键盘导航
 * 5. IM 平台镜像开关 — 三平台（微信/飞书/钉钉）独立开关，开启后将回复同步到对应平台
 * 6. 思考状态管理 — 控制 Claude 的 thinking level，估算思考 token 消耗
 * 7. 文件快照与 Diff 面板 — 右侧栏展示工作目录文件变更，支持文件预览与 diff 对比
 * 8. 记录点（Checkpoint）时间线 — 支持撤销到历史记录点、提交修改为新基线
 * 9. 消息队列 — thinking 期间用户可继续输入，排队或立即注入补充指令
 * 10. 上下文圆环 — 可视化当前 token 使用比例，点击触发 /compact 压缩
 * 11. 余额与费用监控 — 实时计算每轮费用，达到阈值时静默 toast 提醒
 * 12. 双通道权限确认 — 处理 SDK 发来的 permission_request / choice_request
 *
 * 设计原则：
 * - 所有 IO 操作通过 Gateway HTTP API（非直连 Claude CLI），避免阻塞 UI 线程
 * - 消息气泡使用 role 区分布局（user 右对齐、assistant 左对齐、system/thinking 居中）
 * - 本地 localStorage 持久化 token 累计、费用、镜像开关偏好，重启可恢复
 * - keep-alive 兼容：onActivated 中重新加载模型列表并滚动到底部
 */
defineOptions({name: 'WorkspaceView'})
import {ref, shallowRef, nextTick, onMounted, onActivated, onBeforeUnmount, computed, watch, defineAsyncComponent} from 'vue'
import * as monaco from 'monaco-editor'
import {useRouter} from 'vue-router'
import {t, setLocale} from '../i18n'
const PhaserPet = defineAsyncComponent(() => import('./PhaserPet.vue'))
const GlobalToast = defineAsyncComponent(() => import('../components/GlobalToast.vue'))
const SidebarLeft = defineAsyncComponent(() => import('../components/SidebarLeft.vue'))
const RightPanels = defineAsyncComponent(() => import('../components/RightPanels.vue'))

const router = useRouter()
// Gateway 后端地址：本地网关统一代理所有 API 请求
const GW = 'http://127.0.0.1:3456'

// 项目数据结构：workDir 为工作目录路径，encodedDir 为 URL 安全的编码形式
interface Project {
  workDir: string
  /** URL 安全的目录编码（盘符 `:` → `--`，路径 `/` → `-`），用于 API 路径参数 */
  encodedDir: string
  sessionCount: number
  lastActive: number
  sessions: { id: string; title?: string; size: number }[]
}

// 工具调用记录：AI 在一次回复中调用的单个工具（Edit/Write/Bash 等）
interface ToolUse {
  tool_name: string
  tool_use_id: string
  input: Record<string, any>
  /** 工具执行耗时（秒），由 tool_progress / content_block_stop 事件更新 */
  elapsed?: number
  /** 工具调用详情展开/折叠状态 */
  expanded?: boolean
}

// 消息数据结构：涵盖所有消息角色（用户/AI/思考/系统/错误）
interface Message {
  role: 'user' | 'assistant' | 'thinking' | 'system' | 'error'
  text: string
  time: number
  /** 思考块展开后的完整文本内容 */
  thinkingContent?: string
  /** 思考块的 SDK index，用于 thinking_delta 增量追加匹配 */
  thinkingId?: number
  /** 思考块展开/折叠 */
  expanded?: boolean
  /** 本条 assistant 消息关联的工具调用列表（在 tool_use_start 事件中累积） */
  tools?: ToolUse[]
  /** 工具调用列表展开/折叠 */
  toolsExpanded?: boolean
}

// ── 文件快照 Diff ──
// 文件变更状态枚举
type FileStatus = 'unchanged' | 'added' | 'modified' | 'deleted'

// 扁平化文件条目（来自 Gateway /files API）
interface FlatFile {
  path: string
  size: number
  binary: boolean
  status: FileStatus
  added: number | null
  removed: number | null
}

// 文件树节点：目录可递归包含子节点，叶子节点持有 file 引用
interface TreeNode {
  name: string
  path: string          // 目录为相对路径前缀，文件为完整相对路径
  isDir: boolean
  file?: FlatFile
  children?: TreeNode[]
}

// Diff 单行数据
interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string
}

// Diff 完整结果
interface DiffResult {
  path: string;
  status: string;
  added?: number;
  removed?: number;
  lines?: DiffLine[];
  binary?: boolean;
  tooLarge?: boolean
}

// ── 记录点（Checkpoint）──
// Checkpoint 是 AI 改完文件后自动保存的快照，支持回退到任意历史记录点
interface CheckpointFile {
  path: string;
  status: FileStatus;
  notRevertible?: boolean;
  added: number | null;
  removed: number | null
}

interface Checkpoint {
  id: string
  prompt: string
  time: number
  revertible: boolean
  fileCount: number
  added: number
  removed: number
  files: CheckpointFile[]
}

// ═══════════════════════════════════════════
// ── 响应式状态（State）──
// ═══════════════════════════════════════════

/** 项目列表：从 Gateway 扫描的工作目录集合 */
const projects = ref<Project[]>([])
/** 侧栏中已展开的项目集合（workDir → 是否展开），点击项目卡片切换 */
const expandedProjects = ref<Set<string>>(new Set())
/** 已"显示全部"会话的项目集合，用于分页展开/收起 */
const showAllSessions = ref<Set<string>>(new Set())
/** 单个项目下会话默认显示数目上限，超出后显示"展开全部"按钮 */
const sessionPageSize = 5
/** 侧栏项目列表是否已展开全部（默认只显示前 N 个） */
const showAllProjects = ref(false)
/** 侧栏项目列表分页大小 */
const projectPageSize = 10
/** 已隐藏的项目路径集合（持久化到 localStorage） */
const STORAGE_KEY_HIDDEN = 'bridge-hidden-projects'
function loadHiddenProjects(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HIDDEN)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
const hiddenProjects = ref<Set<string>>(loadHiddenProjects())
/** 隐藏项目折叠区是否展开 */
const showHiddenSection = ref(false)

/** 可见项目列表：未展开时只返回前 projectPageSize 条，避免长列表卡顿 */
const visibleProjects = computed(() => {
  if (showAllProjects.value || filteredProjects.value.length <= projectPageSize) return filteredProjects.value
  return filteredProjects.value.slice(0, projectPageSize)
})

/** 可见会话列表：未展开时只返回前 sessionPageSize 条 */
function visibleSessions(p: Project) {
  if (showAllSessions.value.has(p.workDir) || p.sessions.length <= sessionPageSize) return p.sessions
  return p.sessions.slice(0, sessionPageSize)
}

/** 切换某个项目下会话的"展开全部/收起"状态 */
function toggleShowAll(workDir: string) {
  const s = new Set(showAllSessions.value)
  if (s.has(workDir)) s.delete(workDir)
  else s.add(workDir)
  showAllSessions.value = s
}

/** 持久化 hiddenProjects 到 localStorage */
function persistHidden() {
  try { localStorage.setItem(STORAGE_KEY_HIDDEN, JSON.stringify([...hiddenProjects.value])) } catch {}
}

/** 隐藏项目：加入 hiddenProjects，如果是当前活跃项目则清理状态 */
function hideProject(workDir: string) {
  const s = new Set(hiddenProjects.value)
  s.add(workDir)
  hiddenProjects.value = s
  persistHidden()
  if (activeProject.value === workDir) {
    activeProject.value = ''
    sessionId.value = ''
  }
}

/** 显示项目：从 hiddenProjects 移除 */
function showProject(workDir: string) {
  const s = new Set(hiddenProjects.value)
  s.delete(workDir)
  hiddenProjects.value = s
  persistHidden()
}

/** 删除会话前弹出二次确认弹窗（先设置 pendingDelete，用户确认后执行 confirmDelete） */
async function deleteSession(sid: string) {
  pendingDelete.value = {sid}
}

/** 待确认的删除会话信息（null 表示无待确认项） */
const pendingDelete = ref<{ sid: string } | null>(null)
/** 待确认关闭的标签页 ID（null 表示无待确认项） */
const pendingCloseTabId = ref<string | null>(null)
/** 确认关闭待关闭的标签页 */
function confirmCloseTab() {
  if (!pendingCloseTabId.value) return
  doCloseTab(pendingCloseTabId.value)
  pendingCloseTabId.value = null
}

/** 确认删除会话：调用 Gateway DELETE API，清理 localStorage 缓存的 token/费用数据，并清理当前活跃 session 状态 */
async function confirmDelete() {
  if (!pendingDelete.value) return
  const {sid} = pendingDelete.value
  pendingDelete.value = null
  try {
    const res = await fetch(`${GW}/api/sessions/${sid}?deleteFiles=1`, {method: 'DELETE'})
    if (!res.ok) {
      showToast(t('ws.deleteFailed'))
      return
    }
    // 清理 localStorage 缓存的 token/费用记忆
    try { localStorage.removeItem(usageKey(sid)) } catch {}
    // 如果删除的是当前前台活跃 session，清理 UI 状态
    const tab = tabSessions.value.find(t => t.state.sessionId === sid)
    if (tab) tabSessions.value = tabSessions.value.filter(t => t.id !== tab.id)
    if (sessionId.value === sid) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.close() } catch {}
      }
      ws = null
      sessionId.value = null
      connected.value = false
      status.value = 'idle'
      messages.value = []
      activeProject.value = ''
    }
    await loadProjects()
  } catch {
    showToast(t('ws.deleteFailed'))
  }
}

/** 项目搜索关键词（侧栏搜索框双向绑定） */
const projectSearch = ref('')
/** WebSocket 连接状态（true=已建立连接） */
const connected = ref(false)
/** Gateway 版本号 */
const gatewayVersion = ref('')
/** 当前会话 ID（由 Gateway 创建会话返回） */
const sessionId = ref<string | null>(null)
/** 会话创建时间戳 */
const sessionStartTime = ref<number>(0)
/** 当前会话已持续分钟数（每秒更新） */
const sessionDurationMinutes = ref(0)
let sessionDurationTimer: ReturnType<typeof setInterval> | null = null
function startSessionDurationTimer() {
  if (sessionDurationTimer) clearInterval(sessionDurationTimer)
  sessionDurationMinutes.value = 0
  sessionDurationTimer = setInterval(() => {
    if (sessionStartTime.value) {
      sessionDurationMinutes.value = Math.floor((Date.now() - sessionStartTime.value) / 60000)
    }
  }, 10000) // 10 秒更新一次即可
}
/** 当前 Claude 状态：'idle' 空闲 / 'thinking' 思考中 */
const status = ref('idle')
/** 当前会话的消息列表（按时间序追加） */
const messages = ref<Message[]>([])

// ── 多会话标签页 ──
/** 标签页状态快照——所有需要在切换时保存/恢复的运行时状态 */
interface TabState {
  sessionId: string | null
  connected: boolean
  status: string
  messages: Message[]
  inputText: string
  usage: { input: number; output: number; thinking: number; total: number }
  costTotal: number
  contextPercent: number
  agentRuns: any[]
  msgQueue: any[]
  pendingTools: any[]
  pendingPermission: any
  pendingChoice: any
  thinkingLevel: string
  permissionMode: string
  model: string
  turnThinkingText: string
  lastUserMessage: string
  mirrorState: Record<string, boolean>
}

/** 创建初始标签页状态（所有字段有默认值） */
function initialTabState(): TabState {
  return {
    sessionId: null,
    connected: false,
    status: 'idle',
    messages: [],
    inputText: '',
    usage: { input: 0, output: 0, thinking: 0, total: 0 },
    costTotal: 0,
    contextPercent: 0,
    agentRuns: [],
    msgQueue: [],
    pendingTools: [],
    pendingPermission: null,
    pendingChoice: null,
    thinkingLevel: 'auto',
    permissionMode: 'default',
    model: model.value,
    turnThinkingText: '',
    lastUserMessage: '',
    mirrorState: { wechat: false, feishu: false, dingtalk: false },
  }
}

/** 从全局 ref 提取当前状态快照（深拷贝数组字段） */
function snapshotTabState(): TabState {
  return {
    sessionId: sessionId.value,
    connected: connected.value,
    status: status.value,
    messages: [...messages.value],
    inputText: inputText.value,
    usage: { ...usage.value },
    costTotal: costTotal.value,
    contextPercent: contextPercent.value,
    agentRuns: [...agentRuns.value],
    msgQueue: [...msgQueue.value],
    pendingTools: [...pendingTools.value],
    pendingPermission: pendingPermission.value,
    pendingChoice: pendingChoice.value,
    thinkingLevel: thinkingLevel.value,
    permissionMode: permissionMode.value,
    model: model.value,
    turnThinkingText,
    lastUserMessage,
    mirrorState: { ...mirrorState.value },
  }
}

/** 将状态快照恢复到全局 ref（深拷贝数组字段，保持响应式引用不变） */
function restoreTabState(s: TabState) {
  sessionId.value = s.sessionId
  connected.value = s.connected
  status.value = s.status
  messages.value = s.messages
  inputText.value = s.inputText
  usage.value = { ...s.usage }
  costTotal.value = s.costTotal
  contextPercent.value = s.contextPercent
  agentRuns.value = s.agentRuns
  msgQueue.value = s.msgQueue
  pendingTools.value = s.pendingTools
  pendingPermission.value = s.pendingPermission
  pendingChoice.value = s.pendingChoice
  thinkingLevel.value = s.thinkingLevel
  permissionMode.value = s.permissionMode
  model.value = s.model
  turnThinkingText = s.turnThinkingText
  lastUserMessage = s.lastUserMessage
  mirrorState.value = { ...s.mirrorState }
}

interface TabSession {
  id: string          // uuid
  projectPath: string // workDir
  label: string       // 显示文字(项目名)
  websocket: WebSocket | null
  state: TabState     // 运行时状态快照
}
const tabSessions = ref<TabSession[]>([])
const activeTabId = ref<string | null>(null)
const activeTab = computed(() => tabSessions.value.find(t => t.id === activeTabId.value) || null)


function createTabSession(workDir: string): TabSession {
  return {
    id: crypto.randomUUID(),
    projectPath: workDir,
    label: workDir.replace(/\\/g, '/').split('/').pop() || workDir,
    websocket: null,
    state: initialTabState(),
  }
}

function switchToTab(tabId: string) {
  if (activeTabId.value === tabId) return
  syncCurrentTabState()
  activeTabId.value = tabId
  const tab = tabSessions.value.find(t => t.id === tabId)
  if (!tab) return

  // 有 sessionId 但没 websocket（重启恢复）→ 先恢复状态再 resume
  if (tab.state.sessionId && !tab.websocket) {
    restoreTabState(tab.state)
    activeProject.value = tab.projectPath
    ws = null  // 切断旧 tab 的 ws 引用，防止 connectWS 误关
    // await 确保历史消息加载完成后才返回，异常不被静默吞掉
    handleNewSession(tab.projectPath, encodeProjectName(tab.projectPath), tab.state.sessionId)
    return
  }

  // 空壳标签页: 仅显示欢迎页，不干扰其他 tab 的活跃连接
  if (!tab.state.sessionId && !tab.websocket) {
    activeProject.value = tab.projectPath
    sessionId.value = null
    connected.value = false; status.value = 'idle'
    messages.value = []; inputText.value = ''
    return
  }

  // 恢复保存的状态快照到全局
  restoreTabState(tab.state)
  activeProject.value = tab.projectPath
  ws = tab.websocket
  // 通知 Gateway 切换 IM 消息注入目标 + 同步镜像开关
  if (tab.state.sessionId) {
    fetch(`${GW}/api/sessions/${tab.state.sessionId}/focus`, {method: 'POST'}).catch(() => {})
    loadSessionMirrors()
  }
  // MRU 排序: 将当前 tab 移到数组末尾
  const idx = tabSessions.value.findIndex(t => t.id === tabId)
  if (idx >= 0 && idx < tabSessions.value.length - 1) {
    const [moved] = tabSessions.value.splice(idx, 1)
    tabSessions.value.push(moved)
  }
}

function syncCurrentTabState() {
  const tab = activeTab.value
  if (!tab) return
  tab.state = snapshotTabState()
  tab.websocket = ws
}

function closeTab(tabId: string) {
  const tab = tabSessions.value.find(t => t.id === tabId)
  // 活跃会话需二次确认，避免误关闭丢失未提交工作
  if (tab?.state.sessionId && tab.state.connected) {
    pendingCloseTabId.value = tabId
    return
  }
  doCloseTab(tabId)
}

function doCloseTab(tabId: string) {
  const tab = tabSessions.value.find(t => t.id === tabId)
  if (tab?.websocket) {
    tab.websocket.onclose = null   // 阻止异步 onclose 污染其他 tab 的全局状态
    tab.websocket.onerror = null
    try { tab.websocket.close() } catch {}
  }
  tabSessions.value = tabSessions.value.filter(t => t.id !== tabId)
  if (activeTabId.value === tabId) {
    const next = tabSessions.value[tabSessions.value.length - 1]
    if (next) switchToTab(next.id)
    else {
      activeTabId.value = null
      sessionId.value = null; status.value = 'idle'; messages.value = []
      connected.value = false; ws = null
    }
  }
}
// ── 宠物状态（Gateway settings.json 为数据源，localStorage 为快速缓存）──
const petEnabledGlob = ref(localStorage.getItem('claude-bridge-pet-enabled') !== 'false')
const petId = ref(localStorage.getItem('claude-bridge-pet') || '')
function persistPetToGateway() {
  // SIDE_EFFECT: 异步写 Gateway settings.json，不阻塞 UI
  fetch(`${GW}/api/config/settings`)
    .then(r => r.ok ? r.json() : {})
    .then(s => {
      s.petEnabled = petEnabledGlob.value
      s.pet = petId.value
      return fetch(`${GW}/api/config/settings`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(s),
      })
    })
    .catch(() => {})
}
// 右键切换或设置页改了 pet → 本地更新 + 持久化
function onSwitchPet(id: string) {
  petId.value = id
  localStorage.setItem('claude-bridge-pet', id)
  persistPetToGateway()
}
// 设置页切换 petEnabled → 本地更新 + 持久化
function onPetEnabledChange(v: boolean) {
  petEnabledGlob.value = v
  localStorage.setItem('claude-bridge-pet-enabled', String(v))
  persistPetToGateway()
}
// 暴露给 SettingsView 获取当前 pet（OSS Tab 切换用的 select 需要）
if (typeof window !== 'undefined') (window as any).__petApi = {
  getPet: () => petId.value,
  setPet: (id: string) => onSwitchPet(id),
  setPetEnabled: (v: boolean) => onPetEnabledChange(v),
}
// ── 宠物气泡文案库 ──
function petPick(arr: string[], proj: string) { return arr[Math.floor(Math.random() * arr.length)].replace(/\{proj\}/g, proj) }

const BUBBLE_CONNECTED = ['主人，我来啦，已打开{proj}项目','{proj}项目就绪，随时待命','已连接{proj}项目，开始干活','{proj}项目上线了','主人，{proj}项目准备就绪']
const BUBBLE_THINKING = ['主人，我在想 {proj}项目的 ','容我思考一下 {proj}项目的 ','让我琢磨琢磨 {proj}项目的 ','嗯，我想想 {proj}项目的 ','正在分析 {proj}项目的 ']
const BUBBLE_TOOL_GENERIC = ['看我的','交给我吧','让我来','这个我会','小意思，看我的']
const BUBBLE_SUCCESS = ['主人，{proj}项目搞定啦！✨','{proj}项目任务完成！','收工，{proj}项目搞定了','{proj}项目全部完成！','主人，{proj}项目妥了！']
const BUBBLE_ERROR_SDK = ['主人，{proj}项目出错了：','哎呀，{proj}项目出问题了：','糟糕，{proj}项目报错了：','主人，{proj}项目遇到点麻烦：','不妙，{proj}项目出了点状况：']
const BUBBLE_DISCONNECTED = ['主人，{proj}项目断开了连接，我歇会儿~','{proj}项目已离线','连接断开，{proj}项目等我回来','主人，{proj}项目掉线了','{proj}项目暂时离线了']
const BUBBLE_ERROR_CONN = ['主人，{proj}项目连接出错了！','哎呀，{proj}项目连不上了！','{proj}项目连接失败！','糟糕，{proj}项目网络出问题了！','主人，{proj}项目连不上了！']
const BUBBLE_LONG_TASK = ['主人别急，我已经忙了 {m} 分钟了，还在加油呢~','主人稍等，已经干了 {m} 分钟，快了快了','主人，已经忙了 {m} 分钟了，让我再想想','{m} 分钟了，还在努力思考中','主人，都 {m} 分钟了，再给我点时间~']

// ── 宠物状态同步 ──
const petState = ref('idle')
const petMessage = ref('')
const petBubble = ref('')  // 气泡持续显示，手动清除
let petBubbleTimer: ReturnType<typeof setTimeout> | null = null
/** 后台 tab 数组交换期间置 true，阻止 watch 回调触发 pet 污染 */
let _swappingTab = false
function syncPetState(state: string, extra?: Record<string, any>) {
  petState.value = state
  petMessage.value = extra?.message || ''
  // 气泡：思考/工具/成功/失败时显示，成功后 4s 自动消失
  if (extra?.bubble) {
    petBubble.value = extra.bubble
    if (petBubbleTimer) clearTimeout(petBubbleTimer)
    petBubbleTimer = setTimeout(() => { petBubble.value = '' }, 5000)
  }
  if (petTimer) clearTimeout(petTimer)
  petTimer = setTimeout(() => { petMessage.value = '' }, 4000)
}
// ── 语音输入暂时移除，使用系统原生方案（Win+H / macOS 听写）──
// 宠物气泡：长任务提醒
let longTaskBubbleShown = false
let longTaskBubbleTimer: ReturnType<typeof setTimeout> | null = null
watch(sessionDurationMinutes, (m) => {
  if (m >= 3 && !longTaskBubbleShown && status.value === 'thinking') {
    longTaskBubbleShown = true
    petBubble.value = BUBBLE_LONG_TASK[Math.floor(Math.random() * BUBBLE_LONG_TASK.length)].replace('{m}', String(m))
    longTaskBubbleTimer = setTimeout(() => { petBubble.value = '' }, 5000)
  }
  if (m < 3) longTaskBubbleShown = false
})
watch(status, (s) => {
  if (_swappingTab) return  // 后台 tab 数组交换期间的中间态，忽略
  if (s === 'thinking') syncPetState('thinking')
  else if (s === 'idle' && connected.value) syncPetState('connected')
  else if (!connected.value) syncPetState('disconnected')
  else syncPetState('idle')
  if (s !== 'thinking') { longTaskBubbleShown = false; if (longTaskBubbleTimer) clearTimeout(longTaskBubbleTimer) }
})
// ── 导出菜单状态 ──
const showExportMenu = ref(false)

/** 导出为 Markdown 格式 */
function exportAsMarkdown(): string {
  let md = `# Claude Desktop Bridge - 会话导出\n`
  md += `> ${t('ws.exportTime')}: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n`
  for (const m of messages.value) {
    const time = new Date(m.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})
    if (m.role === 'user') {
      md += `### 用户 (${time})\n\n${m.text}\n\n`
    } else if (m.role === 'assistant') {
      md += `### Claude (${time})\n\n${m.text}\n\n`
      if (m.tools?.length) {
        md += `<details><summary>工具调用 (${m.tools.length})</summary>\n\n`
        for (const t of m.tools) {
          md += `- **${t.tool_name}** (${t.elapsed || 0}s)\n`
          md += `  \`\`\`json\n  ${JSON.stringify(t.input).slice(0, 500)}\n  \`\`\`\n`
        }
        md += `\n</details>\n\n`
      }
    } else if (m.role === 'thinking') {
      md += `<details><summary>思考 (${time})</summary>\n\n\`\`\`\n${m.thinkingContent || ''}\n\`\`\`\n</details>\n\n`
    } else if (m.role === 'error') {
      md += `### 错误 (${time})\n\n${m.text}\n\n`
    }
  }
  return md
}

/** 导出为 JSON 格式（完整结构化） */
function exportAsJSON(): string {
  const data = {
    exportedAt: new Date().toISOString(),
    sessionId: sessionId.value,
    messageCount: messages.value.length,
    messages: messages.value.map(m => ({
      role: m.role,
      text: m.text,
      time: new Date(m.time).toISOString(),
      thinkingContent: m.thinkingContent || undefined,
      tools: m.tools?.map(t => ({
        tool_name: t.tool_name,
        tool_use_id: t.tool_use_id,
        input: t.input,
        elapsed: t.elapsed,
      })),
    })),
  }
  return JSON.stringify(data, null, 2)
}

/** 导出为 JSONL 格式（兼容 Claude Code CLI 格式） */
function exportAsJSONL(): string {
  const lines: string[] = []
  for (const m of messages.value) {
    if (m.role === 'user') {
      lines.push(JSON.stringify({
        role: 'user',
        content: [{type: 'text', text: m.text}],
      }))
    } else if (m.role === 'assistant') {
      const contents: any[] = [{type: 'text', text: m.text}]
      if (m.tools?.length) {
        for (const t of m.tools) {
          contents.push({
            type: 'tool_use',
            name: t.tool_name,
            id: t.tool_use_id,
            input: t.input,
          })
        }
      }
      lines.push(JSON.stringify({
        role: 'assistant',
        content: contents,
      }))
    } else if (m.role === 'thinking' && m.thinkingContent) {
      lines.push(JSON.stringify({
        role: 'assistant',
        content: [{type: 'thinking', thinking: m.thinkingContent}],
      }))
    }
  }
  return lines.join('\n')
}

/** 触发文件下载 */
function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], {type: mime})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function doExport(format: 'md' | 'json' | 'jsonl') {
  showExportMenu.value = false
  const sid = sessionId.value?.slice(0, 8) || 'session'
  let content: string, filename: string, mime: string
  switch (format) {
    case 'md':
      content = exportAsMarkdown(); filename = `claude-chat-${sid}.md`; mime = 'text/markdown'; break
    case 'json':
      content = exportAsJSON(); filename = `claude-chat-${sid}.json`; mime = 'application/json'; break
    case 'jsonl':
      content = exportAsJSONL(); filename = `claude-chat-${sid}.jsonl`; mime = 'application/jsonl'; break
  }
  triggerDownload(content, filename, mime)
}
/** 输入框文本（双向绑定） */
const inputText = ref('')
// ── 图片附件 ──
interface PendingAttachment {
  id: number
  file: File
  dataUrl: string
  uploading: boolean
  uploadedPath?: string
}
const pendingAttachments = ref<PendingAttachment[]>([])
let attachmentIdCounter = 0

/** 粘贴事件处理: 从剪贴板提取图片并加入待发送列表 */
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        pendingAttachments.value.push({
          id: ++attachmentIdCounter,
          file,
          dataUrl: reader.result as string,
          uploading: false,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

/** 移除待发送附件 */
function removeAttachment(id: number) {
  pendingAttachments.value = pendingAttachments.value.filter(a => a.id !== id)
}

/** 上传附件到 Gateway 并获取路径（含多模态路由处理） */
async function uploadAttachment(att: PendingAttachment, sessionId: string) {
  att.uploading = true
  try {
    const form = new FormData()
    form.append('file', att.file)
    const res = await fetch(`${GW}/api/sessions/${sessionId}/upload`, {
      method: 'POST',
      body: form,
    })
    if (res.ok) {
      const d = await res.json()
      att.uploadedPath = d.path
      if (d.ocrText) (att as any).ocrText = d.ocrText
      if (d.multimodal) (att as any).multimodal = true
    }
  } catch {}
  att.uploading = false
}
/** 正在创建新会话中（防止重复点击） */
const connecting = ref(false)
/** 当前活跃项目的工作目录（用于高亮侧栏） */
const activeProject = ref<string | null>(null)
/** 消息区域 DOM 引用，用于自动滚动到底部 */
const chatRef = ref<HTMLElement | null>(null)
/** 用户是否手动上滑离开了底部（抑制任务执行中的自动滚动） */
const userScrolledUp = ref(false)
/** 当前活跃的会话 ID（用于侧栏高亮选中会话） */
const activeSessionId = ref<string | null>(null)

// ── 文件快照 Diff 面板状态 ──
/** 右侧文件面板是否可见 */
const showFilePanel = ref(false)
/** 工作目录下的文件列表（扁平数组，含变更状态） */
const fileList = ref<FlatFile[]>([])
/** 文件树加载中 */
const fileTreeLoading = ref(false)
/** 是否存在基线快照（首次快照后文件变更才有意义） */
const hasSnapshot = ref(false)
/** 基线快照时间戳 */
const snapshotAt = ref<number | null>(null)
/** 文件列表是否被截断（文件过多时 Gateway 只返回前 N 个） */
const fileTruncated = ref(false)
/** 快照文件丢失（如工作目录被删除后残留引用） */
const fileMissing = ref(false)
/** 文件树中已展开的目录路径集合 */
const expandedDirs = ref<Set<string>>(new Set())
/** 文件过滤：'all' 全部文件 / 'changed' 仅变更文件 */
const fileFilter = ref<'all' | 'changed'>('all')

// ── 记录点（Checkpoint）状态 ──
/** 记录点列表（最新在前，调用 loadCheckpoints 后填充） */
const checkpoints = ref<Checkpoint[]>([])
/** 记录点列表加载中 */
const checkpointsLoading = ref(false)
/** 已展开的记录点 ID 集合（展开后显示该记录点下的文件列表） */
const expandedCp = ref<Set<string>>(new Set())
/** 回退操作进行中（防重复点击） */
const rewinding = ref(false)
/** 待确认回退的记录点（二次确认弹窗用） */
const pendingRewind = ref<Checkpoint | null>(null)
/** 记录点下拉框是否展开 */
const showCpDropdown = ref(false)

// ── Modal：文件内容预览 / Diff 对比 ──
/** modal 模式：'file' 文件内容预览 / 'diff' Diff 对比 / null 关闭 */
const modalMode = ref<'file' | 'diff' | null>(null)
/** modal 中显示的文件路径 */
const modalPath = ref('')
/** 文件内容（文本文件） */
const modalFileContent = ref('')
/** Markdown 渲染后的 HTML（.md 文件不走 Monaco，直接渲染预览） */
const modalMarkdown = computed(() => {
  if (!modalPath.value.endsWith('.md') || !modalFileContent.value) return ''
  return renderMarkdown(modalFileContent.value)
})
/** 是否二进制文件（不可预览） */
const modalFileBinary = ref(false)
/** Diff 结果数据 */
const modalDiff = ref<DiffResult | null>(null)
/** modal 内容加载中 */
const modalLoading = ref(false)
/** 编辑器内容是否已被修改（用于*标记和关闭时提示保存） */
const modalDirty = ref(false)
/** 关闭前待确认的未保存状态 */
const pendingUnsaved = ref(false)

// ── Monaco Editor ──
/** Monaco 单文件编辑器实例（file 模式），每次打开 modal 新建，关闭时 dispose。
 *  使用 shallowRef：Monaco 实例内部结构复杂，ref 深度代理会导致第二次 open 卡死 */
const monacoEditor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
/** Monaco diff 编辑器实例（diff 模式），每次打开 modal 新建，关闭时 dispose */
const monacoDiffEditor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(null)
/** diff 模式外部创建的 model（diffEditor.dispose 不会清理它们，需手动 dispose） */
let diffOriginalModel: monaco.editor.ITextModel | null = null
let diffModifiedModel: monaco.editor.ITextModel | null = null
/** Monaco 编辑器挂载容器（file 和 diff 共用同一个 div） */
const monacoContainer = shallowRef<HTMLDivElement | null>(null)
/** 编辑器当前内容缓存（onDidChangeContent 实时更新，避免 save 时调 getValue() 挂死） */
let cachedEditorContent = ''

/** WebSocket 实例（模块级变量，不响应式，避免 Proxy 包装干扰 WebSocket 原生行为） */
let ws: WebSocket | null = null
/** 当前 assistant 回复中待调用的工具列表（在 tool_use_start → assistant_message 之间累积） */
const pendingTools = ref<ToolUse[]>([])

// 双通道确认：权限请求 / 方案选择
// Claude SDK 发送 permission_request 时前端弹出确认横幅，用户点击允许/拒绝后回传
/** 待处理的工具执行权限请求 */
interface PendingPermission {
  requestId: string;
  toolName: string;
  summary: string
}

/** 待处理的多选项选择请求 */
interface PendingChoice {
  requestId: string;
  question: string;
  options: { label: string }[]
}

const pendingPermission = ref<PendingPermission | null>(null)
const pendingChoice = ref<PendingChoice | null>(null)

// ── Agent 运行记录（内联卡片用，统一 native Task agent 和 workflow agent）──
interface AgentRun {
  id: string;
  agentType: string;
  description: string
  status: 'spawning' | 'running' | 'done' | 'error'
  spawnTime: number;
  startTime: number;
  doneTime: number
  progress: string;
  transcriptPath?: string
  source: 'native' | 'workflow';
  expanded?: boolean
  /** 子 agent 当前执行中的工具名/进度描述 */
  currentTool: string;
  currentToolElapsed: number
}

/** 本轮对话中产生的所有 agent 运行记录（内联卡片数据源） */
const agentRuns = ref<AgentRun[]>([])
/** 当前正在运行的 agent 数量（native + workflow） */
const runningAgentTotal = computed(() => {
  let n = agentRuns.value.filter(a => a.status === 'running' || a.status === 'spawning').length
  if (wfRunState.value) n += wfRunState.value.agents.filter((a: any) => a.status === 'running').length
  return n
})
/** Agent 按钮文字 */
const agentBtnLabel = computed(() => {
  const wf = wfRunState.value
  if (wf) return wf.name + ' · ' + (wf.currentPhase || wf.phases?.find((p: any) => p.status === 'running')?.title || wf.status)
  return 'Agent 活动'
})
/** 是否有任何 agent 活动（按钮显示条件） */
const hasAgentActivity = computed(() => agentRuns.value.length > 0 || !!wfRunState.value)

const hasAgentRuns = computed(() => agentRuns.value.length > 0)

/** 清空本轮 agent 运行记录（新一轮对话开始时调用） */
function clearAgentRuns() {
  agentRuns.value = []
}

/** 格式化毫秒时长为可读字符串 */
function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  return Math.floor(ms / 60000) + 'm' + ((ms % 60000) / 1000).toFixed(0) + 's'
}

/** Agent 类型 → 扁平 SVG 图标（14x14，匹配 Remix Icon 风格） */
function agentIcon(type: string): string {
  const svg = (d: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
  const m: Record<string, string> = {
    'Explore': svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
    'Plan': svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    'general-purpose': svg('<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
    'code-reviewer': svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    'claude-code-guide': svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    'claude': svg('<circle cx="12" cy="12" r="10"/><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'),
  }
  return m[type] || svg('<circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>')
}

/** Agent 类型 → 颜色 */
function agentColor(type: string): string {
  const m: Record<string, string> = {
    'Explore': '#6BAEE0',
    'Plan': '#D4A853',
    'general-purpose': '#8B9DC3',
    'code-reviewer': '#3FB950',
    'claude-code-guide': '#B07CD8',
    'claude': '#E94560'
  }
  return m[type] || '#8B9DC3'
}

// ── Workflow 运行状态追踪 ──
interface WfAgentInfo {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  prompt: string;
  output: string
}

interface WfLogEntry {
  time: number;
  phase: string;
  msg: string
}

interface WfRunState {
  name: string;
  status: 'running' | 'done' | 'error' | 'paused';
  phases: { title: string; status: string }[]
  currentPhase: string;
  logs: WfLogEntry[];
  agents: WfAgentInfo[];
  tokenSpent: number;
  wfId: string
}

const wfRunState = ref<WfRunState | null>(null)
const showWfPanel = ref(false)

// 从 workflow_log 消息中提取 agent 状态
function parseWfAgentLog(msg: string): WfAgentInfo | null {
  const m = msg.message?.match(/\[Agent[:：]\s*([\w][\w:\-.\s一-鿿]*?)\]\s*(.+)/)
  if (!m) return null
  const [, label, action] = m
  const labelClean = label.trim()
  const status = /启动|Schema/.test(action) ? 'running'
      : /完成|Journal|恢复/.test(action) ? 'done'
          : /错误|异常/.test(action) ? 'error' : 'running'
  return {id: labelClean, label: labelClean, status, prompt: '', output: ''}
}

// 当有 agent 正在运行时，每秒刷新视图以更新耗时显示
let agentRefreshTimer: ReturnType<typeof setInterval> | null = null
watch(() => agentRuns.value.some(a => a.status === 'running'), (hasRunning) => {
  if (hasRunning && !agentRefreshTimer) {
    agentRefreshTimer = setInterval(() => {
      agentRuns.value = [...agentRuns.value]
    }, 1000)
  } else if (!hasRunning && agentRefreshTimer) {
    clearInterval(agentRefreshTimer);
    agentRefreshTimer = null
  }
})

/** 将权限请求的 input 对象摘要化为可读字符串，优先显示 command / file_path */
function permInputSummary(input: any): string {
  if (!input) return ''
  if (input.command) return '$ ' + String(input.command).slice(0, 200)
  if (input.file_path) return input.file_path
  try {
    return JSON.stringify(input).slice(0, 200)
  } catch {
    return ''
  }
}

// ── 消息队列 ──
// thinking 期间用户输入的文本不会丢失，而是进入排队队列。
// 用户可以手动选择"立即注入"（injectNow，追加到当前流）或等 thinking 结束后自动发送（sendQueued）。
// 队列使用递增 id 标识每条消息。
interface QItem {
  id: number;
  text: string;
  time: number
}

/** 排队中的消息列表 */
const msgQueue = ref<QItem[]>([])
/** 最近一次 sendMessage 的用户原文，取消任务时回填到输入框 */
let lastUserMessage = ''
/** 队列自增 ID 计数器 */
let queueId = 0

/** 过滤后的项目列表：根据搜索关键词筛选（不区分大小写，匹配 workDir 路径），并排除已隐藏的项目 */
const filteredProjects = computed(() => {
  const q = projectSearch.value.toLowerCase()
  if (!q) return projects.value.filter(p => !hiddenProjects.value.has(p.workDir))
  return projects.value.filter(p => p.workDir.toLowerCase().includes(q) && !hiddenProjects.value.has(p.workDir))
})

/** 隐藏项目列表：根据搜索关键词筛选（不区分大小写） */
const filteredHiddenProjects = computed(() => {
  const q = projectSearch.value.toLowerCase()
  const pool = projects.value.filter(p => hiddenProjects.value.has(p.workDir))
  if (!q) return pool
  return pool.filter(p => p.workDir.toLowerCase().includes(q))
})

/** 账户余额信息：余额、货币单位、已使用金额 */
const balance = ref({balance: 0, currency: 'CNY', used: 0})

/**
 * 加载供应商模型列表（两步策略）：
 * 1. 读取 settings 判断当前供应商（通过 ANTHROPIC_BASE_URL 匹配 deepseek/anthropic/openai）
 * 2. 从 Gateway 获取该供应商的模型列表（优先实时 /live-models，回退到预设 /providers）
 * 这确保模型选择器始终显示当前供应商实际可用模型
 */
async function loadProviderModels() {
  try {
    // 1. 读 settings 判断当前供应商
    const sr = await fetch(`${GW}/api/config/settings`)
    const sBody = sr.ok ? (await sr.json()) : null
    const baseUrl = sBody?.env?.ANTHROPIC_BASE_URL || ''
    const apiKey = sBody?.env?.ANTHROPIC_AUTH_TOKEN || ''

    // 2. 加载供应商预设
    const pr = await fetch(`${GW}/api/config/providers`)
    if (!pr.ok) return
    const {providers} = await pr.json()

    // 3. 匹配当前供应商：遍历所有 provider，按 baseUrl 包含关系推断
    let provider = null
    const inputUrl = baseUrl.toLowerCase()
    if (inputUrl) {
      for (const p of providers) {
        const pUrl = (p.baseUrl || '').toLowerCase()
        if (pUrl && (inputUrl.includes(p.id) || inputUrl.includes(pUrl.replace(/\/v\d+.*$/, '').replace('https://', '')))) {
          provider = p; break
        }
      }
    }
    if (!provider) provider = providers?.find((p: any) => {
      if (p.id === 'deepseek' && baseUrl.includes('deepseek')) return true;
      if (p.id === 'anthropic' && baseUrl.includes('anthropic')) return true;
      if (p.id === 'codex' && (baseUrl.includes('openai') || baseUrl.includes('codex'))) return true;
      if (p.id === 'openrouter' && baseUrl.includes('openrouter')) return true;
      if (p.id === 'ollama' && baseUrl.includes('ollama')) return true;
      if (p.id === 'zhipu' && baseUrl.includes('bigmodel')) return true;
      if (p.id === 'moonshot' && (baseUrl.includes('moonshot') || baseUrl.includes('kimi'))) return true;
      if (p.id === 'qwen' && baseUrl.includes('aliyun')) return true;
      if (p.id === 'volcengine' && (baseUrl.includes('volces') || baseUrl.includes('volcengine'))) return true;
      if (p.id === 'gemini' && baseUrl.includes('googleapi')) return true;
      return false
    })
    if (!provider) provider = providers?.[0] // fallback: 第一个

    if (provider?.models?.length) {
      models.value = provider.models.map((m: any) => m.id)
      // 读 settings 里设置的默认模型
      if (settingsModel) model.value = settingsModel
    }
    // 叠加真实模型：Anthropic 用 supportedModels()，DeepSeek/OpenAI 用其 /models 接口
    try {
      const endpoint = provider?.id === 'anthropic' ? '/api/config/models' : '/api/config/live-models'
      const ep = new URLSearchParams()
      if (provider?.baseUrl) ep.set('baseUrl', provider.baseUrl)
      if (apiKey) ep.set('apiKey', apiKey)
      const qs = ep.toString() ? `?${ep.toString()}` : ''
      const mr = await fetch(`${GW}${endpoint}${qs}`)
      if (mr.ok) {
        const {models: dyn} = await mr.json()
        if (Array.isArray(dyn) && dyn.length) {
          models.value = dyn.map((m: any) => m.value)
          if (settingsModel) model.value = settingsModel
        }
      }
    } catch {
    }
  } catch {
  }
}

/** 从 settings 读取的当前模型 ID（在 loadProviderModels 之前获取，确保默认选中正确） */
let settingsModel = ''

// 组件挂载：加载项目列表、余额、模型列表、斜杠命令、IM 绑定状态
// 同时注册全局键盘快捷键（Esc 关闭弹窗）
onMounted(async () => {
  // 先拿到当前模型再加载供应商，确保模型选择器默认选中 settings 中保存的模型
  try {
    const sr = await fetch(`${GW}/api/config/settings`)
    if (sr.ok) {
      const s = await sr.json()
      if (s.model) settingsModel = s.model
      if (typeof s.costLimitPercent === 'number') costLimitPercent.value = s.costLimitPercent
      if (typeof s.fileInjectLimitKB === 'number') fileInjectLimitKB.value = s.fileInjectLimitKB
      if (s.language) setLocale(s.language)  // 应用已保存的语言
      // 从 Gateway 恢复 pet 设置
      if (s.petEnabled !== undefined) {
        petEnabledGlob.value = s.petEnabled
        localStorage.setItem('claude-bridge-pet-enabled', String(s.petEnabled))
      }
      if (s.pet) {
        petId.value = s.pet
        localStorage.setItem('claude-bridge-pet', s.pet)
      }
    }
  } catch {
  }
  // 获取 Gateway 版本号
  try { const vr = await fetch(`${GW}/api/version`); if (vr.ok) gatewayVersion.value = (await vr.json()).version } catch {}
  await Promise.all([loadProjects(), loadBalance(), loadProviderModels(), loadSlashCommands(), loadIMStatus()])
  // Esc 关闭 diff/文件 modal
  window.addEventListener('keydown', onGlobalKeydown)
  // 建立控制通道 WS：独立于 session，启动即连，接收 IM nudge 事件
  connectControlWS()
})

/** 全局键盘快捷键：Esc 关闭 / Ctrl+S 保存 */
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (modalMode.value === 'file' && monacoEditor.value) {
      e.preventDefault()
      doSave()
    }
    return
  }
  if (e.key === 'Escape') {
    if (modalMode.value) closeModal()
    else if (showCpDropdown.value) closeCpDropdown()
  }
}

/**
 * keep-alive 重新激活时：
 * 1. 重新从 settings 获取供应商模型（用户可能在 Settings 页改了模型）
 * 2. 滚动到底部（延迟重试最多 15 次，每次 30ms，确保 DOM 已渲染）
 */
// 每 5 秒自动同步当前 tab 状态（WebSocket 事件频繁，定时 sync 不丢主要状态）
let tabAutoSyncTimer: ReturnType<typeof setInterval> | null = null

onActivated(() => {
  petEnabledGlob.value = localStorage.getItem('claude-bridge-pet-enabled') !== 'false'
  loadProviderModels()
  tabAutoSyncTimer = setInterval(syncCurrentTabState, 5000)
  userScrolledUp.value = false
  let tries = 0
  const go = () => {
    if (chatRef.value && chatRef.value.scrollHeight > 0) {
      chatRef.value.scrollTop = chatRef.value.scrollHeight
    } else if (tries < 15) {
      tries++
      setTimeout(go, 30)
    }
  }
  nextTick(() => setTimeout(go, 50))
})

/** 从 Gateway 加载账户余额 */
async function loadBalance() {
  try {
    const res = await fetch(`${GW}/api/balance`)
    if (res.ok) balance.value = await res.json()
  } catch {
  }
}

/**
 * 加载项目列表。reorder=true（点刷新按钮）才按 lastActive 重排；
 * 平时保留当前顺序，避免用户正在操作时项目位置突然跳动。
 * 采用"保序合并"策略：已有项目原位更新，新增项目追加末尾，本地空项目保留。
 */
async function loadProjects(reorder = false) {
  try {
    const res = await fetch(`${GW}/api/projects`)
    const data = await res.json()
    const incoming: Project[] = data.projects || []
    if (reorder || projects.value.length === 0) {
      projects.value = incoming.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
      return
    }
    // 保序合并：已有项目原位更新数据；本地新增的空项目(gateway 暂无)保留；新出现的项目追加到末尾
    const byKey = new Map(incoming.map(p => [p.workDir, p]))
    const kept: Project[] = []
    for (const p of projects.value) {
      const upd = byKey.get(p.workDir)
      if (upd) {
        kept.push(upd);
        byKey.delete(p.workDir)
      } else if (p.sessionCount === 0) kept.push(p)  // 本地手动新增、尚未建会话的项目
    }
    for (const p of incoming) if (byKey.has(p.workDir)) {
      kept.push(p);
      byKey.delete(p.workDir)
    }
    projects.value = kept
  } catch {
  }
}

/**
 * 复刻 Gateway 的项目名编码规则：
 * - 盘符路径 X:/a/b → X--a-b（冒号变双横线，剩余 / 变 -）
 * - 非盘符路径 / 全替为 -
 * 编码结果用作 API 路径参数（/api/projects/{encodedDir}/...）
 */
function encodeProjectName(wd: string) {
  const n = wd.replace(/\\/g, '/')
  const dm = n.match(/^([a-zA-Z]):\/(.*)$/)
  if (!dm) return n.replace(/\//g, '-')
  return dm[1] + '--' + dm[2].replace(/\//g, '-')
}

/**
 * 新增项目：调用 Electron 原生文件夹选择器（或 prompt 回退）。
 * 去重检查（忽略大小写与末尾斜杠）后加入列表头部，清空搜索确保可见。
 */
async function addProject() {
  const api = (window as any).electronAPI
  let dir: string | null = null
  if (api?.selectDirectory) dir = await api.selectDirectory()
  else dir = window.prompt(t('ws.promptDir')) // 无 Electron 时回退
  if (!dir) return
  const wd = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  // 去重：与已有项目比对（忽略大小写与末尾斜杠）
  if (projects.value.some(p => norm(p.workDir) === norm(wd))) {
    showToast(t('ws.projAdded'), 3000);
    return
  }
  projects.value.unshift({
    workDir: wd,
    encodedDir: encodeProjectName(wd),
    sessionCount: 0,
    sessions: [],
    lastActive: Date.now()
  })
  // 如果之前被隐藏过，清除隐藏标记
  if (hiddenProjects.value.has(wd)) {
    const s = new Set(hiddenProjects.value)
    s.delete(wd)
    hiddenProjects.value = s
    persistHidden()
  }
  projectSearch.value = ''      // 清空搜索，确保新项目可见
  activeProject.value = wd
}

/**
 * 创建/恢复会话的核心入口：
 * - 全新会话：workDir 必填，其他参数为空
 * - 恢复历史会话：额外传入 encodedDir + histSessionId，Gateway resume 复用原 sessionId
 * 创建前先重置所有对话状态（消息列表、token 计数、费用累计），
 * 然后调用 Gateway POST /api/sessions 创建/恢复，成功后建立 WebSocket 连接。
 */
async function handleNewSession(workDir: string, encodedDir?: string, histSessionId?: string) {
  syncCurrentTabState()

  let tab = tabSessions.value.find(t => t.projectPath === workDir)
  if (!tab) {
    tab = createTabSession(workDir)
    tabSessions.value.push(tab)
  }
  switchToTab(tab.id)

  connecting.value = true
  activeProject.value = workDir
  activeSessionId.value = histSessionId || null
  // 重置对话状态：清空消息、token 计数、费用
  messages.value = []
  usage.value = {input: 0, output: 0, thinking: 0, total: 0}
  turnThinkingText = ''
  costTotal.value = 0
  costWarned.value = false
  contextPercent.value = 0
  clearAgentRuns()

  // 恢复历史会话时先加载历史消息展示给用户
  if (encodedDir && histSessionId) {
    await loadHistory(encodedDir, histSessionId)
  }
  syncCurrentTabState()

  try {
    const body: any = {
      workDir,
      model: model.value,
      permissionMode: permissionMode.value,
      thinkingLevel: thinkingLevel.value
    }
    if (encodedDir && histSessionId) body.resume = histSessionId

    const res = await fetch(`${GW}/api/sessions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    sessionId.value = data.sessionId
    sessionStartTime.value = Date.now()
    startSessionDurationTimer()
    loadUsage(data.sessionId)  // resume 时恢复已记忆的 token/费用
    connectWS(data.sessionId)
    syncCurrentTabState()  // 将会话 ID + WebSocket 写回 tab
    // 通知 Gateway 聚焦当前会话（IM 消息注入目标）
    fetch(`${GW}/api/sessions/${data.sessionId}/focus`, {method: 'POST'}).catch(() => {})
    loadSessionMirrors()
    setTimeout(loadSlashCommands, 1500)  // 会话起来后拉一次实时命令列表
    loadMentionFiles()                   // 预加载文件列表供 # 引用
    loadMentionAgents()                  // 预加载 agent 列表供 @ 引用
    loadCheckpoints()                    // 预加载记录点，count badge 初始就能显示
    await loadProjects()
  } catch (e: any) {
    const msg = e.message || String(e)
    if (msg === 'Failed to fetch') {
      messages.value.push({role: 'error', text: t('ws.gatewayDown'), time: Date.now()})
    } else if (msg.includes('API Key') || msg.includes('Claude CLI')) {
      messages.value.push({role: 'error', text: msg + t('err.clickSettings'), time: Date.now()})
    } else {
      messages.value.push({role: 'error', text: t('err.connectFail', {msg}), time: Date.now()})
    }
  } finally {
    connecting.value = false
  }
}

/** IM 控制命令处理：接收 Gateway nudge 事件，执行桌面端 UI 操作 */
const seenNudgeIds = new Set<string>()
async function handleNudge(msg: any) {
  const { action, args, nudgeId } = msg
  if (nudgeId) {
    if (seenNudgeIds.has(nudgeId)) return  // 去重：控制通道和 session WS 各收到一次
    seenNudgeIds.add(nudgeId)
    if (seenNudgeIds.size > 200) seenNudgeIds.clear()  // 防止内存泄漏
  }
  try {
    switch (action) {
      case 'switch_project': {
        // 切换项目：支持 projectPath（wechat-ack.sh）或 projectName（adapter）
        const { projectPath, projectName, encodedDir, label, sessionId, sessionIndex } = args
        await loadProjects() // 确保项目列表最新
        // 项目匹配优先级：projectPath > projectName > label
        let resolvedPath = projectPath
        let resolvedEncoded = encodedDir
        let resolvedLabel = label
        if (!resolvedPath && projectName) {
          const pn = projectName.toLowerCase()
          let exact: any = null, partial: any = null
          for (const p of projects.value) {
            const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
            if (dn.toLowerCase() === pn) { exact = p; break }
            if (!partial && (dn.toLowerCase().includes(pn) || (p.workDir || '').toLowerCase().includes(pn))) {
              partial = p
            }
          }
          const match = exact || partial
          if (match) {
            resolvedPath = match.workDir
            resolvedEncoded = match.encodedDir
            resolvedLabel = (match.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
          }
        }
        if (!resolvedPath) { showToast(`项目 "${projectName || ''}" 未找到`); break }
        // 检查是否已有活跃标签页 → 直接切换，不创建新 session
        const existingTab = tabSessions.value.find(t => t.projectPath === resolvedPath && t.websocket && t.websocket.readyState === WebSocket.OPEN)
        if (existingTab) {
          expandedProjects.value.add(resolvedPath)
          activeProject.value = resolvedPath
          switchToTab(existingTab.id)
          showToast(t('ws.nudgeSwitched', { label: resolvedLabel || '' }))
          break
        }
        expandedProjects.value.add(resolvedPath)
        activeProject.value = resolvedPath
        const proj = projects.value.find(p => p.workDir === resolvedPath)
        let histSessionId: string | undefined
        if (sessionId) {
          const match = proj?.sessions?.find(s => s.id.toLowerCase().startsWith(sessionId.toLowerCase()))
          histSessionId = match?.id || sessionId
        } else if (sessionIndex && proj?.sessions?.length) {
          const idx = Math.max(0, Math.min((Number(sessionIndex) || 1) - 1, proj.sessions.length - 1))
          histSessionId = proj.sessions[idx]?.id
        } else if (proj?.sessions?.length) {
          // sessions 已按 mtime 倒序，sessions[0] 即最新活跃 session
          histSessionId = proj.sessions[0]?.id
        }
        await handleNewSession(resolvedPath, resolvedEncoded || '', histSessionId)
        showToast(t('ws.nudgeSwitched', { label: resolvedLabel || '' }))
        break
      }
      case 'switch_session': {
        // 切换 session：支持编号（当前活跃项目下 1-based）或 sessionId（前缀，全局搜）
        const { sessionId, sessionIndex } = args
        let histSessionId: string | undefined
        let targetProjectPath = ''
        let targetEncodedDir = ''

        if (sessionId) {
          // 跨所有项目搜，找到第一个匹配 sessionId 前缀的
          for (const p of projects.value) {
            const match = p.sessions?.find(s => s.id.toLowerCase().startsWith(sessionId.toLowerCase()))
            if (match) {
              histSessionId = match.id
              targetProjectPath = p.workDir
              targetEncodedDir = p.encodedDir
              break
            }
          }
          if (!histSessionId) { showToast('Session 不存在'); break }
        } else if (sessionIndex) {
          // 编号只看当前活跃项目（activeProject）
          const proj = projects.value.find(p => p.workDir === activeProject.value)
          if (!proj) { showToast('请先切换到目标项目'); break }
          const idx = Math.max(0, Math.min((Number(sessionIndex) || 1) - 1, (proj.sessions?.length || 1) - 1))
          const s = proj.sessions?.[idx]
          if (!s) { showToast('Session 编号不存在'); break }
          histSessionId = s.id
          targetProjectPath = proj.workDir
          targetEncodedDir = proj.encodedDir
        } else {
          showToast('请指定 Session 编号或 ID'); break
        }

        expandedProjects.value.add(targetProjectPath)
        activeProject.value = targetProjectPath
        await handleNewSession(targetProjectPath, targetEncodedDir, histSessionId)
        showToast(`已切换会话 ${histSessionId.slice(0, 8)}`)
        break
      }
      case 'new_session': {
        // 新建 session：不指定项目 → 用当前活跃项目；指定 → 查找匹配项目
        const { projectPath, projectName, encodedDir, label } = args
        let resolvedPath = projectPath
        let resolvedEncoded = encodedDir
        let resolvedLabel = label
        if (!resolvedPath && projectName) {
          const pn = projectName.toLowerCase()
          let exact: any = null, partial: any = null
          for (const p of projects.value) {
            const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
            if (dn.toLowerCase() === pn) { exact = p; break }
            if (!partial && (dn.toLowerCase().includes(pn) || (p.workDir || '').toLowerCase().includes(pn))) {
              partial = p
            }
          }
          const match = exact || partial
          if (match) {
            resolvedPath = match.workDir; resolvedEncoded = match.encodedDir
            resolvedLabel = (match.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
          }
        }
        // 没指定项目也没有 projectPath → 用桌面端当前活跃项目
        if (!resolvedPath && activeProject.value) {
          const ap = projects.value.find(p => p.workDir === activeProject.value)
          if (ap) { resolvedPath = ap.workDir; resolvedEncoded = ap.encodedDir; resolvedLabel = (ap.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '' }
        }
        if (!resolvedPath) { showToast('请先打开一个项目，或指定：/ns <项目>'); break }
        expandedProjects.value.add(resolvedPath)
        activeProject.value = resolvedPath
        await handleNewSession(resolvedPath, resolvedEncoded || '')
        showToast(t('ws.nudgeNewSession', { label: resolvedLabel || '' }))
        break
      }
      case 'stop': {
        // 停止当前活跃标签页的 agent
        const tab = tabSessions.value.find(t => t.id === activeTabId.value)
        if (tab?.websocket && tab.websocket.readyState === WebSocket.OPEN) {
          tab.websocket.send(JSON.stringify({ type: 'stop_generation' }))
          showToast('已发送停止指令')
        }
        break
      }
      case 'toggle_mirror': {
        const { platform, enabled } = args
        if (platform && typeof enabled === 'boolean') {
          mirrorState.value[platform] = enabled
          try { localStorage.setItem(`bridge-mirror-${platform}`, enabled ? '1' : '0') } catch {}
          showToast(enabled ? t('ws.mirrorOnToast') : t('ws.mirrorOffToast'))
        }
        break
      }
    }
  } catch (e) {
    // 静默：nudge 操作失败不阻塞
  }
}

/** 加载历史会话的消息记录（恢复会话时展示，仅文本角色，不含思考/工具） */
async function loadHistory(encodedDir: string, sId: string) {
  try {
    const res = await fetch(`${GW}/api/projects/${encodedDir}/sessions/${sId}/messages`)
    const data = await res.json()
    if (data.messages?.length) {
      messages.value.push({role: 'system', text: t('sys.history', {n: data.messages.length}), time: Date.now()})
      for (const m of data.messages) {
        messages.value.push({role: m.role, text: m.text, time: new Date(m.time).getTime()})
      }
    }
  } catch {
  }
  scrollDown()
}

/** 控制通道 WebSocket：不绑定 session，启动即连，接收 IM nudge 事件 */
let controlWS: WebSocket | null = null
function connectControlWS() {
  if (controlWS && controlWS.readyState === WebSocket.OPEN) return
  controlWS = new WebSocket('ws://127.0.0.1:3456/ws/control')
  controlWS.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'nudge') handleNudge(msg)
    } catch {}
  }
  controlWS.onclose = () => { controlWS = null; setTimeout(connectControlWS, 5000) }
  controlWS.onerror = () => { controlWS?.close() }
}

/**
 * 建立 WebSocket 连接并注册消息处理。
 * resumed=true 时连接提示文本不同（"恢复会话" vs "新会话"）。
 * WebSocket 生命周期：onopen 标记 connected，onmessage 分发到各 type 处理分支，onclose/onerror 重置状态。
 * 注意：ws 是模块级非响应式变量（let），避免 Vue Proxy 干扰 WebSocket 原生事件。
 */
function connectWS(sid: string, resumed = false) {
  if (ws) ws.close()
  ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sid}`)

  // 闭包捕获: 此 WS 所属的 tab 标识，防止异步回调污染其他 tab
  const mySid = sid
  const myTabId = activeTabId.value
  const myProject = activeTab.value?.label || ''

  /** 判断此 WS 的 tab 是否当前前台 */
  const isFg = () => sessionId.value === mySid

  ws.onopen = () => {
    const tab = tabSessions.value.find(t => t.id === myTabId)
    if (tab) tab.state.connected = true
    if (isFg()) {
      connected.value = true
      syncPetState('connected', { message: 'Connected', bubble: petPick(BUBBLE_CONNECTED, myProject) })
      const label = resumed
          ? t('sys.connectedResume', {id: sid.slice(0, 8)})
          : t('sys.connected', {id: sid.slice(0, 8)})
      messages.value.push({role: 'system', text: label, time: Date.now()})
      scrollDown()
    }
  }

  ws.onmessage = (e) => {
    const tab = tabSessions.value.find(t => t.id === myTabId)
    if (!tab) return  // 标签页已关闭

    const fg = isFg()

    // 后台标签页: 保存当前前台状态 → 将全局 ref 指向 tab 快照 → 处理完后恢复
    let _saved: TabState | null = null
    if (!fg) {
      _saved = snapshotTabState()
      restoreTabState(tab.state)
      _swappingTab = true
    }

    const msg = JSON.parse(e.data)
    switch (msg.type) {
      case 'system_init':
        // 模型初始化信息：显示当前使用的模型和工作目录
        messages.value.push({role: 'system', text: t('sys.model', {model: msg.model, cwd: msg.cwd}), time: Date.now()})
        break

      case 'assistant_message': {
        // AI 回复：遍历 content 数组，text 块渲染为 assistant 气泡，
        // thinking 块累计到 turnThinkingText 并渲染为可展开思考块
        const tools = pendingTools.value.length > 0 ? [...pendingTools.value] : undefined
        pendingTools.value = []
        for (const block of msg.message?.content || []) {
          if (block.type === 'text' && block.text) {
            messages.value.push({role: 'assistant', text: block.text, time: Date.now(), tools})
          } else if (block.type === 'thinking' && block.thinking) {
            turnThinkingText += block.thinking  // 累计本轮思考文本, result 时估算思考 token
            messages.value.push({
              role: 'thinking',
              text: t('ws.thinkContent'),
              time: Date.now(),
              thinkingContent: block.thinking,
              expanded: false,
            })
            // 宠物气泡：思考内容摘要
            const bubbleText = block.thinking.slice(0, 80).replace(/\n/g, ' ')
            if (fg) syncPetState('thinking', { bubble: petPick(BUBBLE_THINKING, myProject) + bubbleText + '...' })
          }
        }
        break
      }

      case 'tool_use_start': {
        // 工具调用开始：记录工具名、ID、输入参数，等待后续 assistant_message 关联
        pendingTools.value.push({
          tool_name: msg.tool_name,
          tool_use_id: msg.tool_use_id,
          input: msg.input || {},
          elapsed: 0,
        })
        // 同步更新运行中 agent 的进度文字
        const running = agentRuns.value.find(a => a.status === 'running')
        if (running) {
          running.currentTool = msg.tool_name
          running.currentToolElapsed = 0
          running.progress = msg.tool_name
        }
        const toolMsgs: Record<string, string[]> = {
          Read: ['主人，让我看看{proj}的这个文件~','主人，我瞅瞅{proj}的文件','让我读一下{proj}的这个','{proj}的文件我看看','我瞧瞧{proj}的这个文件'],
          Write: ['主人，我来写点{proj}的东西！','让我来给{proj}写代码','{proj}的文件交给我写','帮{proj}写下代码','我来给{proj}生成文件'],
          Edit: ['主人，这里改一下{proj}的就好~','帮{proj}改改代码','让我修一下{proj}的','给{proj}的代码做个微调','帮{proj}修正一下'],
          Bash: ['主人，我来跑个{proj}的命令！','帮{proj}执行命令','让我跑一下{proj}的脚本','给{proj}跑个命令','执行{proj}的终端指令'],
          Grep: ['主人，帮{proj}搜一下内容~','帮{proj}搜索关键词','让我在{proj}里面找找','帮{proj}搜搜代码','{proj}的内容我搜一下'],
          Glob: ['主人，帮{proj}查找文件~','帮{proj}找文件','让我在{proj}里面翻翻文件','{proj}的文件我找找','帮{proj}搜搜文件名'],
          WebFetch: ['主人，帮{proj}上网查查资料~','帮{proj}抓取网页内容','让我帮{proj}去网上看看','给{proj}抓取个链接','帮{proj}查看网页'],
          WebSearch: ['主人，帮{proj}搜一下资料！','帮{proj}搜索网络','让我帮{proj}网上搜一下','给{proj}搜索相关信息','帮{proj}查查最新资料'],
          TaskCreate: ['主人，帮{proj}记个任务~','给{proj}新建任务','帮{proj}创建待办','{proj}的任务我记下了','给{proj}加个任务'],
        }
        const defaults = toolMsgs[msg.tool_name]
        const toolBubble = defaults ? defaults[Math.floor(Math.random() * defaults.length)].replace(/\{proj\}/g, myProject) : petPick(BUBBLE_TOOL_GENERIC, myProject) + `，我用一下 ${msg.tool_name}`
        if (fg) syncPetState('tool_use', { toolName: msg.tool_name, message: `${msg.tool_name}`, bubble: toolBubble })
        break
      }

      case 'tool_progress': {
        // 工具执行进度：更新对应工具的耗时（秒）
        const t = pendingTools.value.find(x => x.tool_use_id === msg.tool_use_id)
        if (t) t.elapsed = Math.round(msg.elapsed_time_seconds || 0)
        // 同步到运行中 agent
        const running = agentRuns.value.find(a => a.status === 'running')
        if (running && running.currentTool === (t?.tool_name || running.currentTool)) {
          running.currentToolElapsed = t?.elapsed || 0
          running.progress = (t?.tool_name || running.currentTool) + ' · ' + (t?.elapsed || 0) + 's'
        }
        break
      }

      case 'content_block_stop': {
        // 工具执行完成：更新最终耗时
        const t = pendingTools.value.find(x => x.tool_use_id === msg.index)
        if (t) t.elapsed = msg.elapsed?.elapsed_time_seconds || t.elapsed
        break
      }

      case 'user_message_echo': {
        // resume 时 SDK 会重放历史用户消息（防止重复显示）
        const text = typeof msg.message?.content === 'string'
            ? msg.message.content
            : msg.message?.content?.map((b: any) => b.type === 'text' ? b.text : '').join(' ') || ''
        if (text.trim()) {
          messages.value.push({role: 'user', text: text.trim(), time: Date.now()})
        }
        break
      }

      case 'connected':
        // Gateway 确认连接，已在 onopen 中处理
        break
        // 注：下面的代码是 dead code（break 后不可达），保留但注释说明
        messages.value.push({
          role: 'thinking',
          text: t('ws.thinking'),
          time: Date.now(),
          thinkingId: msg.index,
          thinkingContent: msg.thinking || '',
          expanded: false,
        })
        break

      case 'thinking_delta': {
        // 思考增量：追加到对应 thinkingId 的消息 thinkingContent 末尾
        const tm = [...messages.value].reverse().find(m => m.role === 'thinking' && m.thinkingId === msg.index)
        if (tm) tm.thinkingContent = (tm.thinkingContent || '') + (msg.thinking || '')
        break
      }

      case 'content_block_stop': {
        // 思考块结束：将标签文本改为"思考完成"
        const tmm = [...messages.value].reverse().find(m => m.role === 'thinking' && m.thinkingId === msg.index)
        if (tmm) tmm.text = t('ws.thinkDone')
        break
      }

      case 'text_delta':
        // 文本增量（流式输出中间片段），当前界面不逐字显示，忽略
        break

      case 'message_start':
        // resume 时捕获初始上下文 token 数（只有第一轮 total===0 时记录，避免重复覆盖）
        if (msg.usage?.input_tokens && usage.value.total === 0) {
          usage.value.input = msg.usage.input_tokens
          usage.value.total = msg.usage.input_tokens
          contextPercent.value = Math.min(100, Math.round(usage.value.total / (maxTokens / 100)))
          saveUsage()
        }
        break

      case 'remote_user_message':
        // IM 平台（微信/飞书/钉钉）注入的消息，前缀标注来源后插入对话流
        turnThinkingText = ''
        const srcName = {wechat: '微信', feishu: '飞书', dingtalk: '钉钉'}[msg.source] || msg.source
        messages.value.push({role: 'user', text: `[${srcName}] ${msg.content}`, time: Date.now()})
        status.value = 'thinking'
        if (fg) nextTick(() => scrollDown())
        break

      case 'permission_request':
        // 后台 tab 的权限确认不弹 UI 横幅，避免污染前台
        if (!fg) break
        // Claude 请求工具执行权限 → 弹出确认横幅
        pendingPermission.value = {
          requestId: msg.requestId,
          toolName: msg.toolName,
          summary: permInputSummary(msg.input)
        }
        break

      case 'choice_request': {
        // 后台 tab 的选择请求不弹 UI 横幅
        if (!fg) break
        // Claude 请求多选项选择 → 弹出选择横幅
        const q = msg.questions?.[0] || {}
        pendingChoice.value = {
          requestId: msg.requestId,
          question: q.question || t('ws.choose'),
          options: q.options || []
        }
        break
      }

      case 'confirmation_resolved':
        // 另一通道（如微信）已处理该确认请求 → 关闭本地弹框，避免重复操作
        if (pendingPermission.value?.requestId === msg.requestId) pendingPermission.value = null
        if (pendingChoice.value?.requestId === msg.requestId) pendingChoice.value = null
        break

      case 'result': {
        // 一轮对话完成：清算 token 消耗、费用、刷新记录点和文件树
        pendingTools.value = []
        const inp = msg.usage?.input_tokens || 0
        const rawOut = msg.usage?.output_tokens || 0
        // 思考 token: SDK 不单独拆分, 用本轮思考文本估算; 纯输出 = 总输出 - 思考(下限 0)
        const think = Math.min(rawOut, estimateThinkingTokens(turnThinkingText))
        const pureOut = Math.max(0, rawOut - think)
        messages.value.push({
          role: 'system',
          text: t('sys.done', {turns: msg.num_turns, ms: msg.duration_ms, in: inp, think, out: pureOut}),
          time: Date.now(),
        })
        if (msg.usage) {
          usage.value.input = inp
          usage.value.thinking = think
          usage.value.output = pureOut
          usage.value.total = inp + rawOut  // context 占用按真实总量(含思考)
          contextPercent.value = Math.min(100, Math.round(usage.value.total / (maxTokens / 100)))
          const cost = (inp / 1e6) * PRICE_INPUT + (rawOut / 1e6) * PRICE_OUTPUT  // 费用按真实总输出(思考也计费)
          costTotal.value += cost
          saveUsage()  // 持久化本轮累计 token/费用，resume 后可恢复
          loadBalance()
          checkCostLimit()  // 费用达余额阈值时提醒一次
        }
        status.value = 'idle'
        if (fg) {
          syncPetState('success', { message: 'Done!', bubble: petPick(BUBBLE_SUCCESS, myProject) })
          setTimeout(() => { syncPetState('idle'); petBubble.value = '' }, 3000)
          // AI 改完文件后即时刷新：记录点始终刷新，文件树仅面板打开时（节省请求）
          loadCheckpoints()
          if (showFilePanel.value) loadFileTree()
        }
        break
      }

      case 'error':
        // SDK 错误：清空待处理工具，显示错误消息
        pendingTools.value = []
        messages.value.push({role: 'error', text: msg.message, time: Date.now()})
        status.value = 'idle'
        if (fg) {
          syncPetState('error', { message: msg.message?.slice(0, 40), bubble: petPick(BUBBLE_ERROR_SDK, myProject) + (msg.message?.slice(0, 50) || '') })
          setTimeout(() => { syncPetState('idle'); petBubble.value = '' }, 3000)
        }
        break

        // ── 子 Agent 事件（内联卡片追踪）──
      case 'subagent_spawning': {
        agentRuns.value.push({
          id: msg.agentType || 'unknown',
          agentType: msg.agentType || 'unknown',
          description: msg.description || '',
          status: 'spawning',
          spawnTime: msg.ts || Date.now(),
          startTime: 0, doneTime: 0,
          progress: '',
          source: 'native',
          currentTool: '',
          currentToolElapsed: 0,
        })
        break
      }

      case 'subagent_start': {
        const tgt = msg.agentType || msg.agentId
        let found = false
        for (const ag of agentRuns.value) {
          if (ag.agentType === tgt && ag.status === 'spawning') {
            ag.status = 'running';
            ag.startTime = msg.ts || Date.now()
            if (msg.agentId) ag.id = msg.agentId
            found = true;
            break
          }
        }
        // bypass 模式无 canUseTool → 无 subagent_spawning → 直接创建 entry
        if (!found) {
          agentRuns.value.push({
            id: msg.agentId || tgt,
            agentType: tgt,
            description: msg.description || '',
            status: 'running',
            spawnTime: msg.ts || Date.now(),
            startTime: msg.ts || Date.now(),
            doneTime: 0,
            progress: '',
            source: 'native',
            currentTool: '',
            currentToolElapsed: 0,
          })
        }
        break
      }

      case 'subagent_done': {
        const tgt = msg.agentType || msg.agentId
        for (const ag of agentRuns.value) {
          if (ag.source === 'native' && ag.status === 'running' && (ag.id === tgt || ag.agentType === tgt)) {
            ag.status = 'done';
            ag.doneTime = msg.ts || Date.now()
            if (msg.transcriptPath) ag.transcriptPath = msg.transcriptPath
            break
          }
        }
        break
      }

        // ── Workflow 事件 ──
      case 'workflow_started':
      case 'workflow_resumed':
        wfRunState.value = {
          name: msg.name, status: 'running', phases: msg.phases || [], currentPhase: '',
          logs: [], agents: [], tokenSpent: 0, wfId: msg.workflowId,
        }
        showWfPanel.value = true
        break

      case 'workflow_phase':
        if (wfRunState.value) {
          wfRunState.value.currentPhase = msg.phase
          wfRunState.value.phases = msg.phases || wfRunState.value.phases
        }
        break

      case 'workflow_log':
        if (wfRunState.value) {
          wfRunState.value.logs.push({
            time: Date.now(),
            phase: msg.phase || wfRunState.value.currentPhase,
            msg: msg.message
          })
          if (wfRunState.value.logs.length > 100) wfRunState.value.logs = wfRunState.value.logs.slice(-100)
          const agInfo = parseWfAgentLog(msg.message)
          if (agInfo) {
            const existing = wfRunState.value.agents.find(a => a.id === agInfo.id)
            if (existing) {
              existing.status = agInfo.status
            } else {
              wfRunState.value.agents.push(agInfo)
            }
            // Mirror 到内联 agentRuns（带进度文字）
            const run = agentRuns.value.find(a => a.id === agInfo.id && a.source === 'workflow')
            if (run) {
              run.status = agInfo.status
              run.progress = msg.message
              if (agInfo.status === 'done') run.doneTime = Date.now()
              if (agInfo.status === 'running' && !run.startTime) run.startTime = Date.now()
            } else {
              agentRuns.value.push({
                id: agInfo.id, agentType: agInfo.label, description: '',
                status: agInfo.status, spawnTime: Date.now(),
                startTime: agInfo.status === 'running' ? Date.now() : 0,
                doneTime: agInfo.status === 'done' ? Date.now() : 0,
                progress: msg.message, source: 'workflow',
              })
            }
          }
        }
        break

      case 'workflow_done':
        if (wfRunState.value) {
          wfRunState.value.status = 'done'
          wfRunState.value.tokenSpent = msg.tokenSpent || 0
        }
        // 标记所有 workflow source 的 running agent 为 done
        for (const ag of agentRuns.value) {
          if (ag.source === 'workflow' && ag.status === 'running') {
            ag.status = 'done';
            ag.doneTime = Date.now()
          }
        }
        break

      case 'workflow_paused':
        if (wfRunState.value) {
          wfRunState.value.status = 'paused'
        }
        break

      case 'workflow_error':
        if (wfRunState.value) {
          wfRunState.value.status = 'error'
        }
        break

      case 'nudge':
        handleNudge(msg)
        break
    }

    if (!fg) {
      // 后台标签页: 写回 tab 快照 → 恢复前台全局状态
      tab.state = snapshotTabState()
      restoreTabState(_saved!)
      _swappingTab = false
    } else {
      nextTick(() => scrollDown())
    }
  }

  ws.onclose = () => {
    const tab = tabSessions.value.find(t => t.id === myTabId)
    if (tab) tab.state.connected = false
    if (isFg()) {
      connected.value = false; status.value = 'idle'
      syncPetState('disconnected', { bubble: petPick(BUBBLE_DISCONNECTED, myProject) })
    }
  }
  ws.onerror = () => {
    const tab = tabSessions.value.find(t => t.id === myTabId)
    if (tab) tab.state.connected = false
    if (isFg()) {
      connected.value = false
      syncPetState('error', { message: 'Connection error', bubble: petPick(BUBBLE_ERROR_CONN, myProject) })
      setTimeout(() => syncPetState('disconnected'), 3000)
    }
  }
}

// ── 消息气泡操作：复制 / 回填到输入框 ──
/** 最近一次被点击"复制"的消息索引（用于切换图标为对勾，1.2 秒后恢复） */
const copiedIndex = ref(-1)

/** 复制消息文本到剪贴板，并短暂显示对勾图标作为反馈 */
async function copyBubble(text: string, i: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedIndex.value = i
    setTimeout(() => {
      if (copiedIndex.value === i) copiedIndex.value = -1
    }, 1200)
  } catch {
  }
}

/** 将消息文本回填到输入框，并自动聚焦和调整 textarea 高度 */
function refillBubble(text: string) {
  inputText.value = text
  nextTick(() => {
    const ta = document.querySelector('.input-wrapper textarea') as HTMLTextAreaElement | null
    if (ta) {
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px'
    }
  })
}

// ═══════════════════════════════════════════
// ── IM 平台镜像开关 ──
// 三平台（微信/飞书/钉钉）独立开关。
// 开启后，所有 AI 回复回合自动同步到对应 IM 平台。
// 偏好保存在 localStorage（bridge-mirror-{platform}），跨会话持久化。
// ═══════════════════════════════════════════
/** 支持的 IM 平台基础配置（label 通过 i18n 动态获取，确保中英切换生效） */
const IM_PLATFORMS = [
  {id: 'wechat', ms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', color: '#07C160'},
  {
    id: 'feishu',
    ms: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    color: '#3370FF'
  },
  {
    id: 'dingtalk',
    ms: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 11-3 11h18s-3-4-3-11"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    color: '#0089FF'
  },
]
/** IM 平台列表（带 i18n 标签），模板 v-for 用此而非 IM_PLATFORMS */
const imPlatformLabels = computed(() => IM_PLATFORMS.map(p => ({...p, label: t('im.' + p.id)})))
/** 各平台镜像开关状态（从 localStorage 恢复，默认关闭） */
const mirrorState = ref<Record<string, boolean>>(
    Object.fromEntries(IM_PLATFORMS.map(p => [p.id, (() => {
      try {
        return localStorage.getItem(`bridge-mirror-${p.id}`) === '1'
      } catch {
        return false
      }
    })()]))
)
/** 各平台是否已绑定账号（由 Gateway adapter 状态决定） */
const imBound = ref<Record<string, boolean>>(Object.fromEntries(IM_PLATFORMS.map(p => [p.id, false])))

/** 从 Gateway 加载各 IM 平台的绑定状态 */
async function loadIMStatus() {
  try {
    const r = await fetch(`${GW}/api/config/adapters`)
    if (r.ok) {
      const d = await r.json()
      for (const p of d.platforms || []) {
        imBound.value[p.id] = p.hasAccount === true
      }
    }
  } catch {
  }
}

/** 从 Gateway 加载当前 session 的镜像开关状态 */
async function loadSessionMirrors() {
  if (!sessionId.value) return
  try {
    const r = await fetch(`${GW}/api/sessions/${sessionId.value}/mirror`)
    if (r.ok) {
      const d = await r.json()
      if (d.mirrors) {
        for (const p of IM_PLATFORMS) {
          if (typeof d.mirrors[p.id] === 'boolean') mirrorState.value[p.id] = d.mirrors[p.id]
        }
      }
    }
  } catch {}
}

/** 通知 Gateway 设置指定平台的镜像开关（session 级标志） */
async function setMirror(platform: string, enabled: boolean) {
  if (!sessionId.value) return
  try {
    await fetch(`${GW}/api/sessions/${sessionId.value}/mirror`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({platform, enabled}),
    })
  } catch {}
}

/** 切换镜像开关：更新本地状态 → Gateway → toast 提示 */
function toggleMirror(platform: string) {
  if (!imBound.value[platform]) return
  mirrorState.value[platform] = !mirrorState.value[platform]
  try { localStorage.setItem(`bridge-mirror-${platform}`, mirrorState.value[platform] ? '1' : '0') } catch {}
  setMirror(platform, mirrorState.value[platform])
  showToast(mirrorState.value[platform] ? t('ws.mirrorOnToast') : t('ws.mirrorOffToast'))
}

/** 判断指定平台镜像是否已激活（用于按钮高亮样式） */
function mirrorActive(platform: string) {
  return mirrorState.value[platform]
}

/** 镜面状态圆点 CSS 类：active 实心 / inactive 空心 / unbound 灰色 */
function mirrorDotClass(platform: string) {
  if (!imBound.value[platform]) return 'unbound'
  if (mirrorState.value[platform]) return 'active'
  return 'inactive'
}

/**
 * 点击上下文圆环 → 执行 /compact 压缩上下文。
 * 注意：/context 只查看用量不压缩，此处用的是 /compact。
 * 仅在全景区非 thinking 状态时允许执行。
 */
function runCompact() {
  if (!ws || ws.readyState !== 1) {
    showToast(t('ws.notConnected'));
    return
  }
  if (status.value === 'thinking') {
    showToast(t('ws.thinkingWait'));
    return
  }
  doSend('/compact')
}

/**
 * 发送消息主入口：
 * - 如果 Claude 正在 thinking：将消息放入队列（不会丢失），清空输入框
 * - 如果空闲：直接 dispatch 发送
 */
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text) return
  if (!ws || ws.readyState !== 1) return

  if (status.value === 'thinking') {
    // thinking 期间输入进入排队队列，用户可稍后手动选择发送/注入
    queueId++
    msgQueue.value.push({id: queueId, text, time: Date.now()})
    inputText.value = ''
    nextTick(() => scrollDown(true))
    return
  }

  // 上传所有未上传的附件
  if (pendingAttachments.value.length > 0 && sessionId.value) {
    await Promise.all(pendingAttachments.value.map(a => uploadAttachment(a, sessionId.value!)))
  }
  inputText.value = ''
  await dispatch(text)
}

// ── Prompt 模板库 ──
const svgI = (d: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const promptTemplates = ref([
  { label: 'Code Review', svg: svgI('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'), text: '请对以下代码进行全面审查，重点关注：线程安全、资源泄露、空引用、边界条件、SQL性能。' },
  { label: '重构', svg: svgI('<path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>'), text: '请重构以下代码，保持功能不变：提取重复逻辑、命名清晰化、遵循单一职责原则。' },
  { label: '解释代码', svg: svgI('<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z"/>'), text: '请用中文详细解释下面代码的每一行逻辑和整体设计思路。' },
  { label: '写测试', svg: svgI('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'), text: '为以下代码编写完整的单元测试，覆盖正常流程、边界条件、异常路径。' },
  { label: '修 Bug', svg: svgI('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'), text: '以下代码有 bug，请分析根因并给出修复方案。' },
  { label: '优化性能', svg: svgI('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'), text: '请分析以下代码的性能瓶颈并提出优化建议，重点关注：内存分配、算法复杂度、缓存策略。' },
])
const showTemplateBar = computed(() => promptTemplates.value.length > 0 && inputText.value.length === 0)

function applyTemplate(template: typeof promptTemplates.value[number]) {
  inputText.value = template.text + '\n\n'
  nextTick(() => {
    const ta = document.querySelector('.input-wrapper textarea') as HTMLTextAreaElement | null
    if (ta) { ta.focus(); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
  })
}

/** 附件路径注入前缀（在 buildWireText 中复用） */
async function buildAttachmentPrefix(): Promise<string> {
  if (pendingAttachments.value.length === 0 || !sessionId.value) return ''
  // 等待上传完成
  await Promise.all(pendingAttachments.value.map(a => {
    if (!a.uploadedPath && !a.uploading) return uploadAttachment(a, sessionId.value!)
    return null
  }))
  const uploaded = pendingAttachments.value.filter(a => a.uploadedPath)
  const withOcr = uploaded.filter(a => (a as any).ocrText)
  const pathsOnly = uploaded.filter(a => !(a as any).ocrText)
  pendingAttachments.value = []

  let prefix = ''
  if (withOcr.length) {
    prefix += `[系统] 用户粘贴了 ${withOcr.length} 张截图，已通过 OCR 识别内容如下:\n\n`
    for (const a of withOcr) {
      prefix += `===== 截图: ${a.uploadedPath} =====\n${(a as any).ocrText}\n\n`
    }
  }
  if (pathsOnly.length) {
    prefix += `[系统] 用户发送了 ${pathsOnly.length} 个附件:\n${pathsOnly.map(a => `- ${a.uploadedPath}`).join('\n')}\n\n`
  }
  return prefix
}

/**
 * 构建实际发送给模型的文本（wire text）：
 * - @agent 引用：生成 Task 子代理调用指令
 * - #文件 引用：从 Gateway 读取文件内容并注入到消息前缀
 * - 文件注入有总量上限（fileInjectLimitKB），超限截断并提示
 * 如果没有引用，直接返回原文。
 */
async function buildWireText(text: string): Promise<string> {
  if (!sessionId.value) return text
  // @agent 引用：要求模型用 Task 工具调对应 subagent（@ 可紧跟文字）
  const agentRefs = [...new Set([...text.matchAll(/@([a-zA-Z0-9_-]+)/g)].map(m => m[1]))]
  // #文件 引用：带上文件内容（# 可紧跟文字）
  const fileRefs = [...new Set([...text.matchAll(/#([^\s#]+)/g)].map(m => m[1]))]

  let prefix = ''
  // ── 附件前缀 ──
  const attachmentPrefix = await buildAttachmentPrefix()
  if (attachmentPrefix) prefix += attachmentPrefix
  if (agentRefs.length) {
    prefix += `请使用以下子代理(subagent)来完成本次任务（通过 Task 工具，subagent_type 取对应名称）：${agentRefs.join(', ')}\n\n`
  }
  if (fileRefs.length && fileInjectLimitKB.value > 0) {
    const MAX_INJECT = fileInjectLimitKB.value * 1024  // 注入文件内容总量上限(字符)，设置页可配
    const blocks: string[] = []
    let injected = 0
    let skipped = 0
    for (const p of fileRefs) {
      if (injected >= MAX_INJECT) {
        skipped++;
        continue
      }  // 已超总量，剩余文件跳过
      try {
        const res = await fetch(`${GW}/api/sessions/${sessionId.value}/file?path=${encodeURIComponent(p)}`)
        if (!res.ok) continue
        const d = await res.json()
        if (d.binary || typeof d.content !== 'string') continue
        let content = d.content as string
        if (injected + content.length > MAX_INJECT) {
          content = content.slice(0, MAX_INJECT - injected) + '\n...[内容过长已截断，请用 Read 工具读取完整文件]'
        }
        injected += content.length
        blocks.push(`===== 引用文件: ${p} =====\n${content}`)
      } catch {
      }
    }
    if (blocks.length) {
      const note = skipped > 0 ? `（另有 ${skipped} 个引用文件因总量超限未注入，请按需用 Read 工具读取）\n\n` : ''
      prefix += `以下是用户引用的当前项目文件内容，请先阅读这些文档再回答：\n\n${blocks.join('\n\n')}\n\n${note}`
    }
  }
  if (!prefix) return text
  return `${prefix}===== 用户消息 =====\n${text}`
}

/**
 * 消息分发：构建 wire text（含文件引用内容），界面显示用户原文，实际发送 wire 版本。
 * 这样用户在界面上看到的是简洁的 `#文件名` 引用，但模型收到的是含文件内容的完整消息。
 */
async function dispatch(text: string) {
  const wire = await buildWireText(text)
  doSend(text, wire)
}

/**
 * 底层 WebSocket 发送：标记 thinking 状态，记录用户原文（用于取消时回填），推送消息。
 * wire 为注入引用文件内容后的版本，若未提供则直接用原文。
 */
function doSend(text: string, wire?: string) {
  status.value = 'thinking'
  lastUserMessage = text
  turnThinkingText = ''  // 新一轮开始: 清空本轮思考文本累计，result 时重新估算
  clearAgentRuns()       // 新一轮开始: 清空上一轮的 agent 运行卡片
  // resume 走 SDK，claude.exe 自带完整历史，无需前端手动注入 <context>
  messages.value.push({role: 'user', text, time: Date.now()})  // 界面显示用户原文
  ws!.send(JSON.stringify({
    type: 'user_message',
    content: wire ?? text,
    permissionMode: permissionMode.value,
    thinkingLevel: thinkingLevel.value
  }))
  nextTick(() => scrollDown(true))
}

/**
 * 取消当前任务：发送 stop_generation 指令，重置状态，回填用户原文到输入框。
 * 这样用户无需重新输入即可调整后重试。
 */
function cancelTask() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({type: 'stop_generation'}))
  }
  status.value = 'idle'
  if (lastUserMessage) {
    inputText.value = lastUserMessage
    lastUserMessage = ''
  }
  messages.value.push({role: 'system', text: t('ws.taskCanceled'), time: Date.now()})
  nextTick(() => scrollDown(true))
}

// ── 双通道权限确认响应 ──
/** 用户点击允许/拒绝后，回传 decision 给 Gateway，插入系统消息记录操作 */
function respondPermission(decision: 'allow' | 'deny') {
  const p = pendingPermission.value;
  if (!p) return
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({
    type: 'permission_response',
    requestId: p.requestId,
    decision
  }))
  messages.value.push({
    role: 'system',
    text: decision === 'allow' ? t('ws.allowed', {tool: p.toolName}) : t('ws.denied', {tool: p.toolName}),
    time: Date.now()
  })
  pendingPermission.value = null
  nextTick(() => scrollDown(true))
}

/** 用户选择方案后，回传 optionIndex 给 Gateway */
function respondChoice(optionIndex: number) {
  const c = pendingChoice.value;
  if (!c) return
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({
    type: 'choice_response',
    requestId: c.requestId,
    questionIndex: 0,
    optionIndex
  }))
  messages.value.push({
    role: 'system',
    text: t('ws.chose', {label: c.options[optionIndex]?.label || optionIndex}),
    time: Date.now()
  })
  pendingChoice.value = null
  nextTick(() => scrollDown(true))
}

// ── 消息队列操作 ──
/** 发送排队消息：从队列移除后正常 dispatch（此时 status 已变为 idle） */
function sendQueued(item: QItem) {
  msgQueue.value = msgQueue.value.filter(q => q.id !== item.id)
  dispatch(item.text)
}

/** 从队列中移除某条消息（用户主动取消） */
function removeQueued(item: QItem) {
  msgQueue.value = msgQueue.value.filter(q => q.id !== item.id)
}

/**
 * 立即注入补充指令：在 thinking 期间直接追加到当前流中。
 * SDK session.send() 支持多轮，无需等待当前回复完成即可追发。
 */
function injectNow(item: QItem) {
  msgQueue.value = msgQueue.value.filter(q => q.id !== item.id)
  if (ws && ws.readyState === 1) {
    dispatch(item.text)
    messages.value.push({role: 'system', text: t('ws.injected'), time: Date.now()})
  }
}

// ═══════════════════════════════════════════
// ── 斜杠命令自动补全（/）──
// 输入 / 弹出所有可用斜杠命令，支持模糊搜索、上下键选择、Enter/Tab 确认。
// 仅在整行输入是 `/命令名`（尚未输入空格/参数）时匹配，避免干扰正常聊天文本。
// ═══════════════════════════════════════════
interface SlashCmd {
  name: string;
  description?: string;
  argumentHint?: string
}

/** 所有可用斜杠命令列表（从 Gateway /api/config/commands 加载） */
const slashCommands = ref<SlashCmd[]>([])
/** 命令补全菜单是否可见 */
const showCmdMenu = ref(false)
/** 当前高亮的命令索引（上下键循环导航） */
const cmdIndex = ref(0)
/** 命令菜单 DOM 引用（用于自动滚动高亮项至可视区） */
const cmdMenuEl = ref<HTMLElement | null>(null)

/** 从 Gateway 加载斜杠命令列表 */
async function loadSlashCommands() {
  try {
    const res = await fetch(`${GW}/api/config/commands`)
    if (res.ok) {
      const d = await res.json();
      slashCommands.value = d.commands || []
    }
  } catch {
  }
}

/** 模糊匹配的命令列表：仅当整条输入是 `/命令名`（未输空格/参数）时匹配，最多 50 条 */
const cmdMatches = computed<SlashCmd[]>(() => {
  const m = inputText.value.match(/^\/([a-zA-Z0-9_-]*)$/)
  if (!m) return []
  const q = m[1].toLowerCase()
  return slashCommands.value.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 50)
})

/** 选中命令 → 填入输入框（末尾自动加空格，方便接参数） */
function applyCommand(c: SlashCmd) {
  inputText.value = '/' + c.name + ' '
  showCmdMenu.value = false
}

// ═══════════════════════════════════════════
// ── # 文件引用补全 ──
// 输入 # 弹出当前项目文件列表，支持模糊路径搜索。
// # 可紧跟在文字后面无需空格（如 "请查看#README"）。
// 选中后替换末尾 #片段 为完整路径。
// ═══════════════════════════════════════════
/** 当前项目的文件列表（从 Gateway 懒加载） */
const mentionFiles = ref<{ path: string }[]>([])
/** 文件补全菜单是否可见 */
const showFileMenu = ref(false)
/** 当前高亮的文件索引 */
const fileIndex = ref(0)
/** 文件菜单 DOM 引用 */
const fileMenuEl = ref<HTMLElement | null>(null)

/** 懒加载当前项目的文件列表 */
async function loadMentionFiles() {
  if (!sessionId.value) return
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/files`)
    if (res.ok) {
      const d = await res.json();
      mentionFiles.value = (d.files || []).map((f: any) => ({path: f.path}))
    }
  } catch {
  }
}

/** 模糊匹配的文件列表：匹配输入行末尾的 #路径片段，最多 50 条 */
const fileMatches = computed<{ path: string }[]>(() => {
  const m = inputText.value.match(/#([^\s#]*)$/)
  if (!m) return []
  const q = m[1].toLowerCase()
  return mentionFiles.value.filter(f => f.path.toLowerCase().includes(q)).slice(0, 50)
})

/** 选中文件 → 替换末尾 #片段 为完整路径，末尾自动加空格便于继续输入 */
function applyFile(f: { path: string }) {
  inputText.value = inputText.value.replace(/#[^\s#]*$/, '#' + f.path + ' ')
  showFileMenu.value = false
}

// ═══════════════════════════════════════════
// ── @ Agent 引用补全 ──
// 输入 @ 弹出已创建的 Task 子代理列表。
// 选中后插入 @agent名称，模型收到后会通过 Task 工具调用对应 subagent。
// ═══════════════════════════════════════════
/** 已创建的子代理列表 */
const mentionAgents = ref<{ name: string; description?: string }[]>([])
/** agent 补全菜单是否可见 */
const showAgentMenu = ref(false)
/** 当前高亮的 agent 索引 */
const agentIndex = ref(0)
/** agent 菜单 DOM 引用 */
const agentMenuEl = ref<HTMLElement | null>(null)

/** 从 Gateway 加载已创建的子代理列表 */
async function loadMentionAgents() {
  try {
    const res = await fetch(`${GW}/api/config/agents`)
    if (res.ok) {
      const d = await res.json();
      mentionAgents.value = (d.agents || []).map((a: any) => ({name: a.name, description: a.description}))
    }
  } catch {
  }
}

/** 模糊匹配的 agent 列表：匹配输入行末尾的 @名称片段，最多 50 条 */
const agentMatches = computed<{ name: string; description?: string }[]>(() => {
  const m = inputText.value.match(/@([a-zA-Z0-9_-]*)$/)
  if (!m) return []
  const q = m[1].toLowerCase()
  return mentionAgents.value.filter(a => (a.name || '').toLowerCase().includes(q)).slice(0, 50)
})

/** 选中 agent → 替换末尾 @名称 */
function applyAgent(a: { name: string }) {
  inputText.value = inputText.value.replace(/@[a-zA-Z0-9_-]*$/, '@' + a.name + ' ')
  showAgentMenu.value = false
}

/**
 * 监听输入文本变化，自动决定展开哪个补全菜单。
 * 三个菜单互斥：命令（/ 整行匹配）> 文件（# 末尾匹配）> agent（@ 末尾匹配）。
 * 文件列表和 agent 列表均采用懒加载策略（首次触发匹配时才请求 API）。
 */
watch(inputText, () => {
  const isCmd = /^\/[a-zA-Z0-9_-]*$/.test(inputText.value) && cmdMatches.value.length > 0
  showCmdMenu.value = isCmd
  if (isCmd) cmdIndex.value = 0
  const fileTok = /#[^\s#]*$/.test(inputText.value)
  if (fileTok && mentionFiles.value.length === 0) loadMentionFiles()  // 懒加载文件列表
  showFileMenu.value = !isCmd && fileTok && fileMatches.value.length > 0
  if (showFileMenu.value) fileIndex.value = 0
  const agentTok = /@[a-zA-Z0-9_-]*$/.test(inputText.value)
  if (agentTok && mentionAgents.value.length === 0) loadMentionAgents()  // 懒加载 agent 列表
  showAgentMenu.value = !isCmd && !showFileMenu.value && agentTok && agentMatches.value.length > 0
  if (showAgentMenu.value) agentIndex.value = 0
})

/**
 * 三个 watch 监听各菜单的高亮索引变化，自动将高亮项滚动到可视区域。
 * 使用 nextTick 确保 v-for 渲染完成后再查询 DOM。
 */
watch(cmdIndex, () => {
  nextTick(() => cmdMenuEl.value?.querySelector('.cmd-item.active')?.scrollIntoView({block: 'nearest'}))
})
watch(fileIndex, () => {
  nextTick(() => fileMenuEl.value?.querySelector('.cmd-item.active')?.scrollIntoView({block: 'nearest'}))
})
watch(agentIndex, () => {
  nextTick(() => agentMenuEl.value?.querySelector('.cmd-item.active')?.scrollIntoView({block: 'nearest'}))
})

/**
 * textarea 键盘事件处理：三阶段优先级
 * 1. 命令菜单打开 → 上下键导航 / Enter/Tab 确认 / Esc 关闭
 * 2. 文件菜单打开 → 同上
 * 3. agent 菜单打开 → 同上
 * 4. 无菜单时：Enter 发送消息，Shift+Enter 换行（浏览器默认）
 */
function handleKeydown(e: KeyboardEvent) {
  // 命令菜单打开时优先处理导航键
  if (showCmdMenu.value && cmdMatches.value.length) {
    const n = cmdMatches.value.length
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdIndex.value = (cmdIndex.value + 1) % n;
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdIndex.value = (cmdIndex.value - 1 + n) % n;
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyCommand(cmdMatches.value[cmdIndex.value]);
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showCmdMenu.value = false;
      return
    }
  }
  // 文件菜单打开时处理导航键
  if (showFileMenu.value && fileMatches.value.length) {
    const n = fileMatches.value.length
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      fileIndex.value = (fileIndex.value + 1) % n;
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      fileIndex.value = (fileIndex.value - 1 + n) % n;
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyFile(fileMatches.value[fileIndex.value]);
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showFileMenu.value = false;
      return
    }
  }
  // agent 菜单打开时处理导航键
  if (showAgentMenu.value && agentMatches.value.length) {
    const n = agentMatches.value.length
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      agentIndex.value = (agentIndex.value + 1) % n;
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      agentIndex.value = (agentIndex.value - 1 + n) % n;
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyAgent(agentMatches.value[agentIndex.value]);
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showAgentMenu.value = false;
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
  // Shift+Enter = 换行 (默认行为)
}

/**
 * 消息区域滚动事件：检测用户是否手动离开底部。
 * 距底部 >50px 视为"用户上滑查看历史"，抑制任务执行中的自动回滚。
 */
function onMessagesScroll() {
  if (!chatRef.value) return
  const el = chatRef.value
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  userScrolledUp.value = dist > 50
}

/**
 * 滚动消息区域到底部。
 * 使用双层 nextTick 确保 Vue 渲染完成 + DOM 高度已更新后再滚动。
 * （单层 nextTick 可能在 v-for 中新元素插入后 scrollHeight 尚未更新）
 * @param force 忽略用户滚动位置，强制执行（用户主动操作时传 true）
 */
function scrollDown(force?: boolean) {
  if (force) userScrolledUp.value = false
  nextTick(() => {
    nextTick(() => {
      if (chatRef.value && (force || !userScrolledUp.value)) {
        chatRef.value.scrollTop = chatRef.value.scrollHeight
      }
    })
  })
}

// ═══════════════════════════════════════════
// ── 文件快照 Diff 面板 ──
// 右侧栏展示工作目录文件变更树，支持文件预览和 Diff 对比。
// 文件树由扁平 FlatFile 数组构建为嵌套树结构，目录默认折叠。
// ═══════════════════════════════════════════

/** 切换文件面板可见性，首次打开时加载文件树 */
function toggleFilePanel() {
  showFilePanel.value = !showFilePanel.value
  if (showFilePanel.value && fileList.value.length === 0) loadFileTree()
}

/** 从 Gateway 加载当前会话的文件列表和快照状态，增量同步到文件树 */
async function loadFileTree() {
  if (!sessionId.value) return
  fileTreeLoading.value = true
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/files`)
    if (res.ok) {
      const d = await res.json()
      syncFileTree(d.files || [])
      hasSnapshot.value = !!d.hasSnapshot
      snapshotAt.value = d.snapshotAt || null
      fileTruncated.value = !!d.truncated
      fileMissing.value = !!d.missing
    }
  } catch {
  }
  fileTreeLoading.value = false
}

/**
 * ── 文件树增量缓存 ──
 * 文件列表变更时先检查是否同一文件集（仅状态更新），是则跳过树重建仅更新文件引用；
 * 文件集变化（新增/删除文件）时全量重建。目录索引 dirIndex 提供 O(1) 节点查找。
 */
const treeCache = ref<TreeNode[]>([])
let dirIndex = new Map<string, TreeNode>()        // path → TreeNode（含目录），O(1) 查找
let filePathSetPrev = new Set<string>()           // 上一轮的文件路径集合，用于快速检测文件集变化

function buildFullTree(files: FlatFile[]): TreeNode[] {
  dirIndex = new Map()
  const root: TreeNode = {name: '', path: '', isDir: true, children: []}
  for (const f of files) {
    const segs = f.path.split('/')
    let node = root
    let prefix = ''
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      prefix = prefix ? prefix + '/' + seg : seg
      const isLeaf = i === segs.length - 1
      if (isLeaf) {
        const leaf: TreeNode = {name: seg, path: f.path, isDir: false, file: f}
        node.children!.push(leaf)
        dirIndex.set(f.path, leaf)
      } else {
        let child = dirIndex.get(prefix)
        if (!child) {
          child = {name: seg, path: prefix, isDir: true, children: []}
          node.children!.push(child)
          dirIndex.set(prefix, child)
        }
        node = child
      }
    }
  }
  const sortRec = (n: TreeNode) => {
    if (!n.children) return
    n.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root.children!
}

/** 增量同步文件列表到缓存的树结构，同时更新 fileList 供外部引用 */
function syncFileTree(files: FlatFile[]) {
  fileList.value = files
  const newSet = new Set(files.map(f => f.path))
  const sameFiles = filePathSetPrev.size === newSet.size
    && [...filePathSetPrev].every(p => newSet.has(p))

  if (treeCache.value.length === 0 || !sameFiles) {
    // 首次加载或文件集变化 → 全量重建
    treeCache.value = buildFullTree(files)
  } else {
    // 同一文件集，仅状态更新 → 遍历 dirIndex 更新文件引用
    const newMap = new Map(files.map(f => [f.path, f] as const))
    for (const [path, node] of dirIndex) {
      if (!node.isDir && node.file) {
        const updated = newMap.get(path)
        if (updated && (node.file.status !== updated.status || node.file.added !== updated.added || node.file.removed !== updated.removed)) {
          node.file = updated
        }
      }
    }
  }
  filePathSetPrev = newSet
}

/**
 * ── treeRoot ──
 * 从 treeCache 应用 fileFilter 过滤，不重建树结构。
 */
const treeRoot = computed<TreeNode[]>(() => {
  if (fileFilter.value === 'changed') {
    // 递归过滤：仅保留有变更的子树，目录若无变更子节点则整棵移除
    const filterRec = (nodes: TreeNode[]): TreeNode[] => {
      const out: TreeNode[] = []
      for (const n of nodes) {
        if (n.isDir) {
          const filtered = n.children ? filterRec(n.children) : []
          if (filtered.length > 0) out.push({...n, children: filtered})
        } else if (n.file && n.file.status !== 'unchanged') {
          out.push(n)
        }
      }
      return out
    }
    return filterRec(treeCache.value)
  }
  return treeCache.value
})

/**
 * 将嵌套树 + expandedDirs 展平为带缩进深度的可见线性行。
 * 只遍历已展开目录的子节点，未展开目录的子节点被跳过。
 * 这避免了虚拟滚动/大量 DOM 节点的性能问题。
 */
const visibleRows = computed(() => {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({node: n, depth})
      if (n.isDir && expandedDirs.value.has(n.path) && n.children) walk(n.children, depth + 1)
    }
  }
  walk(treeRoot.value, 0)
  return out
})

/** 切换目录展开/折叠（不可变更新 Set 以触发 Vue 响应式） */
function toggleDir(path: string) {
  const s = new Set(expandedDirs.value)
  s.has(path) ? s.delete(path) : s.add(path)
  expandedDirs.value = s
}

/** 文件状态 → 徽章标签和 CSS 类（A=新增 / M=修改 / D=删除） */
function statusBadge(status: FileStatus) {
  if (status === 'added') return {label: 'A', cls: 'a'}
  if (status === 'modified') return {label: 'M', cls: 'm'}
  if (status === 'deleted') return {label: 'D', cls: 'd'}
  return null
}

/** 消息区委托点击：拦截 .md-link 链接。文件路径 → 打开内联预览弹窗；外部 URL → 浏览器 */
function onMessageClick(e: MouseEvent) {
  const target = (e.target as HTMLElement).closest('.md-link') as HTMLAnchorElement | null
  if (!target) return
  e.preventDefault()
  const href = target.getAttribute('href') || ''
  // URL 不含协议（相对/绝对本地路径）→ 打开内联文件预览
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    openFileByPath(href)
    return
  }
  // 外部链接 → 用 Electron shell 打开（有则用 electronAPI，否则 window.open）
  e.stopPropagation()
  const api = (window as any).electronAPI
  if (api?.openExternal) {
    api.openExternal(href);
    return
  }
  window.open(href, '_blank', 'noopener')
}

/** 通过文件路径打开内联预览 modal（非文件树点击，而是消息中的链接点击） */
async function openFileByPath(filePath: string) {
  modalMode.value = 'file';
  modalPath.value = filePath;
  modalLoading.value = true
  modalFileContent.value = '';
  modalFileBinary.value = false
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/file?path=${encodeURIComponent(filePath)}`)
    const d = await res.json()
    if (d.binary) {
      modalFileBinary.value = true;
      modalFileContent.value = ''
    } else if (res.ok) modalFileContent.value = d.content || ''
    else modalFileContent.value = `[无法加载: ${d.error || res.status}]`
  } catch (e: any) {
    modalFileContent.value = `[加载失败: ${e.message || e}]`
  }
  modalLoading.value = false
}

/** 打开文件内容预览 modal（二进制文件和已删除文件禁止预览） */
async function openFileModal(f: FlatFile) {
  if (f.binary || f.status === 'deleted') return
  modalMode.value = 'file';
  modalPath.value = f.path;
  modalLoading.value = true
  modalFileContent.value = '';
  modalFileBinary.value = false
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/file?path=${encodeURIComponent(f.path)}`)
    const d = await res.json()
    if (d.binary) modalFileBinary.value = true
    else if (res.ok) modalFileContent.value = d.content || ''
    else modalFileContent.value = `[无法加载: ${d.error || res.status}]`
  } catch (e: any) {
    modalFileContent.value = `[加载失败: ${e.message || e}]`
  }
  modalLoading.value = false
}

/** 打开文件 Diff modal（二进制文件不支持 diff） */
async function openDiffModal(f: FlatFile) {
  if (f.binary) return
  modalMode.value = 'diff';
  modalPath.value = f.path;
  modalLoading.value = true;
  modalDiff.value = null
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/diff?path=${encodeURIComponent(f.path)}`)
    const d = await res.json()
    modalDiff.value = res.ok ? d : {path: f.path, status: 'error', lines: []}
  } catch {
    modalDiff.value = {path: f.path, status: 'error', lines: []}
  }
  modalLoading.value = false
}

/** 关闭文件/diff modal。文件模式有未保存内容时弹确认框 */
function closeModal() {
  if (modalMode.value === 'file' && modalDirty.value) {
    pendingUnsaved.value = true
    return
  }
  doCloseModal()
}

function doCloseModal() {
  pendingUnsaved.value = false
  modalDirty.value = false
  try {
    if (diffOriginalModel) { diffOriginalModel.dispose(); diffOriginalModel = null }
    if (diffModifiedModel) { diffModifiedModel.dispose(); diffModifiedModel = null }
    monacoDiffEditor.value?.dispose()
  } catch {}
  monacoDiffEditor.value = null
  try { monacoEditor.value?.dispose() } catch {}
  monacoEditor.value = null
  cachedEditorContent = ''
  modalMode.value = null
  modalDiff.value = null
  modalFileContent.value = ''
}

// ═══════════════════════════════════════════
// ── Monaco Editor 集成 ──
// 每次打开 modal 新建编辑器，关闭时 dispose。dispose 在 DOM 还活着时调用，
// 不会触发 Monaco 的 ResizeObserver 0x0 卡死 bug。
// ═══════════════════════════════════════════

/** Monaco 主题 */
function monacoTheme(): 'vs' | 'vs-dark' {
  return document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark'
}

/** 扩展名 → Monaco language ID */
function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.jsonc': 'json',
    '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.vue': 'html', '.svg': 'xml', '.xml': 'xml', '.axaml': 'xml',
    '.md': 'markdown', '.mdx': 'markdown',
    '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.go': 'go',
    '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.c': 'c', '.cpp': 'cpp',
    '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.ps1': 'powershell',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini',
    '.sql': 'sql', '.graphql': 'graphql', '.php': 'php', '.lua': 'lua',
    '.r': 'r', '.dart': 'dart', '.proto': 'protobuf', '.tf': 'terraform',
    '.dockerfile': 'dockerfile', '.bat': 'bat', '.cmake': 'cmake',
  }
  return map[ext] || 'plaintext'
}

function reconstructDiffTexts(lines: DiffLine[]) {
  const oldLines: string[] = [], newLines: string[] = []
  for (const line of lines) {
    if (line.type === 'context' || line.type === 'del') oldLines.push(line.text)
    if (line.type === 'context' || line.type === 'add') newLines.push(line.text)
  }
  return {oldText: oldLines.join('\n'), newText: newLines.join('\n')}
}

/** 数据加载完成 + modalMode 非空时创建 Monaco 编辑器 */
watch([modalMode, modalLoading], async ([mode, loading]) => {
  if (!mode || loading) return
  // 双 tick：等 v-if 挂载 DOM → 等浏览器 layout 完成
  await nextTick()
  await nextTick()
  const container = monacoContainer.value
  if (!container || container.offsetHeight === 0) return

  if (mode === 'file' && modalFileContent.value && !modalMarkdown.value) {
    // 先清旧实例：DOM 存活时 dispose 安全，不会触发 0x0 ResizeObserver
    try { monacoDiffEditor.value?.dispose() } catch {}
    monacoDiffEditor.value = null
    try { monacoEditor.value?.dispose() } catch {}
    monacoEditor.value = null

    const editor = monaco.editor.create(container, {
      value: modalFileContent.value,
      language: detectLanguage(modalPath.value),
      theme: monacoTheme(),
      minimap: {enabled: false},
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      fontSize: 16,
      lineHeight: 26,
      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      wordWrap: 'on',
      tabSize: 2,
    })
    cachedEditorContent = modalFileContent.value
    modalDirty.value = false
    const model = editor.getModel()
    if (model) {
      model.onDidChangeContent(() => {
        modalDirty.value = true
        try { cachedEditorContent = model.getValue() } catch {}
      })
    }
    monacoEditor.value = editor
  } else if (mode === 'diff' && modalDiff.value?.lines?.length) {
    // 先清旧实例：DOM 存活时 dispose 安全
    try { monacoEditor.value?.dispose() } catch {}
    monacoEditor.value = null
    try {
      // diffEditor.dispose 不会清理外部 createModel 的 model，手动清理
      if (diffOriginalModel) { diffOriginalModel.dispose(); diffOriginalModel = null }
      if (diffModifiedModel) { diffModifiedModel.dispose(); diffModifiedModel = null }
      monacoDiffEditor.value?.dispose()
    } catch {}
    monacoDiffEditor.value = null

    const {oldText, newText} = reconstructDiffTexts(modalDiff.value.lines)
    const lang = detectLanguage(modalPath.value)
    const diffEditor = monaco.editor.createDiffEditor(container, {
      theme: monacoTheme(),
      readOnly: true,
      minimap: {enabled: false},
      scrollBeyondLastLine: false,
      fontSize: 16,
      lineHeight: 26,
      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      renderSideBySide: true,
      originalEditable: false,
    })
    diffEditor.setModel({
      original: (diffOriginalModel = monaco.editor.createModel(oldText, lang)),
      modified: (diffModifiedModel = monaco.editor.createModel(newText, lang)),
    })
    monacoDiffEditor.value = diffEditor
  }
})

/** 保存文件到 Gateway */
function doSave() {
  const sid = sessionId.value
  const path = modalPath.value
  if (!sid || modalMode.value !== 'file' || !path) return
  const content = cachedEditorContent
  fetch(`${GW}/api/sessions/${sid}/save-and-snapshot`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({path, content}),
  }).then(async res => {
    if (res.ok) {
      modalDirty.value = false
      showToast(t('ws.fileSaved', {path}))
      loadFileTree()
      loadCheckpoints()
    } else {
      const d = await res.json().catch(() => ({} as any))
      showToast(t('err.saveFail', {msg: d.error || String(res.status)}), 4000)
    }
  }).catch((e: any) => {
    showToast(t('err.saveFail', {msg: e.message || String(e)}), 4000)
  })
}

// ── 定时器 visibility 暂停/恢复 ──
// 窗口隐藏（最小化/托盘）时停掉所有定时器，恢复时重启。
// 子定时器启动/停止函数为外部闭包变量，此处直接引用。
function resumeTimers() {
  if (!sessionDurationTimer && sessionStartTime.value) startSessionDurationTimer()
  if (!tabAutoSyncTimer && activeTabId.value) tabAutoSyncTimer = setInterval(syncCurrentTabState, 5000)
  if (!agentRefreshTimer && agentRuns.value.some(a => a.status === 'running')) {
    agentRefreshTimer = setInterval(() => { agentRuns.value = [...agentRuns.value] }, 1000)
  }
}
function pauseTimers() {
  if (sessionDurationTimer) { clearInterval(sessionDurationTimer); sessionDurationTimer = null }
  if (tabAutoSyncTimer) { clearInterval(tabAutoSyncTimer); tabAutoSyncTimer = null }
  if (agentRefreshTimer) { clearInterval(agentRefreshTimer); agentRefreshTimer = null }
}
function onPageVisibility() {
  if (document.hidden) {
    pauseTimers()
  } else {
    resumeTimers()
  }
}
document.addEventListener('visibilitychange', onPageVisibility)

// 组件卸载时清理 Monaco 实例及外部 model
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onPageVisibility)
  if (tabAutoSyncTimer) clearInterval(tabAutoSyncTimer)
  if (sessionDurationTimer) clearInterval(sessionDurationTimer)
  if (petTimer) clearTimeout(petTimer)
  try {
    if (diffOriginalModel) { diffOriginalModel.dispose(); diffOriginalModel = null }
    if (diffModifiedModel) { diffModifiedModel.dispose(); diffModifiedModel = null }
    monacoDiffEditor.value?.dispose()
  } catch {}
  try { monacoEditor.value?.dispose() } catch {}
})

// ═══════════════════════════════════════════
// ── 记录点（Checkpoint）时间线 ──
// AI 每轮改完文件后自动保存记录点，用户可以：
// 1. 查看历史记录点及其变更文件
// 2. 回退（rewind）到某个记录点，恢复当时的工作目录状态
// 3. 提交修改（commit），将当前状态设为新基线并清空记录点
// ═══════════════════════════════════════════

/** 从 Gateway 加载记录点列表（最新在上，reverse 反转顺序） */
async function loadCheckpoints() {
  if (!sessionId.value) return
  checkpointsLoading.value = true
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/checkpoints`)
    if (res.ok) {
      const d = await res.json();
      checkpoints.value = (d.checkpoints || []).slice().reverse()
    }  // 最新在上
  } catch {
  }
  checkpointsLoading.value = false
}

/** 切换单个记录点的展开/折叠（不可变更新 Set） */
function toggleCp(id: string) {
  const s = new Set(expandedCp.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expandedCp.value = s
}

/** 点击"撤销到此记录点" → 弹出二次确认弹窗（仅 revertible 的记录点可回退） */
function askRewind(cp: Checkpoint) {
  if (cp.revertible) pendingRewind.value = cp
}

/** 确认后执行回退：调用 Gateway rewind API 写回工作目录文件，然后刷新文件树和记录点列表 */
async function confirmRewind() {
  const cp = pendingRewind.value
  if (!cp || !sessionId.value) return
  rewinding.value = true
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/rewind`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({checkpointId: cp.id}),
    })
    const d = await res.json()
    if (res.ok && d.ok) {
      const base = t('sys.reverted', {prompt: cp.prompt.slice(0, 30), n: d.reverted?.length || 0})
      messages.value.push({
        role: 'system',
        text: base + (d.blocked?.length ? t('sys.revertedSkip', {n: d.blocked.length}) : ''),
        time: Date.now()
      })
      await Promise.all([loadFileTree(), loadCheckpoints()])
    } else {
      messages.value.push({role: 'error', text: t('err.revertFail', {msg: d.error || res.status}), time: Date.now()})
    }
  } catch (e: any) {
    messages.value.push({role: 'error', text: t('err.revertFail', {msg: e.message || e}), time: Date.now()})
  }
  rewinding.value = false
  pendingRewind.value = null
}

/** 切换记录点下拉框：先加载数据再展开 */
async function toggleCpDropdown() {
  if (showCpDropdown.value) {
    closeCpDropdown();
    return
  }
  await loadCheckpoints()
  showCpDropdown.value = true
}

/** 关闭记录点下拉框 */
function closeCpDropdown() {
  showCpDropdown.value = false
}

// ── 提交修改（Commit）──
/** 提交操作进行中（防重复点击） */
const committing = ref(false)
/** 提交确认弹窗开关 */
const pendingCommit = ref(false)

/** 点击"提交修改"按钮 → 先关下拉框（避免遮罩残留挡住输入框），弹自定义确认框 */
function commitChanges() {
  if (!sessionId.value) return
  showCpDropdown.value = false
  pendingCommit.value = true
}

/** 确认后执行提交：调用 Gateway commit API 将当前状态定为新基线并清空记录点 */
async function confirmCommit() {
  if (!sessionId.value) {
    pendingCommit.value = false;
    return
  }
  committing.value = true
  try {
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/commit`, {method: 'POST'})
    const d = await res.json()
    if (res.ok && d.ok) {
      messages.value.push({role: 'system', text: t('sys.committed', {n: d.fileCount}), time: Date.now()})
      await Promise.all([loadCheckpoints(), loadFileTree()])
    } else {
      messages.value.push({role: 'error', text: t('err.commitFail', {msg: d.error || res.status}), time: Date.now()})
    }
  } catch (e: any) {
    messages.value.push({role: 'error', text: t('err.commitFail', {msg: e.message || e}), time: Date.now()})
  }
  committing.value = false
  pendingCommit.value = false
}

// ── 选择性提交（文件面板）──
/** 文件选择提交弹窗开关 */
const pendingCommitFiles = ref(false)
/** 提交弹窗中已选中的文件路径集合 */
const commitFileSelection = ref<Set<string>>(new Set())
/** 提交弹窗文件过滤：'all' / 'changed' */
const commitFileFilter = ref<'all' | 'changed'>('changed')

/** 变更文件列表（提交弹窗用） */
const changedFilesForCommit = computed(() => {
  return fileList.value.filter(f => f.status !== 'unchanged')
})

/** 提交弹窗中展示的文件列表（根据过滤条件） */
const commitFilesVisible = computed(() => {
  return commitFileFilter.value === 'changed' ? changedFilesForCommit.value : fileList.value
})

/** 打开文件选择提交弹窗：预选所有变更文件 */
function openCommitFilesDialog() {
  if (!sessionId.value) return
  commitFileSelection.value = new Set(changedFilesForCommit.value.map(f => f.path))
  commitFileFilter.value = 'changed'
  pendingCommitFiles.value = true
}

/** 切换提交弹窗中单个文件的选中状态 */
function toggleCommitFile(path: string) {
  const s = new Set(commitFileSelection.value)
  s.has(path) ? s.delete(path) : s.add(path)
  commitFileSelection.value = s
}

/** 全选/取消全选当前可见的文件 */
function selectAllCommitFiles() {
  commitFileSelection.value = new Set(commitFilesVisible.value.map(f => f.path))
}
function deselectAllCommitFiles() {
  commitFileSelection.value = new Set()
}

/** 确认选择性提交 */
async function confirmCommitFiles() {
  if (!sessionId.value) { pendingCommitFiles.value = false; return }
  committing.value = true
  try {
    const files = [...commitFileSelection.value]
    const res = await fetch(`${GW}/api/sessions/${sessionId.value}/commit`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({files}),
    })
    const d = await res.json()
    if (res.ok && d.ok) {
      const kept = d.keptCheckpoints
      const msg = kept != null
          ? t('sys.committedSelective', {n: d.fileCount, kept})
          : t('sys.committed', {n: d.fileCount})
      messages.value.push({role: 'system', text: msg, time: Date.now()})
      await Promise.all([loadCheckpoints(), loadFileTree()])
    } else {
      messages.value.push({role: 'error', text: t('err.commitFail', {msg: d.error || res.status}), time: Date.now()})
    }
  } catch (e: any) {
    messages.value.push({role: 'error', text: t('err.commitFail', {msg: e.message || e}), time: Date.now()})
  }
  committing.value = false
  pendingCommitFiles.value = false
}

/** 从路径中提取最后一级目录名（用于侧栏项目卡片标题显示） */
function dirName(dir: string) {
  const parts = dir.replace(/\\/g, '/').split('/')
  const last = parts[parts.length - 1]
  return last || dir
}

/** 时间戳 → 相对时间文本（刚刚 / n分钟前 / n小时前 / n天前） */
function timeAgo(ms: number) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60000) return t('time.now')
  if (diff < 3600000) return t('time.min', {n: Math.floor(diff / 60000)})
  if (diff < 86400000) return t('time.hour', {n: Math.floor(diff / 3600000)})
  return t('time.day', {n: Math.floor(diff / 86400000)})
}

/** 时间戳 → HH:mm 格式（系统消息的时间标签） */
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})
}

/** 切换侧栏项目的展开/折叠状态 */
function toggleProject(workDir: string) {
  const s = new Set(expandedProjects.value)
  if (s.has(workDir)) s.delete(workDir)
  else s.add(workDir)
  expandedProjects.value = s
}

// ═══════════════════════════════════════════
// ── 控制栏：模型选择 / 权限模式 / 思考等级 ──
// ═══════════════════════════════════════════

/** 当前选中的模型 ID（默认值，会被 settings 覆盖） */
const model = ref('deepseek-v4-pro')
/** 可用的模型列表（由 loadProviderModels 动态填充） */
const models = ref<string[]>(['deepseek-v4-pro', 'deepseek-v4-flash'])
/** 权限模式：default=每次询问 / acceptEdits=自动接受编辑 / plan=仅规划 / bypassPermissions=全部允许 */
const permissionMode = ref('default')
/** 权限模式选项（i18n 计算属性，支持语言切换） */
const permissions = computed(() => [
  {value: 'default', label: t('perm.default'), desc: 'Ask'},
  {value: 'acceptEdits', label: t('perm.acceptEdits'), desc: 'Edits'},
  {value: 'plan', label: t('perm.plan'), desc: 'Plan'},
  {value: 'bypassPermissions', label: t('perm.bypass'), desc: 'Auto'},
])
/** 思考等级：控制 Claude 的 thinking effort，auto 为自适应 */
const thinkingLevel = ref('auto')
/** 思考等级选项（i18n 计算属性） */
const thinkings = computed(() => [
  {value: 'auto', label: t('think.auto')},
  {value: 'off', label: t('think.off')},
  {value: 'low', label: t('think.low')},
  {value: 'medium', label: t('think.medium')},
  {value: 'high', label: t('think.high')},
  {value: 'xhigh', label: t('think.xhigh')},
  {value: 'max', label: t('think.max')},
])

// ═══════════════════════════════════════════
// ── Token 消耗与上下文统计 ──
// ═══════════════════════════════════════════

/** 上下文占用百分比（用于圆环可视化），计算公式：total / maxTokens * 100 */
const contextPercent = ref(0)
/** 本轮 token 消耗明细：input=输入 / output=纯输出(不含思考) / thinking=思考估算 / total=总量(含思考) */
const usage = ref({input: 0, output: 0, thinking: 0, total: 0})
/** 模型最大上下文 token 数（用于百分比计算） */
const maxTokens = 1000000
/**
 * 本轮思考文本累计 —— SDK usage 不单独拆分 thinking（含在 output_tokens 内），
 * 因此需要在每次 thinking block / thinking_delta 时累计文本，
 * 在 result 时用 estimateThinkingTokens() 估算思考 token 数。
 */
let turnThinkingText = ''

/** token 友好格式：<1000 显示原始数值，>=1000 显示为 K 格式（如 1.5K） */
function fmtTok(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
}

/**
 * 估算思考 token 数（启发式算法）：
 * - CJK 字符（中日韩统一表意文字、假名、全角符号）：约 1 token/字
 * - 其他字符（英文、数字、ASCII 符号）：约 4 字符/token
 * 仅为估算值，界面展示时标记「~」前缀表示约数。
 */
function estimateThinkingTokens(text: string): number {
  if (!text) return 0
  let cjk = 0, other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    // Unicode 范围：中日韩统一表意 + 扩展A + CJK符号/假名/标点 + 全角字符
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x3000 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF)) cjk++
    else other++
  }
  return Math.round(cjk + other / 4)
}

// ═══════════════════════════════════════════
// ── 费用计算 ──
// ═══════════════════════════════════════════

/** 累计费用（美元），每轮 result 时累加 */
const costTotal = ref(0)
/** 输入 token 单价：$4 / 百万 token */
const PRICE_INPUT = 4
/** 输出 token 单价：$16 / 百万 token（思考也按输出价格计费） */
const PRICE_OUTPUT = 16

// ═══════════════════════════════════════════
// ── Toast 通知系统 ──
// 静默 toast：不插入对话流、不影响操作，自动消失。
// 用于镜像开关提示、费用阈值提醒、操作成功反馈等。
// ═══════════════════════════════════════════

/** toast 显示文本（空字符串 = 隐藏） */
const toastText = ref('')
/** toast 自动消失定时器 */
let toastTimer: any = null

/** 显示 toast（默认 3.5 秒后自动消失，重复调用会重置计时器） */
function showToast(text: string, ms = 3500) {
  toastText.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastText.value = ''
  }, ms)
}

// ═══════════════════════════════════════════
// ── 用户可配置参数 ──
// ═══════════════════════════════════════════

/** #文件注入总量上限（KB），设置页可配，默认 200KB */
const fileInjectLimitKB = ref(200)
/** 费用预警阈值：累计费用达到余额的百分之多少时提醒一次，设置页可配，默认 50% */
const costLimitPercent = ref(50)
/** 本轮会话是否已触发费用预警（确保只提醒一次） */
const costWarned = ref(false)

/**
 * 将 AI 输出的 Markdown 文本渲染为安全 HTML。
 * 支持：表格、代码块、行内代码、加粗、标题、无序列表。
 * 先对原始文本做 HTML 转义，再按 Markdown 规则替换，避免 XSS。
 */
function renderMarkdown(raw: string): string {
  // 0. 统一换行符为 \n（处理 Windows \r\n 和旧 Mac \r），避免后续 ^/$ 锚点匹配异常
  let html = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 1. HTML 转义（防止 XSS，确保用户输入不破坏 DOM 结构）
  html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  // 2. 代码块 ```...``` （必须先处理，保护代码内容不被后续规则误伤）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const langLabel = lang ? `<span class="md-code-lang">${lang}</span>` : ''
    return `<pre class="md-code">${langLabel}<code>${code.trim()}</code></pre>`
  })

  // 3. 行内代码 `...` （在 inline 规则之前，防止 code 内容被转义）
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>')

  // 4. 引用块 > （连续 > 开头的行合并为一个 blockquote）
  html = html.replace(/((?:^&gt; .*$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
        .map(l => l.replace(/^&gt; /, ''))
        .join('<br>')
    return `<blockquote class="md-blockquote">${lines}</blockquote>`
  })

  // 5. 有序列表 1. 2. 3. （内联格式化之前，让 li 内容能被后续 bold/italic 处理）
  // 用占位符保护 ol 块，防止步骤 6 的无序列表正则误吞 ol 内的 li
  const olBlocks: string[] = []
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="md-li-ol">$2</li>')
  html = html.replace(/((?:<li class="md-li-ol">.+<\/li>\n?)+)/g, (match) => {
    const html2 = match.replace(/md-li-ol/g, 'md-li')
    const idx = olBlocks.length
    olBlocks.push(`<ol class="md-ol">${html2}</ol>`)
    return `\x00OLBLOCK${idx}\x00`
  })

  // 6. 无序列表 - / * （内联格式化之前处理）
  html = html.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>')
  html = html.replace(/((?:<li class="md-li">.+<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>')

  // 恢复有序列表占位符
  html = html.replace(/\x00OLBLOCK(\d+)\x00/g, (_, idx) => olBlocks[parseInt(idx)])

  // 7. 标题 ### / ## / #
  html = html.replace(/^#### (.+)$/gm, '<h5 class="md-h">$1</h5>')
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h">$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h">$1</h3>')
  html = html.replace(/^# (.+)$/gm, '<h2 class="md-h">$1</h2>')

  // 8. 内联格式化（在表格之前，确保表格单元格内的样式也能生效）
  // 加粗 **...** / __...__ （必须在斜体之前，防止 *** 被拆解）
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')

  // 斜体 *...* / _..._ （在加粗之后，此时 ** 已被消耗）
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/\b_([^_]+)_\b/g, '<em>$1</em>')

  // 删除线 ~~...~~
  html = html.replace(/~~([^~]+)~~/g, '<del class="md-del">$1</del>')

  // 链接 [text](url) —— 不设 target，由消息区域的 delegated click 拦截来决定打开方式
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>')

  // 9. 水平线 ---
  html = html.replace(/^---+$/gm, '<hr class="md-hr">')

  // 10. Tab 分隔表格（连续至少 2 行均含 \t，且每行 tab 数一致）
  html = html.replace(/((?:^.+\t.+$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
    if (lines.length < 2) return block
    const tabCounts = lines.map(l => (l.match(/\t/g) || []).length)
    const maxTabs = Math.max(...tabCounts)
    if (maxTabs < 1) return block
    if (!tabCounts.every(n => n === maxTabs)) return block
    const cols = maxTabs + 1
    const renderRow = (cells: string[], tag: 'th' | 'td') => {
      const tds = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')
      return `<tr>${tds}</tr>`
    }
    const thead = renderRow(lines[0].split('\t').slice(0, cols), 'th')
    const tbody = lines.slice(1).map(l => renderRow(l.split('\t').slice(0, cols), 'td')).join('')
    return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  })

  // 11. 网格表格（+---+---+ 边框线 + | 内容行交替）
  html = html.replace(/((?:^[+|].+$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
    if (lines.length < 3) return block
    if (!lines.every(l => /^\+[-+=]+\+$/.test(l) || /^\|.+\|$/.test(l))) return block
    if (!lines.some(l => l.startsWith('+'))) return block
    if (!lines.some(l => l.startsWith('|'))) return block
    const dataRows = lines.filter(l => l.startsWith('|'))
    if (dataRows.length < 2) return block
    const renderRow = (cells: string[], tag: 'th' | 'td') => {
      const tds = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')
      return `<tr>${tds}</tr>`
    }
    const thead = renderRow(dataRows[0].split('|').slice(1, -1), 'th')
    const tbody = dataRows.slice(1).map(l => renderRow(l.split('|').slice(1, -1), 'td')).join('')
    return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  })

  // 12. 管道符表格（| col | col | 首尾有 |）—— 必须在无首尾管道符表格之前，
  //     否则更宽泛的正则 (步骤13) 会先吃掉匹配位置导致本步骤永远不触发
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
    if (lines.length < 2) return block
    const sepIdx = lines.findIndex(l => /^\|(\s*:?-+:?\s*\|)+\s*$/.test(l))
    if (sepIdx < 0) return block
    const headLines = lines.slice(0, sepIdx)
    const bodyLines = lines.slice(sepIdx + 1)
    const aligns = (lines[sepIdx].match(/:?-+:?/g) || []).map((a: string) => {
      if (a.startsWith(':') && a.endsWith(':')) return 'center'
      if (a.endsWith(':')) return 'right'
      return 'left'
    })
    const renderRow = (cells: string[], tag: 'th' | 'td') => {
      const tds = cells.map((c, i) => {
        const al = aligns[i] ? ` style="text-align:${aligns[i]}"` : ''
        return `<${tag}${al}>${c.trim()}</${tag}>`
      }).join('')
      return `<tr>${tds}</tr>`
    }
    const thead = headLines.map(l => renderRow(l.split('|').slice(1, -1), 'th')).join('')
    const tbody = bodyLines.map(l => renderRow(l.split('|').slice(1, -1), 'td')).join('')
    return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  })

  // 13. 无首尾管道符的 Markdown 表格（col | col\n--- | ---）
  html = html.replace(/((?:^.+\|.+$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
    if (lines.length < 2) return block
    const sepIdx = lines.findIndex(l => /^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\s*$/.test(l))
    if (sepIdx < 0) return block
    const headLines = lines.slice(0, sepIdx)
    const bodyLines = lines.slice(sepIdx + 1)
    if (headLines.length === 0) return block
    const aligns = (lines[sepIdx].match(/:?-+:?/g) || []).map((a: string) => {
      if (a.startsWith(':') && a.endsWith(':')) return 'center'
      if (a.endsWith(':')) return 'right'
      return 'left'
    })
    const renderRow = (cells: string[], tag: 'th' | 'td') => {
      const tds = cells.map((c, i) => {
        const al = aligns[i] ? ` style="text-align:${aligns[i]}"` : ''
        return `<${tag}${al}>${c.trim()}</${tag}>`
      }).join('')
      return `<tr>${tds}</tr>`
    }
    const thead = headLines.map(l => renderRow(l.split('|').map(c => c.trim()), 'th')).join('')
    const tbody = bodyLines.map(l => renderRow(l.split('|').map(c => c.trim()), 'td')).join('')
    return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  })

  // 14. 空格对齐表格（连续行，每行列间以 2+ 空格分隔，且列边界在所有行中对齐）
  html = html.replace(/((?:^[^\t|]+\s{2,}[^\t|]+$\n?)+)/gm, (block: string) => {
    const lines = block.trim().split('\n')
    if (lines.length < 2) return block
    const minLen = Math.min(...lines.map(l => l.length))
    const gaps: { start: number; end: number }[] = []
    for (let i = 0; i < minLen; i++) {
      if (lines.every(l => l[i] === ' ' && (i + 1 < l.length && l[i + 1] === ' '))) {
        let end = i
        while (end < minLen && lines.every(l => l[end] === ' ')) end++
        gaps.push({start: i, end})
        i = end
      }
    }
    if (gaps.length === 0) return block
    const splitRow = (line: string) => {
      const cells: string[] = []
      let pos = 0
      for (const g of gaps) {
        cells.push(line.slice(pos, g.start))
        pos = g.end
      }
      cells.push(line.slice(pos))
      return cells
    }
    const renderRow = (cells: string[], tag: 'th' | 'td') => {
      const tds = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')
      return `<tr>${tds}</tr>`
    }
    const thead = renderRow(splitRow(lines[0]), 'th')
    const tbody = lines.slice(1).map(l => renderRow(splitRow(l), 'td')).join('')
    return `<div class="md-table-wrap"><table class="md-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`
  })

  return html
}

/** 检查累计费用是否达到余额阈值，达到则静默 toast 提醒一次 */
function checkCostLimit() {
  const bal = balance.value.balance || 0
  if (bal <= 0 || costWarned.value || costLimitPercent.value <= 0) return
  const limit = bal * (costLimitPercent.value / 100)
  if (costTotal.value >= limit) {
    costWarned.value = true
    // 静默提示，不插入对话流
    showToast(t('ws.costToast', {cost: costTotal.value.toFixed(2), pct: costLimitPercent.value}), 5000)
  }
}

// ═══════════════════════════════════════════
// ── Token / 费用本地持久化 ──
// 按 sessionId 保存到 localStorage，restart/resume 后可恢复累计数据。
// key 格式：bridge-usage-{sessionId}
// ═══════════════════════════════════════════

/** 根据 sessionId 生成 localStorage key */
function usageKey(sid: string) {
  return `bridge-usage-${sid}`
}

/** SIDE_EFFECT: 将当前 token/费用/上下文占比写入 localStorage */
function saveUsage() {
  const sid = sessionId.value
  if (!sid) return
  try {
    localStorage.setItem(usageKey(sid), JSON.stringify({
      usage: usage.value,
      costTotal: costTotal.value,
      contextPercent: contextPercent.value
    }))
  } catch {
  }
}

/** 从 localStorage 恢复指定 session 的 token 累计和费用（具有默认值兜底） */
function loadUsage(sid: string) {
  try {
    const raw = localStorage.getItem(usageKey(sid));
    if (!raw) return
    const d = JSON.parse(raw)
    if (d.usage) usage.value = {input: 0, output: 0, thinking: 0, total: 0, ...d.usage}
    if (typeof d.costTotal === 'number') costTotal.value = d.costTotal
    if (typeof d.contextPercent === 'number') contextPercent.value = d.contextPercent
  } catch {
  }
}

/**
 * 上下文圆环悬浮 tooltip 的计算数据。
 * 包含：已用/总量、输入/思考(估算)/纯输出 token、本轮费用、累计费用、剩余余额。
 * 思考 token 标记 ~ 前缀表示估算值（因为 SDK 不单独拆分）。
 */
const tokenTooltip = computed(() => {
  const u = usage.value
  const rawOut = u.output + u.thinking  // 真实总输出 token(思考也计费, 故费用按此算)
  const costThisTurn = (u.input / 1e6) * PRICE_INPUT + (rawOut / 1e6) * PRICE_OUTPUT
  const bal = balance.value.balance || 0
  const remaining = bal - costTotal.value
  return {
    used: `${(u.total / 1000).toFixed(1)}K / ${(maxTokens / 1e6).toFixed(1)}M`,
    pct: ((u.total / maxTokens) * 100).toFixed(1) + '%',
    input: fmtTok(u.input),
    thinking: u.thinking > 0 ? '~' + fmtTok(u.thinking) : '—',
    output: fmtTok(u.output),
    costTurn: costThisTurn.toFixed(4),
    costTotal: costTotal.value.toFixed(4),
    remaining: Math.max(0, remaining).toFixed(2),
  }
})
</script>

<template>
  <div class="app">
    <!-- 侧栏：项目列表 + 会话管理 -->
    <SidebarLeft
      :search-text="projectSearch"
      :filtered-projects="filteredProjects"
      :visible-projects="visibleProjects"
      :expanded-projects="expandedProjects"
      :show-all-sessions="showAllSessions"
      :show-all-projects="showAllProjects"
      :active-project="activeProject"
      :active-session-id="activeSessionId"
      :connected="connected"
      :connecting="connecting"
      :gateway-version="gatewayVersion"
      :has-running-agent="hasAgentRuns && agentRuns.some(a => a.status === 'running' || a.status === 'spawning')"
      :running-agent-count="agentRuns.filter(a => a.status === 'running').length"
      :project-page-size="projectPageSize"
      :session-page-size="sessionPageSize"
      :hidden-projects="hiddenProjects"
      :filtered-hidden-projects="filteredHiddenProjects"
      :show-hidden-section="showHiddenSection"
      @go-settings="router.push('/settings')"
      @search="projectSearch = $event"
      @add-project="addProject"
      @load-projects="loadProjects"
      @toggle-project="toggleProject"
      @new-session="(workDir: string, encodedDir: string, sid?: string) => handleNewSession(workDir, encodedDir, sid)"
      @delete-session="deleteSession"
      @hide-project="hideProject"
      @show-project="showProject"
      @toggle-hidden-section="showHiddenSection = !showHiddenSection"
      @toggle-show-all="toggleShowAll"
      @toggle-show-all-projects="showAllProjects = !showAllProjects"
    />

    <!--
      主区域 (Main Area)：自适应宽度
      - 未连接时显示欢迎页
      - 连接后显示聊天界面：顶部状态栏 + 消息区 + 控制栏 + 输入区
    -->
    <div class="main-area">
      <!-- 宠物覆盖层：全窗口自由漫步 -->
      <div v-if="petEnabledGlob" class="pet-overlay">
        <PhaserPet
          :state="petState"
          :message="petMessage"
          :bubble="petBubble"
          :is-thinking="status === 'thinking'"
          :session-duration="sessionDurationMinutes"
          :pet-id="petId"
          @switch-pet="onSwitchPet"
        />
      </div>
      <!-- 欢迎页：全局背景光晕 + 品牌图标 + 快捷项目入口（仅无连接且无消息时显示） -->
      <div v-if="!connected && messages.length === 0" class="welcome">
        <div class="welcome-glow"></div>
        <div class="welcome-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"
               stroke-linejoin="round">
            <polygon points="12,2 22,12 12,22 2,12"/>
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.25"/>
          </svg>
        </div>
        <h1>Claude Desktop Bridge</h1>
        <p>{{ t('ws.welcomeHint') }}</p>
        <div class="quick-actions">
          <button
              v-for="p in projects.slice(0, 4)"
              :key="p.workDir"
              class="quick-project"
              @click="handleNewSession(p.workDir)"
          >
            {{ dirName(p.workDir) }}
          </button>
        </div>
      </div>

      <!-- 聊天区：有连接或有消息时显示 -->
      <template v-else>
        <!-- 聊天顶部栏：项目名 / 会话ID + 状态圆点 + IM 镜像按钮 + 文件面板切换 -->
        <!-- 多会话标签页栏 -->
        <div v-if="tabSessions.length > 0" class="tab-bar">
          <div v-for="tab in tabSessions" :key="tab.id"
               class="tab-chip" :class="{ active: tab.id === activeTabId }"
               @click="switchToTab(tab.id)"
               :title="tab.projectPath">
            <span class="tab-label">{{ tab.label }}</span>
            <span class="tab-status-dot" :class="tab.state.status"></span>
            <button class="tab-close" @click.stop="closeTab(tab.id)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="chat-header">
          <div class="chat-header-left">
            <span class="header-project">{{ activeProject ? dirName(activeProject) : '' }}</span>
            <span class="header-sep">/</span>
            <span class="header-session">{{ sessionId?.slice(0, 8) }}</span>
          </div>
          <div class="chat-header-right">
            <!-- 状态指示器：空闲(绿) / 思考中(橙，呼吸动画) / 离线(灰) -->
            <span class="status-dot" :class="status"></span>
            <span class="status-label">{{
                status === 'thinking' ? t('ws.statusThinking') : status === 'idle' && connected ? t('ws.statusReady') : t('ws.statusOffline')
              }}</span>
            <!-- IM 平台镜像开关按钮组（微信/飞书/钉钉） -->
            <button v-for="p in imPlatformLabels" :key="p.id"
                    class="panel-toggle-btn mirror-toggle" :class="mirrorActive(p.id) ? 'active' : ''"
                    :disabled="!imBound[p.id]"
                    @click="toggleMirror(p.id)"
                    :title="!imBound[p.id] ? t('ws.mirrorUnbound') : mirrorActive(p.id) ? t('ws.mirrorOn') : t('ws.mirrorOff')"
                    :style="mirrorActive(p.id) ? { borderColor: p.color, color: p.color, background: p.color + '12' } : {}">
              <span class="mirror-icon"
                    v-html="'<svg width=14 height=14 viewBox=\'0 0 24 24\' fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round>'+p.ms+'</svg>'"></span>
              <span class="mirror-label">{{ p.label }}</span>
              <span class="mirror-dot" :class="mirrorDotClass(p.id)"></span>
            </button>
            <button class="panel-toggle-btn" :class="{ active: showFilePanel }" @click="toggleFilePanel"
                    :title="t('ws.filePanelToggle')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
            <!-- 导出按钮 -->
            <div class="export-wrapper" style="position:relative">
              <button class="panel-toggle-btn" @click="showExportMenu = !showExportMenu" :title="t('ws.export')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <div v-if="showExportMenu" class="export-dropdown glass">
                <button @click="doExport('md')" class="export-item">{{ t('ws.exportMD') }}</button>
                <button @click="doExport('json')" class="export-item">{{ t('ws.exportJSON') }}</button>
                <button @click="doExport('jsonl')" class="export-item">{{ t('ws.exportJSONL') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 消息列表区域：v-for 遍历 messages，按 role 切换渲染模板 -->
        <div ref="chatRef" class="messages" @click="onMessageClick" @scroll="onMessagesScroll">
          <!-- 每条消息行：根据 role 控制对齐方向和动画延迟 -->
          <div v-for="(msg, i) in messages" :key="i" class="msg-row" :class="msg.role"
               :style="{ animationDelay: `${Math.min(i * 20, 300)}ms` }">
            <!-- 系统消息：时间 + 文本，居中显示 -->
            <template v-if="msg.role === 'system'">
              <div class="sys-msg">
                <span class="sys-time">{{ formatTime(msg.time) }}</span>
                <span class="sys-text">{{ msg.text }}</span>
              </div>
            </template>
            <!-- 思考块：折叠面板，summary 栏展示"思考"标签 + 预览文本 -->
            <template v-else-if="msg.role === 'thinking'">
              <details class="think-details" @toggle="msg.expanded = $event.target.open">
                <summary class="think-summary">
                  <span class="think-badge">{{ t('ws.thinkBadge') }}</span>
                  <svg class="think-dot-icon" width="8" height="8" viewBox="0 0 8 8">
                    <circle cx="4" cy="4" r="3" fill="currentColor"/>
                  </svg>
                  <span class="think-preview">{{
                      (msg.thinkingContent || msg.text).slice(0, 60).replace(/\n/g, ' ')
                    }}{{ (msg.thinkingContent || '').length > 60 ? '...' : '' }}</span>
                  <span class="think-time">{{ formatTime(msg.time) }}</span>
                </summary>
                <div class="think-content" v-html="renderMarkdown(msg.thinkingContent || msg.text)"></div>
              </details>
            </template>
            <!-- 错误消息：红色背景居中显示 -->
            <template v-else-if="msg.role === 'error'">
              <div class="err-msg">{{ msg.text }}</div>
            </template>
            <!-- 用户 / AI 消息气泡（含复制/回填按钮、工具调用卡片） -->
            <template v-else>
              <div>
                <div class="bubble" :class="msg.role">
                  <!-- 气泡标签：You / AI -->
                  <div class="bubble-label">{{ msg.role === 'user' ? 'You' : 'AI' }}</div>
                  <div class="bubble-text" v-html="renderMarkdown(msg.text)"></div>
                  <div class="bubble-actions">
                    <button class="bubble-act-btn" :title="copiedIndex === i ? t('ws.copied') : t('ws.copy')"
                            @click="copyBubble(msg.text, i)">
                      <svg v-if="copiedIndex === i" width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                    <button class="bubble-act-btn" :title="t('ws.refill')" @click="refillBubble(msg.text)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 10 4 15 9 20"/>
                        <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <!-- 工具调用记录：仅 assistant 消息且有工具调用时显示 -->
                <div v-if="msg.role === 'assistant' && msg.tools?.length" class="tools-box">
                  <div class="tools-toggle" @click="msg.toolsExpanded = !msg.toolsExpanded">
                    <svg class="tools-chevron" :class="{ open: msg.toolsExpanded }" width="12" height="12"
                         viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span>{{ t('ws.toolsOps', {n: msg.tools.length}) }}</span>
                    <span class="tools-total-time">{{ msg.tools.reduce((s, t) => s + (t.elapsed || 0), 0) }}s</span>
                  </div>
                  <div v-if="msg.toolsExpanded" class="tools-list">
                    <div v-for="t in msg.tools" :key="t.tool_use_id" class="tool-card">
                      <div class="tool-card-header">
                        <span class="tool-badge">{{ t.tool_name }}</span>
                        <span class="tool-time" v-if="t.elapsed">{{ t.elapsed }}s</span>
                      </div>
                      <!-- Edit: show diff -->
                      <template v-if="t.tool_name === 'Edit'">
                        <div class="tool-detail">
                          <code class="tool-file">{{ t.input?.file_path || '?' }}</code>
                          <div class="tool-diff-lines">
                            <div class="diff-old">- {{
                                (t.input?.old_string || '').slice(0, 150)
                              }}{{ (t.input?.old_string || '').length > 150 ? '...' : '' }}
                            </div>
                            <div class="diff-new">+ {{
                                (t.input?.new_string || '').slice(0, 150)
                              }}{{ (t.input?.new_string || '').length > 150 ? '...' : '' }}
                            </div>
                          </div>
                        </div>
                      </template>
                      <!-- Write: show file + preview -->
                      <template v-else-if="t.tool_name === 'Write'">
                        <div class="tool-detail">
                          <code class="tool-file">{{ t.input?.file_path || '?' }}</code>
                          <div class="tool-content-preview">{{
                              (t.input?.content || '').slice(0, 200)
                            }}{{ (t.input?.content || '').length > 200 ? '...' : '' }}
                          </div>
                        </div>
                      </template>
                      <!-- Bash: show command -->
                      <template v-else-if="t.tool_name === 'Bash'">
                        <div class="tool-detail">
                          <code class="tool-bash">$ {{ t.input?.command || '?' }}</code>
                        </div>
                      </template>
                      <!-- Other tools: show input JSON -->
                      <template v-else>
                        <div class="tool-detail">
                          <span class="tool-input-json">{{ JSON.stringify(t.input).slice(0, 200) }}</span>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <!-- 内联 Agent 活动卡片：本轮中所有 native + workflow agent 的运行总览 -->
          <div v-if="hasAgentRuns" class="agent-runs-card">
            <div class="agent-runs-header">
              <svg class="agent-runs-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span class="agent-runs-title">Agent 活动 ({{ agentRuns.length }})</span>
              <span class="agent-runs-summary">
                <template v-for="(ag, ai) in agentRuns" :key="ag.id + ag.source">
                  <span v-if="ai > 0" class="agent-runs-sep">·</span>
                  <span class="agent-runs-mini" :class="ag.status"><span v-html="agentIcon(ag.agentType)"
                                                                         style="display:inline-flex;align-items:center"></span> {{
                      ag.agentType
                    }}</span>
                </template>
              </span>
            </div>
            <!-- 各 agent 行 -->
            <div v-for="ag in agentRuns" :key="ag.id + ag.source" class="agent-run-item">
              <!-- 收起行 -->
              <div class="agent-run-summary" @click="ag.expanded = !ag.expanded">
                <svg class="agent-run-chevron" :class="{ open: ag.expanded }" width="12" height="12" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span class="agent-run-dot" :class="ag.status"
                      :style="ag.status === 'running' ? { background: agentColor(ag.agentType), boxShadow: '0 0 6px ' + agentColor(ag.agentType) } : {}"></span>
                <span class="agent-run-type"><span v-html="agentIcon(ag.agentType)"
                                                   style="display:inline-flex;align-items:center"></span> {{
                    ag.agentType
                  }}</span>
                <span v-if="ag.description" class="agent-run-desc">· {{
                    ag.description.slice(0, 50)
                  }}{{ ag.description.length > 50 ? '...' : '' }}</span>
                <span class="agent-run-status" :class="ag.status">
                  <template v-if="ag.status === 'spawning'">启动中</template>
                  <template v-else-if="ag.status === 'running'">执行中</template>
                  <template v-else-if="ag.status === 'done'">已完成</template>
                  <template v-else>错误</template>
                </span>
                <span v-if="ag.status === 'done' && ag.doneTime && ag.spawnTime"
                      class="agent-run-duration">{{ formatDuration(ag.doneTime - ag.spawnTime) }}</span>
                <span v-else-if="ag.status === 'running' && ag.spawnTime"
                      class="agent-run-duration running">{{ formatDuration(Date.now() - ag.spawnTime) }}</span>
                <span class="agent-run-source" :class="ag.source">{{ ag.source === 'native' ? 'Task' : 'WF' }}</span>
              </div>
              <!-- 进度条 -->
              <div class="agent-run-bar-wrap">
                <div class="agent-run-bar" :class="ag.status"
                     :style="ag.status === 'done' ? { width: '100%' } : ag.status === 'running' ? { width: '100%' } : ag.status === 'error' ? { width: '100%' } : { width: '0%' }"></div>
              </div>
              <!-- 展开详情 -->
              <div v-if="ag.expanded" class="agent-run-detail">
                <!-- 进度文字（运行中显示实时描述/耗时，完成显示结果摘要） -->
                <div class="agent-run-progress-text">
                  <template v-if="ag.status === 'running'">耗时
                    {{ ag.spawnTime ? formatDuration(Date.now() - ag.spawnTime) : '...' }}<span
                        v-if="ag.progress"> · {{ ag.progress.slice(0, 80) }}{{
                        ag.progress.length > 80 ? '...' : ''
                      }}</span></template>
                  <template v-else-if="ag.status === 'done'">总耗时
                    {{ ag.doneTime && ag.spawnTime ? formatDuration(ag.doneTime - ag.spawnTime) : '...' }}<span
                        v-if="ag.transcriptPath"> · 记录已保存</span></template>
                  <template v-else-if="ag.status === 'spawning'">正在分配 Agent 资源...</template>
                </div>
                <!-- 状态时间线 -->
                <div class="agent-run-timeline">
                  <div class="agent-run-step" :class="{ active: true }">
                    <span class="agent-run-step-dot"></span>
                    <span class="agent-run-step-label">创建</span>
                    <span class="agent-run-step-time">{{ formatTime(ag.spawnTime) }}</span>
                  </div>
                  <div class="agent-run-step"
                       :class="{ active: ag.status === 'running' || ag.status === 'done' || ag.status === 'error' }">
                    <span class="agent-run-step-dot"></span>
                    <span class="agent-run-step-label">启动</span>
                    <span class="agent-run-step-time">{{ ag.startTime ? formatTime(ag.startTime) : '—' }}</span>
                  </div>
                  <div class="agent-run-step" :class="{ active: ag.status === 'done' || ag.status === 'error' }">
                    <span class="agent-run-step-dot"></span>
                    <span class="agent-run-step-label">{{ ag.status === 'error' ? '错误' : '完成' }}</span>
                    <span class="agent-run-step-time">{{ ag.doneTime ? formatTime(ag.doneTime) : '—' }}</span>
                  </div>
                </div>
                <!-- 完整描述 -->
                <div v-if="ag.description" class="agent-run-full-desc">
                  <span class="agent-run-desc-label">描述:</span>
                  {{ ag.description }}
                </div>
                <div v-if="ag.source === 'workflow'" class="agent-run-wf-hint">来自 Workflow · 详情见右侧面板</div>
              </div>
            </div>
          </div>

          <!-- Thinking 动画骨架：三个呼吸圆点，表示 AI 正在思考中 -->
          <div v-if="status === 'thinking'" class="thinking-indicator">
            <span class="think-dot"></span>
            <span class="think-dot"></span>
            <span class="think-dot"></span>
          </div>

          <!-- 回到底部悬浮按钮：sticky 贴消息区底部，用户上滑后出现 -->
          <button v-if="userScrolledUp" class="scroll-bottom-btn" @click="scrollDown(true)" :title="t('ws.scrollBottom')">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

        </div>

        <!-- 控制栏：模型选择器 / 权限模式 / 思考等级 / Agent 面板入口 / 记录点下拉 / token 迷你条 / 上下文圆环 -->
        <div class="controls-bar">
          <!-- 模型选择器：从 models 列表动态渲染 option -->
          <div class="control-group">
            <span class="control-label">{{ t('ws.ctlModel') }}</span>
            <select v-model="model" class="control-select">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <!-- 权限模式选择器 -->
          <div class="control-group">
            <span class="control-label">{{ t('ws.ctlPerm') }}</span>
            <select v-model="permissionMode" class="control-select">
              <option v-for="p in permissions" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <!-- 思考等级选择器 -->
          <div class="control-group">
            <span class="control-label">{{ t('ws.ctlThink') }}</span>
            <select v-model="thinkingLevel" class="control-select">
              <option v-for="tk in thinkings" :key="tk.value" :value="tk.value">{{ tk.label }}</option>
            </select>
          </div>
          <!-- Agent 面板入口：有 agent 活动时显示醒目按钮 -->
          <div v-if="hasAgentActivity" class="control-group">
            <button class="agent-panel-btn" :class="{ active: showWfPanel, pulse: runningAgentTotal > 0 }"
                    @click="showWfPanel = !showWfPanel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span class="agent-btn-label">{{ agentBtnLabel }}</span>
              <span v-if="runningAgentTotal > 0" class="agent-btn-badge">{{ runningAgentTotal }}</span>
              <span class="agent-panel-chevron" :class="{ open: showWfPanel }">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline
                    points="9 18 15 12 9 6"/></svg>
              </span>
            </button>
          </div>
          <!-- 记录点：一个名为「记录点」的标签，点击弹出下拉列表 -->
          <div class="control-group cp-control">
            <button class="cp-tab" :class="{ open: showCpDropdown }" @click="toggleCpDropdown">
              {{ t('ws.cpTab') }}<span v-if="checkpoints.length" class="cp-tab-count">{{ checkpoints.length }}</span>
            </button>
            <!-- 点击外部关闭 -->
            <div v-if="showCpDropdown" class="cp-overlay" @click="closeCpDropdown"></div>
            <!-- 下拉列表（向上弹出） -->
            <div v-if="showCpDropdown" class="cp-dropdown glass" @click.stop>
              <div class="cp-dropdown-head">
                <span class="cp-head-title">{{ t('ws.cpTab') }}</span>
                <button class="cp-commit-btn" :disabled="committing" :title="t('ws.commitTitle')"
                        @click="commitChanges">
                  {{ committing ? t('ws.committing') : t('ws.commit') }}
                </button>
                <button class="fp-icon-btn" :title="t('ws.close')" @click="closeCpDropdown">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div class="cp-dropdown-body">
                <div v-if="checkpointsLoading" class="fp-hint">{{ t('common.loading') }}</div>
                <div v-else-if="checkpoints.length === 0" class="fp-hint">{{ t('ws.cpEmpty') }}</div>
                <template v-else>
                  <div v-for="cp in checkpoints" :key="cp.id" class="cp-item">
                    <div class="cp-head" @click="toggleCp(cp.id)">
                      <svg class="fp-chevron" :class="{ open: expandedCp.has(cp.id) }" width="12" height="12"
                           viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                      <div class="cp-main">
                        <div class="cp-prompt">{{ cp.prompt || t('ws.cpNoInput') }}</div>
                        <div class="cp-meta">
                          <span>{{ timeAgo(cp.time) }}</span>
                          <span class="cp-files">{{ t('ws.cpFiles', {n: cp.fileCount}) }}</span>
                          <span v-if="cp.added" class="fp-add">+{{ cp.added }}</span>
                          <span v-if="cp.removed" class="fp-del">-{{ cp.removed }}</span>
                        </div>
                      </div>
                      <button class="cp-rewind-btn" :disabled="!cp.revertible || rewinding"
                              :title="cp.revertible ? t('ws.revertTip') : t('ws.revertDisabled')"
                              @click.stop="askRewind(cp)">{{ t('ws.revert') }}
                      </button>
                    </div>
                    <div v-if="expandedCp.has(cp.id)" class="cp-files-list">
                      <div v-for="f in cp.files" :key="f.path" class="cp-file-row"
                           :class="{ disabled: f.notRevertible }">
                        <span class="fp-file-dot" :class="f.status"></span>
                        <span class="cp-file-path" :class="{ deleted: f.status === 'deleted' }">{{ f.path }}</span>
                        <span v-if="statusBadge(f.status)" class="fp-badge"
                              :class="statusBadge(f.status)!.cls">{{ statusBadge(f.status)!.label }}</span>
                        <span v-if="f.added" class="fp-add">+{{ f.added }}</span>
                        <span v-if="f.removed" class="fp-del">-{{ f.removed }}</span>
                        <span v-if="f.notRevertible" class="cp-noreturn">{{ t('ws.notRevertible') }}</span>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
          <!-- 弹性占位，把 token 迷你条和圆环推到右侧 -->
          <div class="spacer"></div>
          <!-- 本轮 token 迷你条：输入 · 思考(~估算) · 纯输出(已扣思考) -->
          <div v-if="usage.total > 0" class="token-mini" :title="t('ws.tokenMiniTip')">
            <span class="tm-item tm-in">↓ {{ fmtTok(usage.input) }}</span>
            <span class="tm-sep">·</span>
            <span class="tm-item tm-think">~{{ fmtTok(usage.thinking) }}</span>
            <span class="tm-sep">·</span>
            <span class="tm-item tm-out">↑ {{ fmtTok(usage.output) }}</span>
          </div>
          <!-- 上下文圆环：可点击触发 /compact，悬停显示 token 与费用详情 tooltip -->
          <div class="context-ring" :class="{ warning: contextPercent > 70 }" :title="t('ws.ctxRingTitle')"
               @click="runCompact">
            <svg width="40" height="40" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" stroke-width="3.5"/>
              <circle cx="22" cy="22" r="18" fill="none" stroke-linecap="round"
                      :stroke="contextPercent > 70 ? 'var(--warning)' : 'var(--accent-blue)'"
                      stroke-width="3.5"
                      :stroke-dasharray="113.1"
                      :stroke-dashoffset="113.1 - (contextPercent / 100) * 113.1"
                      transform="rotate(-90 22 22)"
                      style="transition: stroke-dashoffset 0.4s var(--ease-out)"
                      class="ring-glow"
              />
              <text x="22" y="24" text-anchor="middle" fill="var(--text-secondary)" font-size="9"
                    font-family="var(--font-mono)" font-weight="500">
                {{ contextPercent }}%
              </text>
            </svg>
            <div class="ring-tooltip glass">
              <div v-if="contextPercent > 70" class="tt-hint">{{ t('ws.ctxHint', {pct: contextPercent}) }}</div>
              <div class="tt-row"><span>{{ t('ws.ttUsed') }}</span><span>{{ tokenTooltip.used }}</span></div>
              <div class="tt-row"><span>{{ t('ws.ttPct') }}</span><span>{{ tokenTooltip.pct }}</span></div>
              <div class="tt-sep"></div>
              <div class="tt-row"><span>{{ t('ws.ttInput') }}</span><span>{{ tokenTooltip.input }}</span></div>
              <div class="tt-row"><span>{{ t('ws.ttThink') }}</span><span>{{ tokenTooltip.thinking }}</span></div>
              <div class="tt-row"><span>{{ t('ws.ttOutput') }}</span><span>{{ tokenTooltip.output }}</span></div>
              <div class="tt-sep"></div>
              <div class="tt-row"><span>{{ t('ws.ttCostTurn') }}</span><span>¥{{ tokenTooltip.costTurn }}</span></div>
              <div class="tt-row"><span>{{ t('ws.ttCostTotal') }}</span><span>¥{{ tokenTooltip.costTotal }}</span></div>
              <div class="tt-row"><span>{{ t('ws.ttRemaining') }}</span><span>¥{{ tokenTooltip.remaining }}</span></div>
            </div>
          </div>
        </div>

        <!-- 输入区域：确认横幅 + 排队消息 + 补全菜单 + textarea + 发送按钮 -->
        <div class="input-area">
          <!-- 权限确认横幅：工具名 + 操作摘要 + 允许/拒绝按钮 -->
          <div v-if="pendingPermission" class="confirm-banner">
            <div class="confirm-banner-info">
              <span class="confirm-banner-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path
                    d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <div class="confirm-banner-text">
                <div class="confirm-banner-title">{{ t('ws.needAuth', {tool: pendingPermission.toolName}) }}</div>
                <div class="confirm-banner-summary" :title="pendingPermission.summary">{{
                    pendingPermission.summary
                  }}
                </div>
              </div>
            </div>
            <div class="confirm-banner-actions">
              <button class="confirm-btn cancel" @click="respondPermission('deny')">{{ t('ws.deny') }}</button>
              <button class="confirm-btn primary" @click="respondPermission('allow')">{{ t('ws.allow') }}</button>
            </div>
          </div>

          <!-- 方案选择横幅：问题文本 + 各选项按钮 -->
          <div v-if="pendingChoice" class="confirm-banner choice">
            <div class="confirm-banner-question">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" style="flex-shrink:0">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              {{ pendingChoice.question }}
            </div>
            <div class="confirm-banner-options">
              <button v-for="(o, i) in pendingChoice.options" :key="i" class="choice-opt-btn" @click="respondChoice(i)">
                {{ i + 1 }}. {{ o.label }}
              </button>
            </div>
          </div>

          <!-- 排队消息栏：thinking 期间输入的消息在此排队，可手动发送/注入/删除 -->
          <div v-if="msgQueue.length > 0" class="queue-bar">
            <span class="queue-label">{{
                status === 'thinking' ? t('ws.queueSupplement') : t('ws.queuePending')
              }} ({{ msgQueue.length }})</span>
            <div class="queue-chips">
              <div v-for="q in msgQueue" :key="q.id" class="queue-chip">
                <span class="chip-text" :title="q.text">{{ q.text.slice(0, 60) }}{{
                    q.text.length > 60 ? '...' : ''
                  }}</span>
                <button class="chip-send" :title="status === 'thinking' ? t('ws.injectNow') : t('ws.sendNow')"
                        @click="status === 'thinking' ? injectNow(q) : sendQueued(q)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
                <button class="chip-remove" :title="t('ws.remove')" @click="removeQueued(q)">×</button>
              </div>
            </div>
          </div>
          <!-- 补全菜单定位锚点：position:relative 容器，菜单 absolute 向上弹出 -->
          <div class="cmd-anchor">
            <!-- 斜杠命令补全菜单：输入 / 时向上弹出，←↑→↓ 键盘导航 -->
            <div v-if="showCmdMenu" ref="cmdMenuEl" class="cmd-menu">
              <button
                  v-for="(c, i) in cmdMatches"
                  :key="c.name"
                  class="cmd-item"
                  :class="{ active: i === cmdIndex }"
                  @mousedown.prevent="applyCommand(c)"
                  @mouseenter="cmdIndex = i"
              >
                <span class="cmd-name">/{{ c.name }}</span>
                <span v-if="c.argumentHint" class="cmd-hint">{{ c.argumentHint }}</span>
                <span class="cmd-desc">{{ c.description }}</span>
              </button>
            </div>
            <!-- 文件引用补全菜单：输入 # 时向上弹出当前项目文件列表 -->
            <div v-if="showFileMenu" ref="fileMenuEl" class="cmd-menu">
              <button
                  v-for="(f, i) in fileMatches"
                  :key="f.path"
                  class="cmd-item"
                  :class="{ active: i === fileIndex }"
                  @mousedown.prevent="applyFile(f)"
                  @mouseenter="fileIndex = i"
              >
                <span class="cmd-name">#{{ f.path.split('/').pop() }}</span>
                <span class="cmd-desc">{{ f.path }}</span>
              </button>
            </div>
            <!-- Agent 补全菜单：输入 @ 时向上弹出已创建子代理列表 -->
            <div v-if="showAgentMenu" ref="agentMenuEl" class="cmd-menu">
              <button
                  v-for="(a, i) in agentMatches"
                  :key="a.name"
                  class="cmd-item"
                  :class="{ active: i === agentIndex }"
                  @mousedown.prevent="applyAgent(a)"
                  @mouseenter="agentIndex = i"
              >
                <span class="cmd-name">@{{ a.name }}</span>
                <span class="cmd-desc">{{ a.description }}</span>
              </button>
            </div>
            <!-- Prompt 模板条 -->
            <div v-if="showTemplateBar" class="template-bar">
              <button v-for="tpl in promptTemplates" :key="tpl.label"
                      class="template-chip" @click="applyTemplate(tpl)"
                      :title="tpl.text">
              <span v-html="tpl.svg"></span>
                <span>{{ tpl.label }}</span>
              </button>
            </div>
            <div class="input-wrapper">
              <!--
                textarea 输入框：
                - placeholder 随 status 变化（空闲 vs thinking 不同提示）
                - @keydown 处理键盘导航和 Enter 发送
                - @input 自适应高度（auto-resize，最大 120px）
              -->
              <textarea
                  v-model="inputText"
                  :placeholder="status === 'thinking' ? t('ws.inputThinking') : t('ws.inputPlaceholder')"
                  rows="1"
                  @keydown="handleKeydown"
                  @paste="onPaste"
                  @input="(e) => { const el = (e.target as HTMLElement); el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }"
              ></textarea>
              <!-- thinking 且输入框为空时：显示红色停止按钮（回填用户原文） -->
              <button
                  v-if="!inputText.trim() && status === 'thinking'"
                  class="send-btn stop-btn"
                  @click="cancelTask"
                  :title="t('ws.stopRefill')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="3"/>
                </svg>
              </button>
              <!-- 有输入内容或非 thinking 时：显示发送按钮（空输入时 disabled） -->
              <button
                  v-else
                  class="send-btn"
                  :disabled="!inputText.trim()"
                  @click="sendMessage"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round">
                  <line x1="12" y1="19" x2="12" y2="5"/>
                  <polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!--
      右侧文件面板 (File Panel)：360px 固定宽度
      - 顶部：标题 + 重设基线按钮 + 关闭按钮
      - 过滤器：全部文件 / 仅变更文件
      - 文件树：嵌套目录结构，点击文件预览或 diff
    -->
    <div v-if="showFilePanel || showWfPanel" class="right-panels">
      <aside v-if="showFilePanel" class="file-panel" style="flex: 1; min-height: 0">
        <div class="fp-header">
          <span class="fp-title">{{ t('ws.fpTitle') }}</span>
          <div class="fp-header-actions">
            <!-- 选择性提交按钮 -->
            <button class="fp-icon-btn commit-btn" :title="t('ws.fpCommit')" @click="openCommitFilesDialog"
                    :disabled="changedFilesForCommit.length === 0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </button>
            <!-- 刷新文件列表按钮 -->
            <button class="fp-icon-btn" :title="t('ws.fpRefresh')" @click="loadFileTree">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button class="fp-icon-btn" :title="t('ws.close')" @click="showFilePanel = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="fp-filter">
          <button class="fp-filter-tab" :class="{ active: fileFilter === 'all' }" @click="fileFilter = 'all'">
            {{ t('ws.fpAll') }}
          </button>
          <button class="fp-filter-tab" :class="{ active: fileFilter === 'changed' }" @click="fileFilter = 'changed'">
            {{ t('ws.fpChanged') }}
          </button>
          <span class="fp-snap-time"
                v-if="hasSnapshot && snapshotAt">{{ t('ws.fpBaseline', {time: formatTime(snapshotAt)}) }}</span>
          <span class="fp-snap-time warn" v-else>{{ t('ws.fpNoBaseline') }}</span>
        </div>

        <div class="fp-tree">
          <div v-if="fileTreeLoading" class="fp-hint">{{ t('common.loading') }}</div>
          <div v-else-if="fileMissing" class="fp-hint">{{ t('ws.fpMissing') }}</div>
          <div v-else-if="visibleRows.length === 0" class="fp-hint">
            {{ fileFilter === 'changed' ? t('ws.fpNoChanged') : t('ws.fpNoFiles') }}
          </div>
          <template v-else>
            <div
                v-for="row in visibleRows"
                :key="row.node.path"
                class="file-row"
                :class="{ dir: row.node.isDir }"
                :style="{ paddingLeft: (row.depth * 14 + 8) + 'px' }"
                @click="row.node.isDir ? toggleDir(row.node.path) : openFileModal(row.node.file!)"
            >
              <!-- 目录 -->
              <template v-if="row.node.isDir">
                <svg class="fp-chevron" :class="{ open: expandedDirs.has(row.node.path) }" width="12" height="12"
                     viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span class="fp-name dir">{{ row.node.name }}</span>
              </template>
              <!-- 文件 -->
              <template v-else>
                <span class="fp-file-dot" :class="row.node.file!.status"></span>
                <span class="fp-name" :class="{ deleted: row.node.file!.status === 'deleted' }">{{
                    row.node.name
                  }}</span>
                <span v-if="statusBadge(row.node.file!.status)" class="fp-badge"
                      :class="statusBadge(row.node.file!.status)!.cls">{{
                    statusBadge(row.node.file!.status)!.label
                  }}</span>
                <span v-if="row.node.file!.added != null && row.node.file!.added > 0"
                      class="fp-add">+{{ row.node.file!.added }}</span>
                <span v-if="row.node.file!.removed != null && row.node.file!.removed > 0"
                      class="fp-del">-{{ row.node.file!.removed }}</span>
                <button
                    v-if="!row.node.file!.binary && row.node.file!.status !== 'unchanged' && row.node.file!.status !== 'added'"
                    class="fp-diff-btn"
                    title="diff"
                    @click.stop="openDiffModal(row.node.file!)"
                >diff
                </button>
              </template>
            </div>
          </template>
          <div v-if="fileTruncated" class="fp-hint warn">{{ t('ws.fpTruncated') }}</div>
        </div>
      </aside>
      <!-- Workflow 多 Agent 详情面板 -->
      <div v-if="showWfPanel" class="wf-detail-panel" style="flex: 1; min-height: 0">
        <!-- 原生 Agent 面板（无 Workflow 时） -->
        <template v-if="!wfRunState">
          <div class="fp-header">
            <span class="fp-title">Agent 活动 ({{ agentRuns.length }})</span>
            <button class="fp-icon-btn" :title="t('ws.close')" @click="showWfPanel = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="ag-panel-list">
            <div v-if="agentRuns.length === 0" class="ag-panel-empty">暂无 Agent 活动</div>
            <div v-for="ag in agentRuns" :key="ag.id + ag.source" class="ag-panel-card" :class="ag.status">
              <!-- 卡片头部：类型 + 状态 + 耗时 -->
              <div class="ag-card-head">
                <span class="ag-card-dot" :class="ag.status"
                      :style="ag.status === 'running' ? { background: agentColor(ag.agentType), boxShadow: '0 0 8px ' + agentColor(ag.agentType) } : {}"></span>
                <span class="ag-card-type"><span v-html="agentIcon(ag.agentType)"
                                                 style="display:inline-flex;align-items:center"></span> {{
                    ag.agentType
                  }}</span>
                <span class="ag-card-status" :class="ag.status">
                <template v-if="ag.status === 'spawning'">启动中...</template>
                <template v-else-if="ag.status === 'running'">执行中</template>
                <template v-else-if="ag.status === 'done'">已完成</template>
                <template v-else>错误</template>
              </span>
                <span v-if="ag.status === 'done' && ag.doneTime && ag.spawnTime"
                      class="ag-card-time">{{ formatDuration(ag.doneTime - ag.spawnTime) }}</span>
                <span v-else-if="ag.status === 'running' && ag.spawnTime"
                      class="ag-card-time running">{{ formatDuration(Date.now() - ag.spawnTime) }}</span>
              </div>
              <!-- 任务描述 -->
              <div v-if="ag.description" class="ag-card-desc" :title="ag.description">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     style="flex-shrink:0;margin-top:2px">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>{{ ag.description }}</span>
              </div>
              <!-- 进度条 + 当前工具 -->
              <div v-if="ag.status === 'running' || ag.status === 'done'" class="ag-card-progress">
                <div v-if="ag.status === 'running'" class="ag-card-bar">
                  <div class="ag-card-bar-indeterminate"></div>
                </div>
                <div v-else class="ag-card-bar">
                  <div class="ag-card-bar-fill done"></div>
                </div>
                <div class="ag-card-tool-info">
                  <span v-if="ag.currentTool" class="ag-card-tool-name">{{ ag.currentTool }}</span>
                  <span v-if="ag.currentToolElapsed > 0" class="ag-card-tool-time">{{ ag.currentToolElapsed }}s</span>
                  <span v-if="ag.status === 'running' && ag.spawnTime"
                        class="ag-card-elapsed">总耗时 {{ formatDuration(Date.now() - ag.spawnTime) }}</span>
                </div>
              </div>
              <!-- 时间线 -->
              <div class="ag-card-timeline">
                <div class="ag-card-step"><span class="ag-step-label">创建</span><span
                    class="ag-step-time">{{ formatTime(ag.spawnTime) }}</span></div>
                <div class="ag-card-step"><span class="ag-step-label">启动</span><span
                    class="ag-step-time">{{ ag.startTime ? formatTime(ag.startTime) : '—' }}</span></div>
                <div class="ag-card-step"><span class="ag-step-label">{{
                    ag.status === 'error' ? '错误' : '完成'
                  }}</span><span class="ag-step-time">{{ ag.doneTime ? formatTime(ag.doneTime) : '—' }}</span></div>
              </div>
              <div v-if="ag.transcriptPath" class="ag-card-record">记录已保存</div>
            </div>
          </div>
        </template>
        <!-- Workflow 面板 -->
        <template v-else>
          <div class="fp-header">
            <span class="fp-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                                        style="vertical-align:middle;margin-right:4px"><polyline
                points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Workflow {{ wfRunState.name }}</span>
            <button class="fp-icon-btn" :title="t('ws.close')" @click="showWfPanel = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <!-- Phase 进度条 -->
          <div class="wf-phases-bar">
            <template v-for="(ph, pi) in wfRunState.phases" :key="ph.title">
              <span class="wf-phase-dot" :class="ph.status" :title="ph.title"></span>
              <span v-if="pi < wfRunState.phases.length - 1" class="wf-phase-line"
                    :class="{ done: ph.status === 'done' || ph.status === 'running' }"></span>
            </template>
            <span style="font-size:11px;color:var(--text-muted);margin-left:6px">{{
                wfRunState.currentPhase || wfRunState.phases?.find(p => p.status === 'running')?.title
              }}</span>
          </div>
          <!-- Agent 列表 -->
          <div class="wf-agents-list">
            <div v-if="wfRunState.agents.length === 0"
                 style="padding:20px;text-align:center;font-size:12px;color:var(--text-muted)">等待引擎分配 Agent...
            </div>
            <div v-for="ag in wfRunState.agents" :key="ag.id" class="wf-agent-row">
              <span class="wf-ag-row-dot" :class="ag.status"></span>
              <span class="wf-ag-row-label">{{ ag.id }}</span>
              <span class="wf-ag-row-status" :class="ag.status">{{
                  ag.status === 'running' ? '···' : ag.status === 'done' ? 'OK' : ag.status === 'error' ? 'ERR' : '—'
                }}</span>
            </div>
          </div>
          <!-- 日志（最近 15 条） -->
          <div class="wf-logs">
            <div v-for="(l, li) in wfRunState.logs.slice(-15)" :key="li" class="wf-log-line">
              <span class="wf-log-phase">{{ l.phase }}</span>
              <span class="wf-log-msg">{{ l.msg }}</span>
            </div>
          </div>
          <div v-if="wfRunState.status === 'done'"
               style="padding:8px 12px;font-size:11px;color:var(--success);border-top:1px solid var(--border)">
            完成 · {{ wfRunState.tokenSpent.toLocaleString() }} tokens
          </div>
        </template>
      </div>
    </div>

    <!-- 全局 toast 通知 -->
    <GlobalToast :text="toastText" />

    <!-- 提交修改确认弹窗：点击遮罩可关闭 -->
    <div v-if="pendingCommit" class="confirm-overlay" @click.self="pendingCommit = false">
      <div class="confirm-dialog glass">
        <h3 class="confirm-title">{{ t('ws.commitConfirmTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.commitConfirmBody') }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" :disabled="committing" @click="pendingCommit = false">{{
              t('common.cancel')
            }}
          </button>
          <button class="confirm-btn primary" :disabled="committing" @click="confirmCommit">
            {{ committing ? t('ws.committing') : t('ws.confirmCommit') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 文件选择性提交弹窗：多选变更文件后提交基线 -->
    <div v-if="pendingCommitFiles" class="confirm-overlay" @click.self="pendingCommitFiles = false">
      <div class="commit-files-dialog glass">
        <h3 class="confirm-title">{{ t('ws.commitFilesTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.commitFilesBody', {n: commitFileSelection.size}) }}</p>
        <!-- 过滤 + 全选控制条 -->
        <div class="commit-files-toolbar">
          <div class="commit-files-filter">
            <button class="fp-filter-tab" :class="{ active: commitFileFilter === 'all' }" @click="commitFileFilter = 'all'">
              {{ t('ws.fpAll') }}
            </button>
            <button class="fp-filter-tab" :class="{ active: commitFileFilter === 'changed' }" @click="commitFileFilter = 'changed'">
              {{ t('ws.fpChanged') }}
            </button>
          </div>
          <div class="commit-files-actions">
            <button class="commit-files-link" @click="selectAllCommitFiles">{{ t('ws.commitFilesSelectAll') }}</button>
            <button class="commit-files-link" @click="deselectAllCommitFiles">{{ t('ws.commitFilesDeselectAll') }}</button>
          </div>
        </div>
        <!-- 文件列表 -->
        <div class="commit-files-list">
          <div v-if="commitFilesVisible.length === 0" class="fp-hint">
            {{ commitFileFilter === 'changed' ? t('ws.fpNoChanged') : t('ws.fpNoFiles') }}
          </div>
          <label
              v-for="f in commitFilesVisible"
              :key="f.path"
              class="commit-file-row"
              :class="{ deleted: f.status === 'deleted' }"
          >
            <input
                type="checkbox"
                class="commit-file-check"
                :checked="commitFileSelection.has(f.path)"
                @change="toggleCommitFile(f.path)"
            />
            <span class="fp-file-dot" :class="f.status"></span>
            <span class="commit-file-path">{{ f.path }}</span>
            <span v-if="statusBadge(f.status)" class="fp-badge"
                  :class="statusBadge(f.status)!.cls">{{ statusBadge(f.status)!.label }}</span>
            <span v-if="f.added != null && f.added > 0" class="fp-add">+{{ f.added }}</span>
            <span v-if="f.removed != null && f.removed > 0" class="fp-del">-{{ f.removed }}</span>
          </label>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" :disabled="committing" @click="pendingCommitFiles = false">{{
              t('common.cancel')
            }}
          </button>
          <button class="confirm-btn primary" :disabled="committing || commitFileSelection.size === 0" @click="confirmCommitFiles">
            {{ committing ? t('ws.committing') : t('ws.confirmCommit') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 记录点回退确认弹窗（危险操作，确认按钮为红色） -->
    <div v-if="pendingRewind" class="confirm-overlay" @click.self="pendingRewind = null">
      <div class="confirm-dialog glass">
        <h3 class="confirm-title">{{ t('ws.rewindTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.rewindBody', {prompt: pendingRewind.prompt.slice(0, 40)}) }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" :disabled="rewinding" @click="pendingRewind = null">{{
              t('common.cancel')
            }}
          </button>
          <button class="confirm-btn danger" :disabled="rewinding" @click="confirmRewind">
            {{ rewinding ? t('ws.rewinding') : t('ws.confirmRewind') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除会话确认弹窗（危险操作，包含删除文件选项） -->
    <div v-if="pendingDelete" class="confirm-overlay" @click.self="pendingDelete = null">
      <div class="confirm-dialog glass">
        <h3 class="confirm-title">{{ t('ws.deleteSessionTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.deleteSessionBody') }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="pendingDelete = null">{{ t('common.cancel') }}</button>
          <button class="confirm-btn danger" @click="confirmDelete">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- 关闭标签页确认弹窗 -->
    <div v-if="pendingCloseTabId" class="confirm-overlay" @click.self="pendingCloseTabId = null">
      <div class="confirm-dialog glass">
        <h3 class="confirm-title">{{ t('ws.closeTabTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.closeTabBody') }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="pendingCloseTabId = null">{{ t('common.cancel') }}</button>
          <button class="confirm-btn danger" @click="confirmCloseTab">{{ t('ws.closeTabConfirm') }}</button>
        </div>
      </div>
    </div>

    <!-- 未保存更改确认弹窗 -->
    <div v-if="pendingUnsaved" class="confirm-overlay" style="z-index: 330" @click.self="pendingUnsaved = false">
      <div class="confirm-dialog glass">
        <h3 class="confirm-title">{{ t('ws.unsavedTitle') }}</h3>
        <p class="confirm-body">{{ t('ws.unsavedBody', {path: modalPath}) }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="doCloseModal">{{ t('ws.unsavedDiscard') }}</button>
          <button class="confirm-btn primary" @click="doSave(); doCloseModal()">{{ t('ws.unsavedSave') }}</button>
        </div>
      </div>
    </div>

    <!-- 文件内容 / Diff Modal：v-if 直接控制挂载/卸载 -->
    <div v-if="modalMode" class="diff-overlay" @click.self="closeModal">
      <div class="diff-modal glass">
        <div class="diff-modal-header">
          <span class="diff-modal-mode">{{ modalMode === 'diff' ? t('ws.diffMode') : t('ws.fileMode') }}</span>
          <code class="diff-modal-path">{{ modalPath }}</code>
          <span v-if="modalMode === 'file' && modalDirty" class="diff-dirty-mark">*</span>
          <span v-if="modalMode === 'diff' && modalDiff && !modalDiff.tooLarge && !modalDiff.binary"
                class="diff-modal-stats">
          <span v-if="modalDiff.added" class="fp-add">+{{ modalDiff.added }}</span>
          <span v-if="modalDiff.removed" class="fp-del">-{{ modalDiff.removed }}</span>
        </span>
          <div class="diff-modal-spacer"></div>
          <button v-if="modalMode === 'file' && !modalFileBinary && !modalMarkdown"
                  class="diff-save-btn" :title="t('common.save') + ' (Ctrl+S)'" @click="doSave">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>{{ t('common.save') }}</span>
          </button>
          <button class="fp-icon-btn" :title="t('ws.close') + ' (Esc)'" @click="closeModal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="diff-modal-body">
          <div v-if="modalLoading" class="fp-hint">{{ t('common.loading') }}</div>
          <div v-if="!modalLoading && modalMode === 'file' && modalFileBinary" class="fp-hint">
            {{ t('ws.binaryNoPreview') }}
          </div>
          <div v-if="!modalLoading && modalMode === 'diff' && modalDiff && modalDiff.binary" class="fp-hint">
            {{ t('ws.binaryNoDiff') }}
          </div>
          <div v-if="!modalLoading && modalMode === 'diff' && modalDiff && modalDiff.tooLarge" class="fp-hint">
            {{ t('ws.tooLargeNoDiff') }}
          </div>
          <div
              v-if="!modalLoading && modalMode === 'diff' && modalDiff && !modalDiff.binary && !modalDiff.tooLarge && (!modalDiff.lines || modalDiff.lines.length === 0)"
              class="fp-hint">{{ t('ws.noDiff') }}
          </div>
          <!-- Markdown 渲染预览（.md 文件不走 Monaco） -->
          <div v-if="!modalLoading && modalMode === 'file' && modalMarkdown" class="md-preview"
               v-html="modalMarkdown"></div>
          <!-- 单一容器，file 和 diff 共用，v-show 按模式切换（markdown 除外） -->
          <div ref="monacoContainer" class="monaco-container"
               v-show="!modalLoading && !modalMarkdown && ((modalMode === 'file' && !modalFileBinary) || (modalMode === 'diff' && modalDiff && !modalDiff.binary && !modalDiff.tooLarge && modalDiff.lines && modalDiff.lines.length > 0))"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════
   WorkspaceView 样式
   采用 CSS 变量体系（定义于全局 theme），支持深色/浅色主题切换。
   布局：flex 三栏（侧栏 380px + 主区域自适应 + 文件面板 360px）
   ═══════════════════════════════════════════ */

/* ═══════════ 整体布局 Layout ═══════════ */
.app {
  display: flex;
  height: 100%;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-body);
}

/* ═══════════ 侧栏 Sidebar ═══════════ */
/* 左侧固定 380px，flex 纵向排列：顶部 → 项目列表 → 底部状态 */
.sidebar {
  width: 380px;
  background: var(--bg-base);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 18px 14px;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: var(--accent);
  flex-shrink: 0;
}

.brand-mark svg {
  width: 28px;
  height: 28px;
}

.brand-name {
  font-family: var(--font-heading);
  font-size: 21px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.brand-sub {
  font-size: 14px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  margin-top: -1px;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.icon-btn svg {
  width: 20px;
  height: 20px;
}

.icon-btn:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}

/* ── 搜索框区域 Search ── */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px 12px;
}

.search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.search-input {
  flex: 1;
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

.search-input:focus {
  border-color: var(--accent);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.add-project-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-project-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(233, 69, 96, 0.06);
}

/* ── 项目列表区域 Project list ── */
.project-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.icon-btn-sm {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all var(--transition-fast);
}

.icon-btn-sm svg {
  width: 16px;
  height: 16px;
}

.icon-btn-sm:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}

.project-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  cursor: pointer;
  transition: all var(--transition-normal);
  border: 1px solid transparent;
  position: relative;
}

.project-card:hover {
  background: var(--bg-raised);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.project-card.active {
  background: var(--bg-raised);
  border-color: rgba(233, 69, 96, 0.25);
  box-shadow: inset 3px 0 0 var(--accent);
}

.project-icon {
  font-size: 24px;
  flex-shrink: 0;
  width: 32px;
  text-align: center;
  color: var(--text-muted);
}

.project-icon svg {
  width: 24px;
  height: 24px;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-name {
  font-size: 17px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-path {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: normal;
  word-break: break-all;
  line-height: 1.3;
  margin-top: 2px;
}

.project-meta {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
  display: flex;
  gap: 4px;
}

.project-meta .dot {
  opacity: 0.4;
}

.active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  box-shadow: 0 0 6px var(--success);
}

.add-session-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  width: 30px;
  height: 30px;
  border-radius: var(--radius-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: all var(--transition-fast);
}

.add-session-btn svg {
  width: 16px;
  height: 16px;
}

.project-card:hover .add-session-btn {
  opacity: 1;
}

.add-session-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(233, 69, 96, 0.06);
}

/* ── 会话子列表 Session sublist ── */
.project-group {
  display: flex;
  flex-direction: column;
}

.session-sublist {
  display: flex;
  flex-direction: column;
  margin-left: 16px;
  border-left: 1px solid var(--border);
  padding-left: 10px;
  gap: 1px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-muted);
}

.session-item > svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.session-item:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}

.session-item.selected {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: inset 2px 0 0 var(--accent-gold);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 15px;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-id-text {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-top: 2px;
}

.session-del {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  opacity: 0;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
}

.session-del svg {
  width: 15px;
  height: 15px;
}

.session-item:hover .session-del {
  opacity: 1;
}

.session-del:hover {
  color: var(--error);
  background: rgba(248, 81, 73, 0.1);
}

.show-more-btn {
  background: none;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 10px;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-family: var(--font-body);
  text-align: center;
  margin-top: 4px;
  transition: all var(--transition-fast);
}

.show-more-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.empty-hint {
  text-align: center;
  padding: 24px;
  font-size: 15px;
  color: var(--text-muted);
}

.empty-state {
  text-align: center;
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-state p {
  font-size: 15px;
  color: var(--text-secondary);
}

.empty-state span {
  font-size: 13px;
  color: var(--text-muted);
}

/* ── 侧栏底部状态 Sidebar bottom ── */
.sidebar-bottom {
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gateway-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.gw-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.dot-indicator.online {
  background: var(--success);
  box-shadow: 0 0 6px rgba(63, 185, 80, 0.4);
}

.gw-ver {
  color: var(--text-muted);
  opacity: 0.6;
  font-size: 15px;
}

/* ── 侧栏最小化 agent 状态指示 Subagent panel mini ── */
.subagent-panel-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-deep);
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.subagent-panel-mini-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-gold);
  animation: pulseGlow 1.5s ease-in-out infinite;
}

/* ── 内联 Agent 运行卡片（消息区中部）── */
.agent-runs-card {
  margin: 4px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--bg-raised);
  overflow: hidden;
  animation: fadeInUp 0.3s var(--ease-out);
}

.agent-runs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.agent-runs-ico {
  color: var(--accent-gold);
  flex-shrink: 0;
}

.agent-runs-title {
  font-family: var(--font-heading);
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.agent-runs-summary {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-muted);
}

.agent-runs-mini {
  font-family: var(--font-mono);
  font-size: 10px;
}

.agent-runs-mini.running {
  color: var(--accent-gold);
}

.agent-runs-mini.done {
  color: var(--success);
}

.agent-runs-mini.error {
  color: var(--error);
}

.agent-run-item {
  border-bottom: 1px solid var(--border);
}

.agent-run-item:last-child {
  border-bottom: none;
}

.agent-run-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.agent-run-summary:hover {
  background: var(--bg-deep);
}

.agent-run-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 0.2s;
}

.agent-run-chevron.open {
  transform: rotate(90deg);
}

.agent-run-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-run-dot.spawning {
  background: var(--text-muted);
}

.agent-run-dot.running {
  animation: pulseGlow 1.5s ease-in-out infinite;
}

.agent-run-dot.done {
  background: var(--success);
}

.agent-run-dot.error {
  background: var(--error);
}

.agent-run-type {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-weight: 500;
  flex-shrink: 0;
}

.agent-run-desc {
  flex: 1;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.agent-run-status {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
}

.agent-run-status.spawning {
  color: var(--text-muted);
}

.agent-run-status.running {
  color: var(--accent-gold);
}

.agent-run-status.done {
  color: var(--success);
}

.agent-run-status.error {
  color: var(--error);
}

.agent-run-duration {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  min-width: 40px;
  text-align: right;
}

.agent-run-duration.running {
  color: var(--accent-gold);
}

.agent-run-source {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-transform: uppercase;
}

.agent-run-source.workflow {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}

/* ── Agent 进度条 ── */
.agent-run-bar-wrap {
  height: 2px;
  background: var(--bg-deep);
  margin: 0 12px;
}

.agent-run-bar {
  height: 100%;
  transition: width 0.3s;
}

.agent-run-bar.spawning {
  width: 0;
  background: var(--text-muted);
}

.agent-run-bar.running {
  background: linear-gradient(90deg, var(--accent-gold) 0%, var(--accent-blue) 50%, var(--accent-gold) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}

.agent-run-bar.done {
  width: 100%;
  background: var(--success);
}

.agent-run-bar.error {
  width: 100%;
  background: var(--error);
}

/* ── Agent 展开详情 ── */
.agent-run-detail {
  padding: 6px 12px 10px 28px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-deep);
  border-top: 1px solid var(--border);
}

.agent-run-progress-text {
  padding: 4px 0 6px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.agent-run-timeline {
  display: flex;
  align-items: flex-start;
  padding: 4px 0 8px;
}

.agent-run-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  color: var(--text-muted);
  position: relative;
}

.agent-run-step.active {
  color: var(--text-primary);
}

.agent-run-step + .agent-run-step::before {
  content: '';
  position: absolute;
  top: 5px;
  right: 50%;
  width: 100%;
  height: 1px;
  background: var(--border);
}

.agent-run-step.active + .agent-run-step.active::before {
  background: var(--accent-gold);
}

.agent-run-step + .agent-run-step {
  z-index: 0;
}

.agent-run-step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border);
  z-index: 1;
}

.agent-run-step.active .agent-run-step-dot {
  background: var(--accent-gold);
}

.agent-run-step-label {
  font-size: 10px;
  font-weight: 500;
  z-index: 1;
}

.agent-run-step-time {
  font-size: 9px;
  font-family: var(--font-mono);
  z-index: 1;
}

.agent-run-full-desc {
  padding: 6px 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

.agent-run-desc-label {
  font-weight: 600;
  color: var(--text-muted);
}

.agent-run-wf-hint {
  font-size: 10px;
  color: var(--accent-blue);
  padding: 4px 0 0;
}

/* ═══════════ 主区域 Main Area ═══════════ */
/* 自适应宽度，顶部径向渐变增加层次感 */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(233, 69, 96, 0.03), transparent),
  var(--bg-deep);
}

/* ── 欢迎页 Welcome ── */
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  position: relative;
}

.welcome-glow {
  position: absolute;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(233, 69, 96, 0.06), transparent 70%);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.welcome-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: rgba(233, 69, 96, 0.06);
  color: var(--accent);
  opacity: 0.9;
  animation: fadeIn 0.6s var(--ease-out);
}

.welcome-icon svg {
  width: 64px;
  height: 64px;
}

.welcome h1 {
  font-family: var(--font-heading);
  font-size: 34px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.5px;
  animation: fadeInUp 0.5s var(--ease-out) 0.1s both;
}

.welcome p {
  color: var(--text-secondary);
  font-size: 16px;
  max-width: 380px;
  text-align: center;
  animation: fadeInUp 0.5s var(--ease-out) 0.2s both;
}

.quick-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
  animation: fadeInUp 0.5s var(--ease-out) 0.3s both;
}

.quick-project {
  background: var(--bg-base);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 10px 18px;
  border-radius: var(--radius-card);
  font-size: 15px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.quick-project:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
}

/* ── 聊天顶部栏 Chat header ── */
/* ═══ 多会话标签页栏 ═══ */
.tab-bar {
  display: flex; gap: 4px;
  padding: 6px 12px 0;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.tab-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px;
  border-radius: 8px 8px 0 0;
  background: var(--bg-deep);
  border: 1px solid transparent;
  border-bottom: none;
  font-size: 12px; color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body);
  transition: all 0.15s ease;
}
.tab-chip:hover { background: var(--bg-raised); color: var(--text-secondary); }
.tab-chip.active {
  background: var(--bg-base);
  color: var(--text-primary);
  border-color: var(--border);
}
.tab-label { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.tab-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.tab-status-dot.thinking { background: var(--accent); animation: tabPulse 0.8s ease-in-out infinite; }
.tab-status-dot.idle { background: var(--success); }
.tab-status-dot.connected { background: var(--accent-blue); }
@keyframes tabPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
.tab-close {
  background: none; border: none; color: inherit;
  cursor: pointer; padding: 0; display: flex;
  opacity: 0; transition: opacity 0.15s;
}
.tab-chip:hover .tab-close { opacity: 1; }
.tab-close:hover { color: var(--error); }

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
}

.header-project {
  color: var(--accent);
  font-weight: 500;
  font-family: var(--font-heading);
}

.header-sep {
  color: var(--border);
}

.header-session {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 13px;
}

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.idle {
  background: var(--success);
  box-shadow: 0 0 8px rgba(63, 185, 80, 0.4);
}

.status-dot.thinking {
  background: var(--warning);
  box-shadow: 0 0 8px rgba(210, 153, 34, 0.5);
  animation: breathe 2s ease-in-out infinite;
}

.status-label {
  color: var(--text-muted);
  font-size: 13px;
}

/* ── 消息列表 Messages ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scroll-bottom-btn {
  align-self: flex-end;
  flex-shrink: 0;
  position: sticky;
  bottom: 8px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-md);
  z-index: 10;
  transition: opacity .2s, transform .2s;
  animation: fade-in-up .2s ease;
}
.scroll-bottom-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
  transform: translateY(-2px);
}

.msg-row {
  display: flex;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.assistant {
  justify-content: flex-start;
}

.msg-row.system, .msg-row.thinking {
  justify-content: center;
}

.msg-row.error {
  justify-content: center;
}

.sys-msg {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
  animation: fadeIn 0.3s var(--ease-out);
}

.sys-time {
  opacity: 0.5;
}

.err-msg {
  font-size: 14px;
  color: var(--error);
  background: rgba(248, 81, 73, 0.08);
  border: 1px solid rgba(248, 81, 73, 0.15);
  padding: 8px 16px;
  border-radius: var(--radius-btn);
  animation: fadeIn 0.3s var(--ease-out);
}

/* ── 思考块 Thinking ── */
/* 使用 <details> 原生展开/折叠，外观低调融入聊天流 */
.think-details {
  max-width: 680px;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  background: var(--bg-deep);
  overflow: hidden;
  transition: border-color var(--transition-fast);
}

.think-details[open] {
  border-color: var(--border-hover);
}

.think-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  list-style: none; /* 隐藏默认三角 */
  transition: color var(--transition-fast);
}

.think-summary::-webkit-details-marker {
  display: none;
}

.think-summary:hover {
  color: var(--text-secondary);
}

.think-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--accent-blue);
  background: rgba(107, 174, 224, 0.12);
  border: 1px solid rgba(107, 174, 224, 0.25);
  flex-shrink: 0;
  line-height: 1.4;
}

.think-dot-icon {
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.6;
}

.think-preview {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  color: var(--text-muted);
}

.think-time {
  flex-shrink: 0;
  opacity: 0.45;
  font-size: 11px;
}

.think-content {
  padding: 10px 14px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  max-height: 280px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-base);
}

/* ── Markdown 渲染样式 ── */
/* ⚠️ 必须使用 :deep() 包裹，因为 Markdown 内容通过 v-html 注入，不会获得 Vue scoped 的 data-v-xxx 属性 */
/* :deep(.foo) 编译为 [data-v-xxx] .foo —— 只要求祖先（组件模板元素）有 scoped 属性，v-html 子元素不受限 */

/* 表格外层滚动容器 */
:deep(.md-table-wrap) {
  overflow-x: auto;
  margin: 10px 0;
  border-radius: var(--radius-btn);
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.12);
}

/* 表格 */
:deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-family: var(--font-mono);
  white-space: normal;
}

:deep(.md-table th),
:deep(.md-table td) {
  padding: 7px 12px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  white-space: normal;
  min-width: 60px;
}

:deep(.md-table th:first-child),
:deep(.md-table td:first-child) {
  white-space: nowrap;
  min-width: 0;
}

:deep(.md-table th:last-child),
:deep(.md-table td:last-child) {
  border-right: none;
}

:deep(.md-table th) {
  background: var(--bg-deep);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  border-bottom: 2px solid var(--border-hover);
}

:deep(.md-table td) {
  color: var(--text-secondary);
}

:deep(.md-table tbody tr:nth-child(even) td) {
  background: rgba(128, 128, 128, 0.04);
}

:deep(.md-table tbody tr:hover td) {
  background: rgba(128, 128, 128, 0.08);
}

/* 代码块 */
:deep(.md-code) {
  position: relative;
  display: block;
  margin: 10px 0;
  padding: 12px 16px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
  color: var(--text-secondary);
}

:deep(.md-code .md-code-lang) {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

/* 行内代码 */
:deep(.md-inline) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--accent-blue);
  white-space: normal;
}

/* 标题 */
:deep(.md-h) {
  margin: 12px 0 6px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  white-space: normal;
}

:deep(h2.md-h) {
  font-size: 1.25em;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

:deep(h3.md-h) {
  font-size: 1.12em;
}

:deep(h4.md-h) {
  font-size: 1.05em;
}

:deep(h5.md-h) {
  font-size: 0.98em;
  color: var(--text-secondary);
}

/* 有序列表 */
:deep(.md-ol) {
  margin: 8px 0;
  padding-left: 24px;
  white-space: normal;
}

/* 无序列表 */
:deep(.md-ul) {
  margin: 6px 0;
  padding-left: 20px;
  white-space: normal;
}

:deep(.md-li) {
  margin: 3px 0;
  font-size: inherit;
  color: inherit;
  white-space: normal;
}

/* 引用块 */
:deep(.md-blockquote) {
  margin: 10px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--accent-blue);
  background: rgba(107, 174, 224, 0.06);
  border-radius: 0 var(--radius-btn) var(--radius-btn) 0;
  font-style: italic;
  color: var(--text-secondary);
  white-space: normal;
}

/* 链接 */
:deep(.md-link) {
  color: var(--accent-blue);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color var(--transition-fast);
  white-space: normal;
}

:deep(.md-link:hover) {
  color: var(--accent);
}

/* 删除线 */
:deep(.md-del) {
  text-decoration: line-through;
  opacity: 0.7;
}

/* 水平线 */
:deep(.md-hr) {
  margin: 14px 0;
  border: none;
  border-top: 1px solid var(--border);
  opacity: 0.6;
}

/* 加粗 / 斜体（v-html 生成的 <strong>/<em> 也需要穿透） */
:deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

:deep(em) {
  font-style: italic;
  color: var(--text-secondary);
}

/* 用户气泡内 markdown 子元素 — 蓝底白字覆盖 */
:deep(.bubble.user .md-h),
:deep(.bubble.user strong),
:deep(.bubble.user em) {
  color: #fff;
}

:deep(.bubble.user .md-code) {
  background: rgba(0, 0, 0, 0.25);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.85);
}

:deep(.bubble.user .md-inline) {
  background: rgba(0, 0, 0, 0.22);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.92);
}

:deep(.bubble.user .md-link) {
  color: rgba(255, 255, 255, 0.9);
  text-decoration-color: rgba(255, 255, 255, 0.5);
}

:deep(.bubble.user .md-blockquote) {
  background: rgba(255, 255, 255, 0.08);
  border-left-color: rgba(255, 255, 255, 0.35);
  color: rgba(255, 255, 255, 0.85);
}

:deep(.bubble.user .md-table th),
:deep(.bubble.user .md-table td) {
  color: rgba(255, 255, 255, 0.88);
  border-color: rgba(255, 255, 255, 0.15);
}

/* ── 思考动画骨架 Thinking skeleton ── */
/* 三个呼吸圆点，表示 AI 正在生成回复 */
.thinking-indicator {
  display: flex;
  gap: 5px;
  padding: 12px 0;
  align-self: flex-start;
}

.think-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-gold);
  animation: pulseGlow 1.4s ease-in-out infinite;
}

.think-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.think-dot:nth-child(3) {
  animation-delay: 0.4s;
}

/* ── 消息气泡 Bubbles ── */
/* 用户气泡：右对齐，品牌色背景白色文字；AI 气泡：左对齐，深色背景边框 */
.bubble {
  position: relative;
  max-width: 94%;
  min-width: 100px;
  padding: 14px 18px;
  font-size: 15px;
  line-height: 1.65;
  animation: fadeInUp 0.3s var(--ease-out);
}

/* 气泡操作图标：复制 / 回填，悬停显示 */
.bubble-actions {
  display: flex;
  gap: 4px;
  position: absolute;
  bottom: 6px;
  right: 8px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.bubble:hover .bubble-actions {
  opacity: 1;
}

.bubble-act-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.bubble-act-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.bubble.user .bubble-act-btn {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}

.bubble.user .bubble-act-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.bubble.user {
  background: var(--bubble-user-bg);
  color: #fff;
  border-radius: var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble);
  box-shadow: var(--shadow-sm);
}

.bubble.assistant {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 4px;
  box-shadow: var(--shadow-sm);
}

.bubble-label {
  font-size: 12px;
  opacity: 0.5;
  margin-bottom: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.bubble-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}

/* ── 工具调用卡片 Tool usage cards ── */
/* 可折叠列表，展示本次 assistant 回复中的所有工具调用 */
.tools-box {
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  overflow: hidden;
  max-width: 600px;
  background: var(--bg-deep);
}

.tools-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--text-muted);
  transition: background var(--transition-fast);
}

.tools-toggle:hover {
  background: var(--bg-raised);
}

.tools-chevron {
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.tools-chevron.open {
  transform: rotate(90deg);
}

.tools-total-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-gold);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 8px;
}

.tool-card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}

.tool-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.tool-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(107, 174, 224, 0.12);
  color: var(--accent-blue);
}

.tool-time {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.tool-detail {
  font-size: 11px;
}

.tool-file {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-gold);
  padding: 3px 6px;
  background: rgba(212, 168, 83, 0.06);
  border-radius: 3px;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-bash {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--success);
  padding: 4px 8px;
  background: rgba(63, 185, 80, 0.06);
  border-radius: 3px;
  word-break: break-all;
}

.tool-diff-lines {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.diff-old {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(248, 81, 73, 0.08);
  color: #f8514988;
  border-radius: 2px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-new {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(63, 185, 80, 0.08);
  color: #3fb95088;
  border-radius: 2px;
  white-space: pre-wrap;
  word-break: break-all;
}

.tool-content-preview {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  padding: 3px 6px;
  background: var(--bg-deep);
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 80px;
  overflow-y: auto;
}

.tool-input-json {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  display: block;
  padding: 3px 6px;
  word-break: break-all;
}

/* ── 控制栏 Controls ── */
.controls-bar {
  display: flex;
  gap: 20px;
  padding: 10px 24px;
  background: var(--bg-base);
  border-top: 1px solid var(--border);
  align-items: center;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 500;
}

.control-select {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 5px 28px 5px 10px;
  border-radius: 20px;
  font-size: 13px;
  font-family: var(--font-body);
  outline: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23565B6E' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.control-select:hover {
  border-color: var(--border-hover);
}

.control-select:focus {
  border-color: var(--accent);
}

.spacer {
  flex: 1;
}

/* Agent 面板入口按钮（控制栏内） */
.agent-panel-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--accent-blue);
  border-radius: var(--radius-btn);
  background: rgba(107, 174, 224, 0.08);
  color: var(--accent-blue);
  font-size: 12px;
  font-family: var(--font-mono);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.agent-panel-btn:hover {
  background: rgba(107, 174, 224, 0.16);
}

.agent-panel-btn.active {
  background: rgba(107, 174, 224, 0.16);
  border-color: var(--accent-blue);
}

.agent-panel-btn.pulse {
  animation: agentBtnPulse 2s ease-in-out infinite;
}

.agent-btn-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-btn-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent-gold);
  color: #1A1D28;
  font-size: 10px;
  font-weight: 700;
}

.agent-panel-chevron {
  display: flex;
  align-items: center;
  transition: transform var(--transition-fast);
}

.agent-panel-chevron svg {
  width: 12px;
  height: 12px;
}

.agent-panel-chevron.open {
  transform: rotate(90deg);
}

@keyframes agentBtnPulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(107, 174, 224, 0.3);
  }
  50% {
    box-shadow: 0 0 8px 2px rgba(107, 174, 224, 0.5);
  }
}

/* 记录点按钮：品牌色渐变背景，「记录点」+ 数量 badge，点击弹出向上展开的下拉列表 */
.cp-control {
  position: relative;
}

.cp-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-body);
  padding: 6px 14px;
  border-radius: 20px;
  background: linear-gradient(135deg, var(--accent), #d43d54);
  border: 1px solid transparent;
  box-shadow: 0 2px 8px rgba(233, 69, 96, 0.28);
  transition: all var(--transition-fast);
}

.cp-tab:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(233, 69, 96, 0.4);
}

.cp-tab.open {
  box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.25), 0 2px 8px rgba(233, 69, 96, 0.3);
}

.cp-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}

.cp-head-title {
  flex: 1;
}

.cp-commit-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 16px; border-radius: 6px;
  font-size: 13px; font-weight: 600; font-family: var(--font-body);
  background: rgba(63, 185, 80, 0.15);
  border: 1px solid rgba(63, 185, 80, 0.35);
  color: var(--success); cursor: pointer;
  transition: all var(--transition-fast);
}
.cp-commit-btn:hover:not(:disabled) { background: rgba(63, 185, 80, 0.25); border-color: var(--success); }
.cp-commit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 59;
}

.cp-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 380px;
  max-height: 440px;
  z-index: 60;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cp-dropdown-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cp-dropdown-body {
  overflow-y: auto;
  max-height: 392px;
}

/* 本轮 token 迷你条：输入(蓝) · 思考估算(金) · 纯输出(绿)，只在本轮有 token 消耗时显示 */
.token-mini {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
  flex-shrink: 0;
  user-select: none;
}

.tm-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 500;
}

.tm-in {
  color: var(--accent-blue);
}

.tm-think {
  color: var(--accent-gold);
}

.tm-out {
  color: var(--success);
}

.tm-sep {
  color: var(--text-muted);
  opacity: 0.5;
}

/* tooltip 内行内标注（"约" / "纯"） */
.tt-row small {
  font-size: 10px;
  opacity: 0.55;
  margin-left: 2px;
  font-weight: 400;
}

/* ── 上下文圆环 Context ring ── */
/* 悬停放大，warning 时金色发光；圆环显示百分比，tooltip 显示完整 token/费用明细 */
.context-ring {
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-normal);
}

.context-ring:hover {
  transform: scale(1.08);
}

.context-ring.warning .ring-glow {
  filter: drop-shadow(0 0 3px rgba(210, 153, 34, 0.5));
}

.ring-glow {
  filter: drop-shadow(0 0 3px rgba(91, 155, 213, 0.3));
}

.ring-tooltip {
  display: none;
  position: absolute;
  bottom: 48px;
  right: -10px;
  background: var(--bg-glass) !important;
  backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 12px 16px;
  width: 210px;
  z-index: 10;
  box-shadow: var(--shadow-lg);
}

.context-ring:hover .ring-tooltip {
  display: block;
}

.tt-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--warning);
  background: rgba(210, 153, 34, 0.1);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 8px;
}

.tt-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 3px 0;
}

.tt-row span:last-child {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.tt-sep {
  border-top: 1px solid var(--border);
  margin: 5px 0;
}

/* ── 输入区域 Input ── */
.input-area {
  padding: 10px 24px 18px;
  background: var(--bg-base);
  border-top: 1px solid var(--border);
}

/* 电子宠物区域 */
/* 宠物覆盖层：全 main-area 自由漫步，点击穿透 */
.pet-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

/* 静默 toast 提示 */
.toast {
  position: fixed;
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  max-width: 70%;
  background: var(--bg-glass, var(--bg-base));
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  color: var(--text-primary);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
}

.toast-fade-enter-active, .toast-fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.toast-fade-enter-from, .toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 斜杠命令补全菜单 */
.cmd-anchor {
  position: relative;
}

.cmd-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  z-index: 50;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.cmd-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border-radius: 8px;
  background: none;
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.cmd-item.active {
  background: var(--bg-raised);
}

.cmd-name {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}

.cmd-hint {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cmd-desc {
  font-size: 13px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Queue bar */
.queue-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.queue-label {
  font-size: 12px;
  color: var(--accent-gold);
  font-weight: 500;
  white-space: nowrap;
  padding-top: 4px;
}

.queue-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.queue-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(212, 168, 83, 0.08);
  border: 1px solid rgba(212, 168, 83, 0.2);
  border-radius: 6px;
  padding: 4px 6px 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 280px;
}

.chip-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.chip-send {
  background: none;
  border: 1px solid var(--accent-red, var(--accent));
  color: var(--accent);
  cursor: pointer;
  border-radius: 3px;
  padding: 2px 7px;
  font-size: 13px;
  transition: all var(--transition-fast);
}

.chip-send:hover {
  background: var(--accent);
  color: #fff;
}

.chip-remove {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  padding: 0 3px;
  line-height: 1;
  transition: color var(--transition-fast);
}

.chip-remove:hover {
  color: var(--error);
}

/* ═══ Prompt 模板条 ═══ */
.template-bar {
  display: flex; gap: 6px;
  padding: 8px 16px 0;
  flex-wrap: wrap;
}
.template-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 4px 12px;
  font-size: 12px; font-family: var(--font-body);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.template-chip :deep(svg) { width: 13px; height: 13px; display: block; flex-shrink: 0; }
.template-chip:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: var(--accent);
}

/* ═══ 内嵌宠物 ═══ */
.inline-pet {
  flex-shrink: 0;
  width: 50px; height: 60px;
  margin-right: 0;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 8px 8px 16px;
  transition: all var(--transition-normal);
}

.input-wrapper:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.1);
}

.input-wrapper textarea {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 16px;
  font-family: var(--font-body);
  outline: none;
  resize: none;
  max-height: 120px;
  line-height: 1.5;
  padding: 6px 0;
}

.input-wrapper textarea::placeholder {
  color: var(--text-muted);
}

.send-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-normal);
}

.send-btn:hover:not(:disabled) {
  background: #d43d54;
  transform: translateY(-1px);
  box-shadow: var(--shadow-glow);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.stop-btn {
  background: var(--error) !important;
}

.stop-btn:hover:not(:disabled) {
  background: #d43d3d !important;
  box-shadow: 0 0 14px rgba(248, 81, 73, 0.35) !important;
}

/* ═══════════ 动画 Animations ═══════════ */
/* loading spinner：用在项目卡片中，创建会话时旋转 */
.spinner {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}

/* ═══════════ 确认弹窗 Confirm Dialog ═══════════ */
/* 全屏半透明遮罩 + 居中毛玻璃卡片，用于提交/回退/删除等危险操作 */
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
  animation: fadeIn 0.15s var(--ease-out);
}

.confirm-dialog {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-modal);
  padding: 28px 32px;
  width: 380px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
  animation: fadeInUp 0.2s var(--ease-out);
}

.confirm-title {
  font-family: var(--font-heading);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.confirm-body {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 22px;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.confirm-btn.cancel {
  background: var(--bg-raised);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.confirm-btn.cancel:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.confirm-btn.danger {
  background: var(--error);
  color: #fff;
}

.confirm-btn.danger:hover {
  background: #d43d3d;
  box-shadow: 0 0 12px rgba(248, 81, 73, 0.3);
}

.confirm-btn.primary {
  background: var(--accent);
  color: #fff;
}

.confirm-btn.primary:hover {
  filter: brightness(1.1);
  box-shadow: var(--shadow-glow);
}

/* ═══════════ 文件选择性提交弹窗 Commit Files Dialog ═══════════ */
.commit-files-dialog {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-raised);
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 24px 24px 20px;
}

.commit-files-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 12px;
}

.commit-files-filter {
  display: flex;
  gap: 2px;
}

.commit-files-actions {
  display: flex;
  gap: 12px;
}

.commit-files-link {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.commit-files-link:hover {
  text-decoration: underline;
  color: var(--accent-hover);
}

.commit-files-list {
  flex: 1;
  overflow-y: auto;
  max-height: 45vh;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
}

.commit-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-bottom: 1px solid var(--border);
}

.commit-file-row:last-child {
  border-bottom: none;
}

.commit-file-row:hover {
  background: var(--bg-hover);
}

.commit-file-row.deleted .commit-file-path {
  text-decoration: line-through;
  opacity: 0.5;
}

.commit-file-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.commit-file-path {
  flex: 1;
  font-size: 14px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提交按钮在文件面板头部的高亮样式 */
.commit-btn:hover {
  background: rgba(233, 69, 96, 0.12);
  color: var(--accent);
  border-color: rgba(233, 69, 96, 0.25);
}

.commit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.commit-btn:disabled:hover {
  background: none;
  color: var(--text-muted);
  border-color: transparent;
}

/* 双通道确认横幅：内嵌在输入区上方，permission_request / choice_request 时显示 */
.confirm-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 10px;
  background: var(--bg-raised);
  border: 1px solid var(--accent);
  border-radius: 12px;
  animation: fadeInUp 0.2s;
}

.confirm-banner.choice {
  flex-direction: column;
  align-items: stretch;
}

.confirm-banner-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.confirm-banner-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(212, 168, 83, 0.08);
  color: var(--accent-gold);
  flex-shrink: 0;
}

.confirm-banner-icon svg {
  width: 18px;
  height: 18px;
}

.confirm-banner-text {
  min-width: 0;
}

.confirm-banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-banner-summary {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}

.confirm-banner-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.confirm-banner-question {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.confirm-banner-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-opt-btn {
  text-align: left;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.choice-opt-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ═══════════ 文件快照 Diff 面板 File Panel ═══════════ */
/* 顶部工具栏的切换按钮，激活时红色高亮 */
.panel-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-left: 6px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.panel-toggle-btn:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: var(--border);
}

.panel-toggle-btn.active {
  background: rgba(233, 69, 96, 0.1);
  color: var(--accent);
  border-color: rgba(233, 69, 96, 0.3);
}

/* 导出下拉菜单 */
.export-wrapper .export-dropdown {
  position: absolute;
  right: 0; top: 100%;
  margin-top: 6px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  z-index: 200;
  min-width: 180px;
}
.export-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  padding: 8px 14px;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  font-family: var(--font-body);
}
.export-item:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}

/* 三平台镜像开关 */
.mirror-toggle {
  width: auto;
  gap: 5px;
  padding: 2px 10px;
  font-size: 13px;
  opacity: 1;
}

.mirror-toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mirror-toggle:disabled:hover {
  background: none;
  color: var(--text-muted);
  border-color: transparent;
}

.mirror-toggle.active {
  font-weight: 500;
}

.mirror-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.mirror-label {
  font-size: 13px;
  line-height: 1;
}

/* 状态圆点 */
.mirror-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1.5px solid var(--text-muted);
  background: transparent;
  transition: all var(--transition-fast);
}

.mirror-dot.active {
  background: currentColor;
  border-color: currentColor;
}

.mirror-dot.inactive {
  border-color: currentColor;
  background: transparent;
}

.mirror-dot.unbound {
  border-color: var(--text-muted);
  background: transparent;
  opacity: 0.5;
}

/* 右侧文件面板容器 */
/* 右侧面板容器 */
.right-panels {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-panel {
  background: var(--bg-base);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.fp-title {
  font-size: 17px;
  font-weight: 600;
  font-family: var(--font-heading);
  color: var(--text-primary);
}

.fp-header-actions {
  display: flex;
  gap: 4px;
}

.fp-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.fp-icon-btn svg {
  width: 18px;
  height: 18px;
}

.fp-icon-btn:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: var(--border);
}

.fp-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.fp-filter-tab {
  font-size: 14px;
  padding: 5px 14px;
  border-radius: 12px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.fp-filter-tab:hover {
  color: var(--text-primary);
  border-color: var(--border-hover);
}

.fp-filter-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.fp-snap-time {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.fp-snap-time.warn {
  color: var(--warning);
}

.fp-tree {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.fp-hint {
  padding: 18px;
  text-align: center;
  font-size: 15px;
  color: var(--text-muted);
}

.fp-hint.warn {
  color: var(--warning);
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 15px;
  white-space: nowrap;
  transition: background var(--transition-fast);
}

.file-row:hover {
  background: var(--bg-raised);
}

.fp-chevron {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  color: var(--text-muted);
  transition: transform var(--transition-fast);
}

.fp-chevron.open {
  transform: rotate(90deg);
}

.fp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

.fp-name.dir {
  color: var(--text-primary);
  font-weight: 500;
}

.fp-name.deleted {
  text-decoration: line-through;
  opacity: 0.6;
}

.fp-file-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: transparent;
}

.fp-file-dot.added {
  background: var(--success);
}

.fp-file-dot.modified {
  background: var(--accent-gold);
}

.fp-file-dot.deleted {
  background: var(--error);
}

.fp-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
}

.fp-badge.a {
  background: rgba(63, 185, 80, 0.15);
  color: var(--success);
}

.fp-badge.m {
  background: rgba(212, 168, 83, 0.15);
  color: var(--accent-gold);
}

.fp-badge.d {
  background: rgba(248, 81, 73, 0.15);
  color: var(--error);
}

.fp-add {
  flex-shrink: 0;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--success);
}

.fp-del {
  flex-shrink: 0;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--error);
}

/* ── 记录点时间线 Checkpoint Timeline ── */
/* 每个记录点卡片：可展开/折叠，展开后显示变更文件列表 */
.cp-item {
  border-bottom: 1px solid var(--border);
}

.cp-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 12px;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.cp-head:hover {
  background: var(--bg-raised);
}

.cp-head .fp-chevron {
  margin-top: 4px;
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.cp-head .fp-chevron.open {
  transform: rotate(90deg);
}

.cp-main {
  flex: 1;
  min-width: 0;
}

.cp-prompt {
  font-size: 15px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-muted);
}

.cp-files {
  color: var(--text-secondary);
}

.cp-rewind-btn {
  flex-shrink: 0;
  padding: 5px 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cp-rewind-btn:hover:not(:disabled) {
  border-color: var(--error);
  color: var(--error);
}

.cp-rewind-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-files-list {
  padding: 2px 10px 12px 30px;
  background: var(--bg-deep);
}

.cp-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 14px;
}

.cp-file-row.disabled {
  opacity: 0.55;
}

.cp-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.cp-file-path.deleted {
  text-decoration: line-through;
  opacity: 0.6;
}

.cp-noreturn {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--warning);
}

.fp-diff-btn {
  flex-shrink: 0; margin-left: auto;
  font-size: 13px; font-weight: 600; font-family: var(--font-body);
  padding: 6px 14px; border-radius: 6px;
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  color: var(--text-primary); cursor: pointer;
  transition: all var(--transition-fast);
}
.fp-diff-btn:hover { background: var(--bg-raised); border-color: var(--border-hover); }

/* ── Diff / 文件内容 Modal ── */
/* 80vw×80vh 居中弹窗，header 显示模式+路径+行数统计，body 显示文件内容或 diff 行 */
/* top:40px 避开自定义标题栏，确保窗口控制按钮在 modal 打开时仍可点击 */
.diff-overlay {
  position: fixed;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 320;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s var(--ease-out);
}

.diff-modal {
  width: 80vw;
  max-width: 1100px;
  height: 80vh;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 10;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.diff-modal-mode {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 9px;
  border-radius: 4px;
  background: rgba(107, 174, 224, 0.12);
  color: var(--accent-blue);
}

.diff-modal-path {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.diff-modal-stats {
  display: flex;
  gap: 8px;
}

.diff-dirty-mark {
  font-weight: 700;
  color: var(--accent-gold, #D4A853);
  font-size: 18px;
  user-select: none;
}

.diff-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-body);
  font-weight: 500;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.diff-save-btn:hover {
  background: #d43d54;
  border-color: #d43d54;
}

.diff-modal-spacer {
  flex: 1;
}

/* Monaco 自带内部滚动，父容器 overflow:hidden 避免双滚动条+滚动条出现/消失
 * 引起容器宽度微小变化，防止 ResizeObserver 死循环卡死 */
.diff-modal-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* Monaco Editor 容器——简化为纯尺寸，无叠加/visibility hack */
.monaco-container {
  width: 100%;
  height: 100%;
}

/* Markdown 预览（.md 文件用 renderMarkdown 渲染，不走 Monaco） */
.md-preview {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 24px 32px;
  line-height: 1.8;
}

.md-preview :deep(h2) {
  font-size: 20px;
  font-weight: 600;
  margin: 24px 0 12px;
  color: var(--text-primary);
}

.md-preview :deep(h3) {
  font-size: 17px;
  font-weight: 600;
  margin: 20px 0 10px;
  color: var(--text-primary);
}

.md-preview :deep(h4) {
  font-size: 15px;
  font-weight: 600;
  margin: 16px 0 8px;
  color: var(--text-primary);
}

.md-preview :deep(p) {
  margin: 8px 0;
}

.md-preview :deep(ul), .md-preview :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.md-preview :deep(li) {
  margin: 4px 0;
}

.md-preview :deep(code) {
  font-size: 14px;
}

.md-preview :deep(pre) {
  margin: 12px 0;
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-deep);
  overflow: auto;
}

.md-preview :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--accent-blue);
  background: var(--bg-raised);
  border-radius: 0 6px 6px 0;
}

.md-preview :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
}

.md-preview :deep(th), .md-preview :deep(td) {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.md-preview :deep(th) {
  background: var(--bg-raised);
  font-weight: 600;
}

.md-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}

.md-preview :deep(a) {
  color: var(--accent-blue);
  text-decoration: none;
}

.md-preview :deep(a:hover) {
  text-decoration: underline;
}

.md-preview :deep(strong) {
  font-weight: 600;
}

/* ── Workflow 多 Agent 运行卡片（消息区底部） ── */
.wf-agents-card {
  margin: 10px 16px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
}

.wf-agents-hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 2px 0;
}

.wf-agents-hdr:hover {
  opacity: 0.85;
}

.wf-agents-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.wf-agents-count {
  font-size: 10px;
  color: var(--text-muted);
}

.wf-agents-chevron {
  transition: transform .2s;
  flex-shrink: 0;
  color: var(--text-muted);
}

.wf-agents-chevron.open {
  transform: rotate(180deg);
}

.wf-agents-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.wf-agent-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.wf-agent-tag.running {
  border-color: var(--accent-gold);
  color: var(--accent-gold);
}

.wf-agent-tag.done {
  border-color: var(--success);
  color: var(--success);
}

.wf-agent-tag.error {
  border-color: var(--error);
  color: var(--error);
}

.wf-ag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.wf-agent-tag.running .wf-ag-dot {
  background: var(--accent-gold);
  animation: wf-dot-pulse 1.2s ease-in-out infinite;
}

.wf-agent-tag.done .wf-ag-dot {
  background: var(--success);
}

.wf-agent-tag.error .wf-ag-dot {
  background: var(--error);
}

@keyframes wf-dot-pulse {
  0%, 100% {
    opacity: 1
  }
  50% {
    opacity: .3
  }
}

/* ── Workflow 详情面板（右侧栏） ── */
.wf-detail-panel {
  background: var(--bg-base);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wf-phases-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.wf-phase-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--border);
}

.wf-phase-dot.running {
  background: var(--accent-gold);
  box-shadow: 0 0 6px rgba(233, 69, 96, 0.5);
}

.wf-phase-dot.done {
  background: var(--success);
}

.wf-phase-line {
  flex: 1;
  height: 1px;
  background: var(--border);
  min-width: 12px;
}

.wf-phase-line.done {
  background: var(--accent);
}

.wf-agents-list {
  flex-shrink: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  max-height: 140px;
  overflow-y: auto;
}

.wf-agent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}

.wf-ag-row-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--border);
}

.wf-ag-row-dot.running {
  background: var(--accent-gold);
  animation: wf-dot-pulse 1.2s ease-in-out infinite;
}

.wf-ag-row-dot.done {
  background: var(--success);
}

.wf-ag-row-dot.error {
  background: var(--error);
}

.wf-ag-row-label {
  font-size: 11px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  flex: 1;
}

.wf-ag-row-status {
  font-size: 11px;
  color: var(--text-muted);
}

.wf-logs {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  font-size: 10px;
}

.wf-log-line {
  display: flex;
  gap: 4px;
  padding: 2px 12px;
  font-family: var(--font-mono);
}

.wf-log-phase {
  flex-shrink: 0;
  color: var(--accent-gold);
  font-weight: 500;
  min-width: 40px;
}

.wf-log-msg {
  color: var(--text-muted);
  word-break: break-all;
}

/* ── 右侧 Agent 详情面板（原生 Task 子 Agent）── */
.ag-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ag-panel-empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.ag-panel-card {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
}

.ag-panel-card.running {
  border-color: var(--accent-gold);
}

.ag-panel-card.done {
  border-color: var(--success);
  opacity: 0.82;
}

.ag-panel-card.error {
  border-color: var(--error);
}

.ag-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.ag-card-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--border);
}

.ag-card-dot.running {
  background: var(--accent-gold);
  animation: wf-dot-pulse 1.2s ease-in-out infinite;
}

.ag-card-dot.done {
  background: var(--success);
}

.ag-card-dot.error {
  background: var(--error);
}

.ag-card-type {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  flex: 1;
}

.ag-card-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.ag-card-status.spawning {
  color: var(--text-muted);
  background: var(--bg-deep);
}

.ag-card-status.running {
  color: var(--accent-gold);
  background: rgba(212, 168, 83, 0.1);
}

.ag-card-status.done {
  color: var(--success);
  background: rgba(63, 185, 80, 0.08);
}

.ag-card-status.error {
  color: var(--error);
  background: rgba(233, 69, 96, 0.08);
}

.ag-card-time {
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.ag-card-time.running {
  color: var(--accent-gold);
}

.ag-card-desc {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
  padding: 8px 10px;
  background: var(--bg-deep);
  border-radius: 6px;
}

.ag-card-desc span {
  word-break: break-word;
}

.ag-card-progress {
  margin-bottom: 6px;
}

.ag-card-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 6px;
}

/* 不确定进度条：跑马灯滑动光条 */
.ag-card-bar-indeterminate {
  height: 100%;
  width: 100%;
  border-radius: 2px;
  position: relative;
  background: linear-gradient(90deg, transparent 0%, var(--accent-gold) 15%, var(--accent-gold) 35%, transparent 50%);
  background-size: 200% 100%;
  animation: agentIndeterminate 1.6s ease-in-out infinite;
}

@keyframes agentIndeterminate {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* 完成后的实心绿色条 */
.ag-card-bar-fill.done {
  height: 100%;
  width: 100%;
  border-radius: 2px;
  background: var(--success);
}

.ag-card-tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.ag-card-tool-time {
  color: var(--accent-gold);
}

.ag-card-elapsed {
  color: var(--text-muted);
  margin-left: auto;
}

.ag-card-timeline {
  display: flex;
  gap: 0;
  border-top: 1px solid var(--border);
  padding-top: 8px;
  margin-top: 2px;
}

.ag-card-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ag-step-label {
  font-size: 11px;
  color: var(--text-muted);
}

.ag-step-time {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.ag-card-record {
  font-size: 11px;
  color: var(--success);
  border-top: 1px solid var(--border);
  padding-top: 6px;
  margin-top: 6px;
}
</style>
