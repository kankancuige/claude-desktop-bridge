<script setup lang="ts">
/**
 * App.vue - 应用根组件
 * ── 功能说明 ──
 * 1. 主题管理: 从 gateway 后端获取用户主题偏好，支持 system/dark/light 三种模式
 * 2. 系统主题监听: 当用户选择 system 模式时，实时响应 OS 主题变化
 * 3. Claude Code 检测: 启动后延迟检查 claude-code CLI 是否已安装，未找到则弹窗提示
 * 4. 自定义标题栏: 通过 electronAPI 控制窗口最小化/最大化/关闭
 * 5. 路由视图: 使用 keep-alive 缓存 WorkspaceView，切换路由不丢失会话状态
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { t } from './i18n'

// ── gateway 后端地址 ──
const GW = 'http://127.0.0.1:3456'

/**
 * ── detectSystemTheme ──
 * 功能说明: 检测当前操作系统的主题偏好（dark 或 light）
 * 实现方式: 使用 window.matchMedia 查询 prefers-color-scheme 媒体特性
 * 注意: matchMedia 可能返回 undefined（极旧浏览器），使用可选链保护
 * @returns {'dark' | 'light'} 系统主题
 */
function detectSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * ── applyTheme ──
 * 功能说明: 将主题应用到 document.documentElement 的 data-theme 属性上
 * 实现方式: 如果传入 'system'，先调用 detectSystemTheme 解析为实际 dark/light 值
 *           CSS 变量通过 [data-theme="dark"] / [data-theme="light"] 选择器切换
 * SIDE_EFFECT: 修改 document.documentElement.dataset.theme
 * @param {string} t - 主题标识: 'system' | 'dark' | 'light'
 */
function applyTheme(t: string) {
  document.documentElement.dataset.theme = t === 'system' ? detectSystemTheme() : t
}

/**
 * ── currentTheme ──
 * 当前生效的主题设置，初始值 'system'，启动后通过 applyInitialTheme 覆盖
 * 注意: 非 ref，因为 theme 变化通过 data-theme 属性驱动 CSS，不需要 Vue 响应式追踪
 */
let currentTheme = 'system'

/**
 * ── applyInitialTheme ──
 * 功能说明: 应用启动时从 gateway 后端获取用户保存的主题偏好并应用
 * 实现方式:
 *   1. GET /api/config/settings 获取用户设置 JSON
 *   2. 如果有 theme 字段，更新 currentTheme
 *   3. 调用 applyTheme 应用主题
 *   4. 请求失败（如 gateway 尚未启动）则静默回退到 system 默认值
 * 注意: catch 块为空是设计上的宽松处理——gateway 未就绪不应阻塞 UI 渲染
 */
async function applyInitialTheme() {
  try {
    const res = await fetch(`${GW}/api/config/settings`)
    if (res.ok) {
      const s = await res.json()
      if (s.theme) currentTheme = s.theme
    }
  } catch {}
  applyTheme(currentTheme)
}

// ═══════════════════════════════════════════
// ── Claude Code 检测 ──
// ═══════════════════════════════════════════

/**
 * ── claudeMissing ──
 * true 表示 claude-code CLI 未安装，弹窗提示用户
 * false 表示已安装或尚未检测完成
 * SIDE_EFFECT: 绑定到模板 v-if，控制弹窗显示
 */
const claudeMissing = ref(false)

/**
 * ── claudeChecking ──
 * true 表示正在检测中，用于显示 loading 状态和禁用重试按钮
 * false 表示检测完成（无论结果）
 */
const claudeChecking = ref(true)

/**
 * ── manualPath ──
 * 用户在弹窗中手动输入的 Claude Code 路径
 */
const manualPath = ref('')

/**
 * ── manualPathChecking ──
 * 正在校验用户输入的路径
 */
const manualPathChecking = ref(false)

/**
 * ── manualPathResult ──
 * 路径校验结果: null=未检测, 'found'=有效, 'not_found'=无效
 */
const manualPathResult = ref<null | 'found' | 'not_found'>(null)

