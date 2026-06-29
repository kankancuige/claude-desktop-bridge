<script setup lang="ts">
/**
 * SidebarLeft — 左侧 380px 边栏
 * 包含：品牌标识、设置入口、项目搜索、新增项目、项目列表（含会话子列表）、底部连接状态。
 * 所有业务状态由父组件 props 输入，操作为 emits 输出。
 */
import { t } from '../i18n'
import type { Project } from './types'

// ═══════════════════════════════════════════
// ── Props ──
// ═══════════════════════════════════════════
defineProps<{
  /** 搜索关键词 */
  searchText: string
  /** 过滤后的项目列表 */
  filteredProjects: Project[]
  /** 可见项目列表（分页） */
  visibleProjects: Project[]
  /** 已展开的项目集合 */
  expandedProjects: Set<string>
  /** 已展开全部的项目集合 */
  showAllSessions: Set<string>
  /** 是否显示全部项目 */
  showAllProjects: boolean
  /** 当前活跃项目 workDir */
  activeProject: string
  /** 当前活跃会话 ID */
  activeSessionId: string
  /** WebSocket 是否已连接 */
  connected: boolean
  /** 是否正在连接中 */
  connecting: boolean
  /** Gateway 版本号 */
  gatewayVersion: string
  /** 是否有 agent 运行中 */
  hasRunningAgent: boolean
  /** Agent 运行数量 */
  runningAgentCount: number
  /** 项目分页大小 */
  projectPageSize: number
  /** 会话分页大小 */
  sessionPageSize: number
}>()

// ═══════════════════════════════════════════
// ── Emits ──
// ═══════════════════════════════════════════
const emit = defineEmits<{
  (e: 'goSettings'): void
  (e: 'search', v: string): void
  (e: 'addProject'): void
  (e: 'loadProjects', reorder: boolean): void
  (e: 'toggleProject', workDir: string): void
  (e: 'newSession', workDir: string, encodedDir: string, sid?: string): void
  (e: 'deleteSession', sid: string): void
  (e: 'toggleShowAll', workDir: string): void
  (e: 'toggleShowAllProjects'): void
}>()