/**
 * ── manualPathSaved ──
 * 手动路径已保存到 settings.json
 */
const manualPathSaved = ref(false)

/**
 * ── getPlatformHint ──
 * 根据当前操作系统返回路径示例文案的 i18n key
 */
function getPlatformHint() {
  const p = (window as any).electronAPI?.platform || navigator.platform?.toLowerCase() || ''
  if (p === 'darwin' || p.includes('Mac')) return 'claudeMissing.manualMac'
  if (p === 'linux') return 'claudeMissing.manualLinux'
  return 'claudeMissing.manualWin'
}

/**
 * ── checkManualPath ──
 * 校验用户手动输入的 Claude Code 路径是否存在
 */
async function checkManualPath() {
  if (!manualPath.value.trim()) return
  manualPathChecking.value = true
  manualPathResult.value = null
  try {
    const res = await fetch(`${GW}/api/config/claude-status?path=${encodeURIComponent(manualPath.value.trim())}`)
    if (res.ok) {
      const d = await res.json()
      manualPathResult.value = d.found ? 'found' : 'not_found'
    }
  } catch { manualPathResult.value = 'not_found' }
  manualPathChecking.value = false
}

/**
 * ── saveManualPath ──
 * 将验证通过的路径保存到 settings.json
 */
async function saveManualPath() {
  if (manualPathResult.value !== 'found') return
  try {
    const res = await fetch(`${GW}/api/config/claude-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: manualPath.value.trim() }),
    })
    if (res.ok) {
      const d = await res.json()
      if (d.ok) {
        manualPathSaved.value = true
        claudeMissing.value = false
      }
    }
  } catch {}
}

/**
 * ── checkClaudeStatus ──
 * 功能说明: 查询 gateway 后端确认 claude-code CLI 是否已安装
 * 实现方式: GET /api/config/claude-status，响应 { found: boolean }
 *           未找到时设置 claudeMissing = true 触发全局弹窗
 *           请求失败（gateway 未启动）静默处理，等待后续重试
 */
async function checkClaudeStatus() {
  claudeChecking.value = true
  manualPathResult.value = null
  manualPathSaved.value = false
  try {
    const res = await fetch(`${GW}/api/config/claude-status`)
    if (res.ok) {
      const d = await res.json()
      claudeMissing.value = !d.found
    }
  } catch {}
  claudeChecking.value = false
}

// ═══════════════════════════════════════════
// ── 生命周期 ──
// ═══════════════════════════════════════════

// ── 自动更新状态 ──
const updateAvailable = ref<any>(null)
const updateDownloading = ref(false)
const updateDownloadPercent = ref(0)
const updateDownloaded = ref(false)
const updateError = ref('')
let _cleanupUpdateAvail: (() => void) | null = null
let _cleanupUpdateProg: (() => void) | null = null
let _cleanupUpdateDone: (() => void) | null = null
let _cleanupUpdateErr: (() => void) | null = null

/** 开始下载更新 */
function startUpdateDownload() {
  updateDownloading.value = true
  api?.downloadUpdate?.()
}

/** 重启安装更新 */
function installUpdate() {
  api?.installUpdate?.()
}

onMounted(() => {
  // ── 初始化主题 ──
  applyInitialTheme()

  // ── 监听系统主题变化 ──
  // 当用户选择了 system 模式时，OS 主题切换后自动更新 data-theme
  // 如果用户手动选择了 dark/light，则不响应系统变化（currentTheme !== 'system'）
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'system') applyTheme('system')
  })

  // ── Claude Code 延迟检测 ──
  // 延迟 2 秒等待 gateway 启动完成后再检测，避免 gateway 未就绪导致误报
  setTimeout(checkClaudeStatus, 2000)

  // ── 注册自动更新事件监听 ──
  if (api) {
    _cleanupUpdateAvail = api.onUpdateAvailable?.((info: any) => {
      updateAvailable.value = info
    })
    _cleanupUpdateProg = api.onUpdateDownloadProgress?.((progress: any) => {
      updateDownloadPercent.value = Math.round(progress.percent)
    })
    _cleanupUpdateDone = api.onUpdateDownloaded?.((info: any) => {
      updateDownloading.value = false
      updateDownloaded.value = true
      updateAvailable.value = info
    })
    _cleanupUpdateErr = api.onUpdateError?.((err: any) => {
      updateDownloading.value = false
      updateError.value = err.message || '更新失败'
    })
  }
})

onBeforeUnmount(() => {
  _cleanupUpdateAvail?.()
  _cleanupUpdateProg?.()
  _cleanupUpdateDone?.()
  _cleanupUpdateErr?.()
})

// ═══════════════════════════════════════════
// ── 窗口控制 (electronAPI) ──
// ═══════════════════════════════════════════

/**
 * ── api ──
 * 从 window 对象获取 preload 脚本暴露的 electronAPI
 * 在浏览器环境（非 Electron）中 api 为 undefined，所有调用通过可选链保护
 */
const api = (window as any).electronAPI

// ── 最小化窗口 ──
// 通过 IPC 通知主进程执行 BrowserWindow.minimize()
function minimizeWindow() { api?.minimize?.() }

// ── 最大化/还原窗口 ──
// 通过 IPC 通知主进程切换最大化状态
function maximizeWindow() { api?.maximize?.() }

// ── 关闭窗口 ──
// 通过 IPC 通知主进程执行 BrowserWindow.close()
function closeWindow() { api?.close?.() }
</script>

<template>
  <div class="app-shell">
    <!--
      ── 自定义标题栏 ──
      功能说明: 替代系统原生标题栏，提供统一的窗口控制按钮
      实现方式: v-if="api" 确保仅在 Electron 环境下渲染，
               浏览器开发模式（无 electronAPI）下隐藏，使用浏览器原生窗口控制
    -->
    <header class="title-bar" v-if="api">
      <!-- ── 标题栏拖拽区域 ── -->
      <!-- -webkit-app-region: drag 使此区域可拖拽移动窗口 -->
      <div class="title-bar-drag">
        <span class="title-bar-brand">Claude Desktop Bridge</span>
        <a class="title-bar-github"
           href="https://github.com/kankancuige/claude-desktop-bridge"
           title="GitHub"
           @click.prevent="api?.openExternal?.('https://github.com/kankancuige/claude-desktop-bridge')"
        >github.com/kankancuige/claude-desktop-bridge</a>
      </div>

      <!-- ── 窗口控制按钮 ── -->
      <!-- -webkit-app-region: no-drag 确保按钮区域不可拖拽 -->
      <div class="title-bar-controls">
        <button class="win-btn" @click="minimizeWindow" title="最小化">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button class="win-btn" @click="maximizeWindow" title="最大化">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
        </button>
        <button class="win-btn win-close" @click="closeWindow" title="关闭">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </header>

    <!--
      ── 路由视图容器 ──
      功能说明: 使用 keep-alive 缓存 WorkspaceView 组件实例
      实现方式:
        - keep-alive include: 仅缓存 WorkspaceView（按组件名匹配）
        - :key="route.fullPath": 确保同一路由不同参数时正确更新
        - flex:1 + overflow:hidden: 确保视图填满剩余空间且不溢出
    -->
    <div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
      <router-view v-slot="{ Component, route }">
        <keep-alive :include="['WorkspaceView']">
          <component :is="Component" :key="route.fullPath" />
        </keep-alive>
      </router-view>
    </div>

    <!-- ── 自动更新横幅 ── -->
    <div v-if="updateAvailable && !updateDownloaded" class="update-banner glass">
      <div class="update-banner-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
        </svg>
        <span>{{ t('gen.updateAvailable', {version: updateAvailable.version}) }}</span>
      </div>
      <div class="update-banner-right">
        <button v-if="!updateDownloading" class="update-download-btn" @click="startUpdateDownload">{{ t('gen.updateDownload') }}</button>
        <span v-else class="update-progress">{{ updateDownloadPercent }}%</span>
        <button class="update-close-btn" @click="updateAvailable = null; updateError = ''">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ── 更新错误提示 ── -->
    <div v-if="updateError" class="update-banner glass" style="border-color:var(--error)">
      <div class="update-banner-left" style="color:var(--error)">
        <span>{{ updateError }}</span>
      </div>
      <button class="update-close-btn" @click="updateError = ''">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- ── 更新下载完成，重启安装弹窗 ── -->
    <div v-if="updateDownloaded" class="claude-overlay" @click.self="updateDownloaded = false">
      <div class="claude-modal glass">
        <h2 class="claude-title">{{ t('gen.updateReady') }}</h2>
        <p class="claude-desc">{{ t('gen.updateReadyHint', {version: updateAvailable?.version || ''}) }}</p>
        <div class="qr-actions">
          <button class="btn-text" @click="updateDownloaded = false">{{ t('common.cancel') }}</button>
          <button class="btn-primary" @click="installUpdate">{{ t('gen.updateInstall') }}</button>
        </div>
      </div>
    </div>

    <!--
      功能说明: 当 claude-code CLI 未安装时，显示全屏遮罩 + 居中弹窗，
               引导用户安装或检查配置
      实现方式:
        - v-if="claudeMissing && !claudeChecking": 仅在确认未安装时显示
        - @click.self: 点击遮罩空白处关闭弹窗（临时关闭，下次启动仍会检测）
        - glass class: 毛玻璃视觉效果
    -->
    <div v-if="claudeMissing && !claudeChecking" class="claude-overlay" @click.self="claudeMissing = false">
      <div class="claude-modal glass">
        <!-- 关闭按钮 -->
        <button class="claude-close" @click="claudeMissing = false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <!-- 警告图标 -->
        <div class="claude-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>

        <!-- 标题和说明（通过 i18n 国际化） -->
        <h2 class="claude-title">{{ t('claudeMissing.title') }}</h2>
        <p class="claude-desc">{{ t('claudeMissing.desc') }}</p>

        <!-- 安装/排查步骤 -->
        <ul class="claude-opts">
          <li><code>npm install -g @anthropic-ai/claude-code</code></li>
          <li>{{ t('claudeMissing.opt2') }}</li>
          <li>{{ t('claudeMissing.opt3') }}</li>
        </ul>

        <!-- 重新检测按钮 -->
        <button class="claude-retry-btn" :disabled="claudeChecking" @click="checkClaudeStatus">
          <svg v-if="claudeChecking" class="claude-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
          </svg>
          <span>{{ claudeChecking ? t('claudeMissing.checking') : t('claudeMissing.retry') }}</span>
        </button>

        <!-- ── 手动路径输入区 ── -->
        <div class="claude-divider">— {{ t('claudeMissing.manual') }} —</div>
        <div class="claude-manual">
          <p class="claude-manual-hint">{{ t(getPlatformHint()) }}</p>
          <div class="claude-manual-row">
            <input
              v-model="manualPath"
              class="claude-path-input"
              :placeholder="t('claudeMissing.pathPlaceholder')"
              :disabled="manualPathSaved"
              @keydown.enter="manualPathResult === 'found' ? saveManualPath() : checkManualPath()"
            />
            <button
              v-if="manualPathResult !== 'found'"
              class="claude-check-btn"
              :disabled="manualPathChecking || !manualPath.trim()"
              @click="checkManualPath"
            >
              <svg v-if="manualPathChecking" class="claude-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
              </svg>
              <span>{{ manualPathChecking ? t('claudeMissing.checkingPath') : t('claudeMissing.checkPath') }}</span>
            </button>
            <!-- 路径已找到 → 显示保存按钮 -->
            <button
              v-if="manualPathResult === 'found' && !manualPathSaved"
              class="claude-save-btn"
              @click="saveManualPath"
            >{{ t('claudeMissing.savePath') }}</button>
            <!-- 已保存 -->
            <span v-if="manualPathSaved" class="claude-saved-text">{{ t('claudeMissing.saved') }}</span>
          </div>
          <!-- 反馈文字 -->
          <p v-if="manualPathResult === 'found' && !manualPathSaved" class="claude-feedback ok">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {{ t('claudeMissing.foundOk', { path: manualPath.trim() }) }}
          </p>
          <p v-if="manualPathResult === 'not_found'" class="claude-feedback err">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            {{ t('claudeMissing.notFound') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* ═══════════════════════════════════════════
   ── Title bar ──
   ── 功能说明: 自定义窗口标题栏样式
   ── 实现方式: flex 布局，左侧拖拽区 + 右侧控制按钮
   ═══════════════════════════════════════════ */
.app-shell {
  display: flex; flex-direction: column;
  height: 100vh; overflow: hidden;                /* 占满视口，禁止滚动 */
}

/* ── 标题栏容器 ── */
.title-bar {
  display: flex; align-items: center;
  height: 40px; flex-shrink: 0;                   /* 固定高度 40px，不被 flex 压缩 */
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
}

/* ── 可拖拽区域 ── */
/* -webkit-app-region: drag 使此区域响应窗口拖拽 */
.title-bar-drag {
  flex: 1; height: 100%;
  display: flex; align-items: center; padding-left: 14px;
  -webkit-app-region: drag;
}

/* ── 品牌文字 ── */
.title-bar-brand {
  font-family: var(--font-heading);
  font-size: 14px; font-weight: 600; color: var(--text-secondary);
  letter-spacing: 0.3px;
}

/* ── GitHub 仓库链接 ── */
.title-bar-github {
  font-family: var(--font-mono, 'JetBrains Mono');
  font-size: 17px; color: var(--text-secondary);
  text-decoration: none; margin-left: 16px;
  opacity: 0.55; transition: opacity var(--transition-fast);
  -webkit-app-region: no-drag;
}
.title-bar-github:hover { opacity: 0.7; color: var(--accent-blue); }

/* ── 窗口控制按钮容器 ── */
.title-bar-controls {
  display: flex; height: 100%;
}

/* ── 窗口控制按钮通用样式 ── */
/* -webkit-app-region: no-drag 确保按钮区域不参与窗口拖拽 */
.win-btn {
  width: 50px; height: 100%;
  background: none; border: none; color: var(--text-muted);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);         /* 使用全局过渡变量 */
  -webkit-app-region: no-drag;
}
.win-btn svg { width: 16px; height: 16px; }
.win-btn:hover { background: var(--bg-raised); color: var(--text-primary); }

/* ── 关闭按钮 hover 特殊样式 ── */
/* 使用 error 色作为 hover 背景，与 Windows 原生行为一致 */
.win-close:hover { background: var(--error); color: #fff; }

/* ═══════════════════════════════════════════
   ── Claude 未找到弹窗 ──
   ── 功能说明: 全屏遮罩 + 居中毛玻璃弹窗
   ── 实现方式: position:fixed 全屏覆盖，z-index:300 确保在最顶层
   ═══════════════════════════════════════════ */

/* ── 更新横幅 ── */
.update-banner {
  position: fixed; bottom: 16px; right: 16px; z-index: 250;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex; align-items: center; gap: 12px;
  font-size: 14px;
  max-width: 420px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
}
.update-banner-left {
  display: flex; align-items: center; gap: 8px;
  color: var(--text-secondary); flex: 1;
}
.update-banner-right {
  display: flex; align-items: center; gap: 8px;
}
.update-download-btn {
  background: var(--accent); color: #fff;
  border: none; padding: 6px 14px;
  border-radius: 6px; font-size: 13px;
  font-family: var(--font-body); cursor: pointer;
}
.update-download-btn:hover { background: #d43d54; }
.update-progress {
  font-size: 13px; font-family: var(--font-mono);
  color: var(--accent); font-weight: 500;
}
.update-close-btn {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 4px;
}

/* ── 遮罩层 ── */
/* backdrop-filter: blur(4px) 提供背景模糊的毛玻璃效果 */
.claude-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 300; backdrop-filter: blur(4px);
}

/* ── 弹窗卡片 ── */
.claude-modal {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 36px 40px;
  text-align: center;
  max-width: 480px; width: 90vw;                  /* 最大 480px，小屏幕用 90vw */
  position: relative;
}

/* ── 关闭按钮（右上角 X） ── */
.claude-close {
  position: absolute; top: 12px; right: 12px;
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 6px; border-radius: 8px;
  transition: all 0.15s ease;
}
.claude-close:hover { color: var(--text-primary); background: var(--bg-raised); }

/* ── 警告图标圆圈 ── */
/* 使用半透明 accent 色作为背景，营造警示氛围 */
.claude-icon {
  width: 72px; height: 72px; margin: 0 auto 20px;
  border-radius: 50%;
  background: rgba(233, 69, 96, 0.08);
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}

/* ── 标题 ── */
.claude-title {
  font-family: var(--font-heading);
  font-size: 20px; font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

/* ── 描述文字 ── */
.claude-desc {
  font-size: 14px; color: var(--text-muted);
  line-height: 1.6; margin-bottom: 16px;
}

/* ── 安装步骤列表 ── */
.claude-opts {
  text-align: left; font-size: 14px; color: var(--text-secondary);
  line-height: 2; margin-bottom: 24px; padding-left: 20px;
}

/* ── 内联代码样式 ── */
/* npm 命令使用等宽字体 + accent-blue 突出显示 */
.claude-opts code {
  background: var(--bg-deep); padding: 2px 8px; border-radius: 4px;
  font-family: var(--font-mono); font-size: 13px; color: var(--accent-blue);
}

/* ── 重新检测按钮 ── */
.claude-retry-btn {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--accent); color: #fff;
  border: none; padding: 10px 28px;
  border-radius: 8px; font-size: 15px;
  font-family: var(--font-body); font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.claude-retry-btn:hover:not(:disabled) { background: #d43d54; }
.claude-retry-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── 加载动画 ── */
@keyframes claude-spin { to { transform: rotate(360deg); } }
.claude-spinner { animation: claude-spin 0.8s linear infinite; }

/* ── 分割线 ── */
.claude-divider {
  font-size: 13px; color: var(--text-muted);
  margin: 20px 0 12px;
  user-select: none;
}

/* ── 手动路径输入区 ── */
.claude-manual { text-align: left; }
.claude-manual-hint {
  font-size: 12px; color: var(--text-muted);
  margin-bottom: 8px; font-family: var(--font-mono);
  word-break: break-all;
}

.claude-manual-row {
  display: flex; gap: 8px; align-items: center;
}

.claude-path-input {
  flex: 1;
  background: var(--bg-deep); border: 1px solid var(--border);
  border-radius: 8px; padding: 9px 12px;
  font-size: 13px; font-family: var(--font-mono);
  color: var(--text-primary); outline: none;
  transition: border-color 0.15s ease;
}
.claude-path-input:focus { border-color: var(--accent); }
.claude-path-input:disabled { opacity: 0.5; }

.claude-check-btn, .claude-save-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  border: none; padding: 9px 16px;
  border-radius: 8px; font-size: 13px;
  font-family: var(--font-body); font-weight: 500;
  cursor: pointer; white-space: nowrap;
  transition: all 0.15s ease;
}
.claude-check-btn {
  background: var(--bg-raised); color: var(--text-secondary);
}
.claude-check-btn:hover:not(:disabled) { background: var(--border); color: var(--text-primary); }
.claude-check-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.claude-save-btn {
  background: var(--accent); color: #fff;
}
.claude-save-btn:hover { background: #d43d54; }

.claude-saved-text {
  flex-shrink: 0;
  font-size: 13px; color: var(--success, #3FB950);
  font-weight: 500;
}

/* ── 路径校验反馈 ── */
.claude-feedback {
  display: flex; align-items: center; gap: 6px;
  margin-top: 10px; font-size: 13px;
}
.claude-feedback.ok { color: var(--success, #3FB950); }
.claude-feedback.err { color: var(--error, #E94560); }
</style>