// ═══════════════════════════════════════════
// ── 工具函数 ──
// ═══════════════════════════════════════════
/** 路径 → 目录名 */
function dirName(p: string): string {
  const parts = p.replace(/[/\\]$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** 时间戳 → 相对时间描述 */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** 项目 → 可见会话列表 */
function visibleSessions(p: Project, showAllSessions: Set<string>, pageSize: number) {
  if (showAllSessions.has(p.workDir) || p.sessions.length <= pageSize) return p.sessions
  return p.sessions.slice(0, pageSize)
}
</script>

<template>
  <!--
    侧栏 (Sidebar)：左侧 380px 固定宽度
    - 顶部：品牌 Logo + 设置按钮
    - 中部：搜索框 + 新增项目按钮 + 项目列表（含会话子列表）
    - 底部：Gateway 连接状态指示器
  -->
  <aside class="sidebar">
    <!-- 顶部：品牌标识 + 设置入口 -->
    <div class="sidebar-top">
      <div class="app-brand">
        <span class="brand-mark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
            <polygon points="12,2 22,12 12,22 2,12"/>
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3"/>
          </svg>
        </span>
        <div>
          <div class="brand-name">Claude Bridge</div>
          <div class="brand-sub">AI Workspace</div>
        </div>
      </div>
      <button class="icon-btn" :title="t('ws.settings')" @click="emit('goSettings')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      </button>
    </div>

    <!-- 搜索框 + 新增项目按钮 -->
    <div class="search-box">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input :value="searchText" :placeholder="t('ws.searchPlaceholder')" class="search-input"
             @input="emit('search', ($event.target as HTMLInputElement).value)"/>
      <button class="add-project-btn" :title="t('ws.addProject')" @click="emit('addProject')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>

    <!-- 项目列表区域 -->
    <div class="project-list">
      <div class="list-header">
        <span>{{ t('ws.projects') }}</span>
        <button class="icon-btn-sm" :title="t('ws.refreshReorder')" @click="emit('loadProjects', true)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <!-- 搜索无匹配 -->
      <div v-if="filteredProjects.length === 0 && searchText" class="empty-hint">{{ t('ws.noMatch') }}</div>

      <!-- 项目卡片 + 会话子列表 -->
      <div v-for="p in visibleProjects" :key="p.workDir" class="project-group">
        <div class="project-card"
             :class="{ active: activeProject === p.workDir }"
             @click="emit('toggleProject', p.workDir)">
          <div class="project-icon">
            <span v-if="connecting && activeProject === p.workDir" class="spinner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/>
              </svg>
            </span>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="project-info">
            <div class="project-name">{{ dirName(p.workDir) }}</div>
            <div class="project-path">{{ p.workDir }}</div>
            <div class="project-meta">
              <span>{{ t('ws.sessionsCount', { n: p.sessionCount }) }}</span>
              <span class="dot">·</span>
              <span>{{ timeAgo(p.lastActive) }}</span>
            </div>
          </div>
          <div v-if="activeProject === p.workDir && connected" class="active-dot" :title="t('ws.activeConn')"></div>
          <button class="add-session-btn" @click.stop="emit('newSession', p.workDir, p.encodedDir)" :title="t('ws.newSession')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        <!-- 会话子列表 -->
        <div v-if="expandedProjects.has(p.workDir)" class="session-sublist">
          <div v-for="s in visibleSessions(p, showAllSessions, sessionPageSize)" :key="s.id"
               class="session-item"
               :class="{ selected: $props.activeSessionId === s.id }"
               @click.stop="emit('newSession', p.workDir, p.encodedDir, s.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div class="session-info">
              <div class="session-title">{{ s.title || s.id.slice(0, 8) }}</div>
              <div class="session-id-text">{{ s.id.slice(0, 12) }}</div>
            </div>
            <button class="session-del" @click.stop="emit('deleteSession', s.id)" :title="t('common.delete')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
          <button v-if="p.sessions.length > sessionPageSize" class="show-more-btn" @click.stop="emit('toggleShowAll', p.workDir)">
            {{ showAllSessions.has(p.workDir) ? t('ws.collapse') : t('ws.showAllSessions', { n: p.sessions.length }) }}
          </button>
        </div>
      </div>

      <!-- 项目过多展开/收起 -->
      <button v-if="filteredProjects.length > projectPageSize" class="show-more-btn" @click="emit('toggleShowAllProjects')">
        {{ showAllProjects ? t('ws.collapse') : t('ws.showAllProjects', { n: filteredProjects.length }) }}
      </button>

      <!-- 空状态 -->
      <div v-if="filteredProjects.length === 0 && !searchText" class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <p>{{ t('ws.notFound') }}</p>
        <span>{{ t('ws.ensureGateway') }}</span>
      </div>
    </div>

    <!-- 侧栏底部：Agent 状态 + Gateway 连接状态 -->
    <div class="sidebar-bottom">
      <div v-if="hasRunningAgent" class="subagent-panel-mini">
        <span class="subagent-panel-mini-dot"></span>
        <span>{{ runningAgentCount }} agent running</span>
      </div>
      <div class="gateway-status">
        <span class="gw-left">
          <span class="dot-indicator online"></span>
          <span>Gateway 127.0.0.1:3456</span>
        </span>
        <span v-if="gatewayVersion" class="gw-ver">v{{ gatewayVersion }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ═══════════ 侧栏 Sidebar ═══════════ */
.sidebar {
  width: 380px; background: var(--bg-base);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
}

.sidebar-top {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 18px 14px;
}

.app-brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--bg-raised); color: var(--accent);
}
.brand-name { font-family: var(--font-heading); font-size: 16px; font-weight: 600; color: var(--text-primary); }
.brand-sub { font-size: 11px; color: var(--text-muted); }

.icon-btn, .icon-btn-sm {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 8px; border-radius: 8px;
  display: flex; align-items: center; transition: all .15s;
}
.icon-btn:hover, .icon-btn-sm:hover { color: var(--text-primary); background: var(--bg-raised); }

.search-box {
  display: flex; align-items: center; gap: 8px;
  padding: 0 18px 14px;
}
.search-icon { color: var(--text-muted); flex-shrink: 0; }
.search-input {
  flex: 1; background: var(--bg-deep); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 12px; font-size: 13px;
  font-family: var(--font-body); color: var(--text-primary); outline: none;
}
.search-input:focus { border-color: var(--accent-blue); }

.add-project-btn {
  background: var(--accent); color: #fff; border: none;
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.add-project-btn:hover { background: #d43d54; }

.project-list {
  flex: 1; overflow-y: auto; padding: 0 10px 0 12px;
  scrollbar-width: thin;
}

.list-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 8px 8px; font-size: 12px; font-weight: 500;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px;
}

.empty-hint { text-align: center; padding: 16px; font-size: 13px; color: var(--text-muted); }
.empty-state { text-align: center; padding: 40px 16px; color: var(--text-muted); }
.empty-state p { margin: 8px 0 4px; font-size: 14px; }
.empty-state span { font-size: 12px; }

.project-group { margin-bottom: 2px; }

.project-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 10px; border-radius: 10px; cursor: pointer;
  transition: background .12s; position: relative;
}
.project-card:hover { background: var(--bg-raised); }
.project-card.active { background: var(--bg-raised); }

.project-icon { flex-shrink: 0; color: var(--text-muted); }
.project-info { flex: 1; min-width: 0; }
.project-name { font-size: 17px; font-weight: 500; color: var(--text-primary); }
.project-path { font-size: 14px; font-family: var(--font-mono); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-meta { font-size: 13px; color: var(--text-muted); }
.dot { margin: 0 4px; }

.active-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--success); flex-shrink: 0;
}

.add-session-btn {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 4px; border-radius: 6px;
  display: flex; align-items: center; opacity: 0;
  transition: all .12s;
}
.project-card:hover .add-session-btn { opacity: 1; }
.add-session-btn:hover { color: var(--accent-blue); background: var(--bg-deep); }

.session-sublist {
  padding-left: 28px; padding-right: 4px; padding-bottom: 4px;
  display: flex; flex-direction: column; gap: 2px;
}

.session-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 8px; cursor: pointer;
  font-size: 13px; color: var(--text-secondary);
  transition: background .1s;
}
.session-item:hover { background: var(--bg-raised); }
.session-item.selected { background: rgba(129,140,248,.08); color: var(--text-primary); }

.session-info { flex: 1; min-width: 0; }
.session-title { font-size: 13px; color: var(--text-primary); }
.session-id-text { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }

.session-del {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 2px; border-radius: 4px; opacity: 0;
  transition: all .12s;
}
.session-item:hover .session-del { opacity: 1; }
.session-del:hover { color: var(--error); }

.show-more-btn {
  width: 100%; background: none; border: none;
  color: var(--accent-blue); font-size: 12px;
  padding: 6px; cursor: pointer; text-align: center;
}
.show-more-btn:hover { text-decoration: underline; }

.sidebar-bottom {
  padding: 10px 16px; border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.subagent-panel-mini {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--accent-blue); margin-bottom: 6px;
}
.subagent-panel-mini-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent-blue); animation: miniPulse 1s infinite;
}
@keyframes miniPulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

.gateway-status {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: var(--text-muted);
}
.gw-left { display: flex; align-items: center; gap: 6px; }
.dot-indicator {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.dot-indicator.online { background: var(--success); }
.gw-ver { font-family: var(--font-mono); font-size: 15px; color: var(--text-muted); }

.spinner {
  display: flex; align-items: center; animation: sidebarSpin .8s linear infinite;
}
@keyframes sidebarSpin { to { transform: rotate(360deg); } }
</style>
