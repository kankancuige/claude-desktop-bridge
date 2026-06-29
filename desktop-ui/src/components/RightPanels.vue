<script setup lang="ts">
/**
 * RightPanels — 右侧面板区（文件面板 + Workflow Agent 详情面板）
 * 360px 固定宽度，由父组件控制显示/隐藏。
 * 文件树渲染、目录展开/折叠、文件点击预览/diff 均通过 emits 上报父组件。
 */
import { computed } from 'vue'
import { t } from '../i18n'
import type { TreeNode, FlatFile, AgentRun } from './types'

// ═══════════════════════════════════════════
// ── Props ──
// ═══════════════════════════════════════════
const props = defineProps<{
  /** 文件面板是否可见 */
  showFilePanel: boolean
  /** Workflow/Agent 面板是否可见 */
  showWfPanel: boolean
  /** 加载中 */
  fileTreeLoading?: boolean
  /** diff snapshot 缺失 */
  fileMissing?: boolean
  /** 是否有 snapshot */
  hasSnapshot?: boolean
  /** snapshot 时间戳 */
  snapshotAt?: number | null
  /** 文件列表被截断 */
  fileTruncated?: boolean
  /** 过滤器状态：all / changed */
  fileFilter: 'all' | 'changed'
  /** 可见文件行（已展开、已排序、带深度） */
  visibleRows: { node: TreeNode; depth: number }[]
  /** 已展开的目录集合 */
  expandedDirs: Set<string>
  /** 变更文件用于提交按钮启用判断 */
  changedFileCount: number

  /** Agent 运行列表 */
  agentRuns: AgentRun[]
  /** Workflow 运行状态 */
  wfRunState?: any
  /** Agent 图标颜色映射 */
  agentColorFn?: (type: string) => string
  /** Agent SVG 图标映射 */
  agentIconFn?: (type: string) => string
  /** 时长格式化 */
  formatDuration?: (ms: number) => string
  /** 时间格式化 */
  formatTime?: (ts: number) => string
}>()

// ═══════════════════════════════════════════
// ── Emits ──
// ═══════════════════════════════════════════
const emit = defineEmits<{
  (e: 'closeFilePanel'): void
  (e: 'closeWfPanel'): void
  (e: 'toggleDir', path: string): void
  (e: 'openFile', file: FlatFile): void
  (e: 'openDiff', file: FlatFile): void
  (e: 'loadFileTree'): void
  (e: 'openCommitFiles'): void
  (e: 'setFileFilter', filter: 'all' | 'changed'): void
}>()

// ═══════════════════════════════════════════
// ── 工具函数 ──
// ═══════════════════════════════════════════
function statusBadge(status: string) {
  if (status === 'added') return { label: 'A', cls: 'a' }
  if (status === 'modified') return { label: 'M', cls: 'm' }
  if (status === 'deleted') return { label: 'D', cls: 'd' }
  return null
}

function agentColor(type: string) {
  if (props.agentColorFn) return props.agentColorFn(type)
  const map: Record<string, string> = { Explore: '#6b96e0', Plan: '#d4a853', 'general-purpose': '#8b9dc3', 'code-reviewer': '#69c77f', 'claude-code-guide': '#b07cd8', claude: '#e94560' }
  return map[type] || '#8b9dc3'
}

function agentIcon(type: string) {
  if (props.agentIconFn) return props.agentIconFn(type)
  const map: Record<string, string> = {
    Explore: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    Plan: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'general-purpose': '<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    'code-reviewer': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    'claude-code-guide': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    claude: '<circle cx="12" cy="12" r="10"/><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  }
  const d = map[type] || '<circle cx="12" cy="12" r="3"/>'
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
}

function fmtDur(ms: number) {
  if (props.formatDuration) return props.formatDuration(ms)
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtTime(ts: number) {
  if (props.formatTime) return props.formatTime(ts)
  return new Date(ts).toLocaleTimeString()
}
</script>

<template>
  <div class="right-panels">
    <!-- ═══════════ 文件面板 ═══════════ -->
    <aside v-if="showFilePanel" class="file-panel">
      <div class="fp-header">
        <span class="fp-title">{{ t('ws.fpTitle') }}</span>
        <div class="fp-header-actions">
          <button class="fp-icon-btn commit-btn" :title="t('ws.fpCommit')" @click="emit('openCommitFiles')" :disabled="changedFileCount === 0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 11 12 14 22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </button>
          <button class="fp-icon-btn" :title="t('ws.fpRefresh')" @click="emit('loadFileTree')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button class="fp-icon-btn" :title="t('ws.close')" @click="emit('closeFilePanel')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="fp-filter">
        <button class="fp-filter-tab" :class="{ active: fileFilter === 'all' }" @click="emit('setFileFilter', 'all')">{{ t('ws.fpAll') }}</button>
        <button class="fp-filter-tab" :class="{ active: fileFilter === 'changed' }" @click="emit('setFileFilter', 'changed')">{{ t('ws.fpChanged') }}</button>
        <span class="fp-snap-time" v-if="hasSnapshot && snapshotAt">{{ t('ws.fpBaseline', { time: fmtTime(snapshotAt) }) }}</span>
        <span class="fp-snap-time warn" v-else>{{ t('ws.fpNoBaseline') }}</span>
      </div>

      <div class="fp-tree">
        <div v-if="fileTreeLoading" class="fp-hint">{{ t('common.loading') }}</div>
        <div v-else-if="fileMissing" class="fp-hint">{{ t('ws.fpMissing') }}</div>
        <div v-else-if="visibleRows.length === 0" class="fp-hint">
          {{ fileFilter === 'changed' ? t('ws.fpNoChanged') : t('ws.fpNoFiles') }}
        </div>
        <template v-else>
          <div v-for="row in visibleRows" :key="row.node.path" class="file-row"
               :class="{ dir: row.node.isDir }"
               :style="{ paddingLeft: (row.depth * 14 + 8) + 'px' }"
               @click="row.node.isDir ? emit('toggleDir', row.node.path) : emit('openFile', row.node.file!)">
            <!-- 目录 -->
            <template v-if="row.node.isDir">
              <svg class="fp-chevron" :class="{ open: expandedDirs.has(row.node.path) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              <span class="fp-name dir">{{ row.node.name }}</span>
            </template>
            <!-- 文件 -->
            <template v-else>
              <span class="fp-file-dot" :class="row.node.file!.status"></span>
              <span class="fp-name" :class="{ deleted: row.node.file!.status === 'deleted' }">{{ row.node.name }}</span>
              <span v-if="statusBadge(row.node.file!.status)" class="fp-badge" :class="statusBadge(row.node.file!.status)!.cls">{{ statusBadge(row.node.file!.status)!.label }}</span>
              <span v-if="row.node.file!.added != null && row.node.file!.added > 0" class="fp-add">+{{ row.node.file!.added }}</span>
              <span v-if="row.node.file!.removed != null && row.node.file!.removed > 0" class="fp-del">-{{ row.node.file!.removed }}</span>
              <button v-if="!row.node.file!.binary && row.node.file!.status !== 'unchanged' && row.node.file!.status !== 'added'"
                      class="fp-diff-btn" title="diff" @click.stop="emit('openDiff', row.node.file!)">diff</button>
            </template>
          </div>
        </template>
        <div v-if="fileTruncated" class="fp-hint warn">{{ t('ws.fpTruncated') }}</div>
      </div>
    </aside>

    <!-- ═══════════ Workflow / Agent 面板 ═══════════ -->
    <div v-if="showWfPanel" class="wf-detail-panel">
      <!-- 原生 Agent 面板 -->
      <template v-if="!wfRunState">
        <div class="fp-header">
          <span class="fp-title">Agent 活动 ({{ agentRuns.length }})</span>
          <button class="fp-icon-btn" :title="t('ws.close')" @click="emit('closeWfPanel')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="ag-panel-list">
          <div v-if="agentRuns.length === 0" class="ag-panel-empty">暂无 Agent 活动</div>
          <div v-for="ag in agentRuns" :key="ag.id + ag.source" class="ag-panel-card" :class="ag.status">
            <div class="ag-card-head">
              <span class="ag-card-dot" :class="ag.status" :style="ag.status === 'running' ? { background: agentColor(ag.agentType), boxShadow: '0 0 8px ' + agentColor(ag.agentType) } : {}"></span>
              <span class="ag-card-type"><span v-html="agentIcon(ag.agentType)" style="display:inline-flex;align-items:center"></span> {{ ag.agentType }}</span>
              <span class="ag-card-status" :class="ag.status">
                <template v-if="ag.status === 'spawning'">启动中...</template>
                <template v-else-if="ag.status === 'running'">执行中</template>
                <template v-else-if="ag.status === 'done'">已完成</template>
                <template v-else>错误</template>
              </span>
              <span v-if="ag.status === 'done' && ag.doneTime && ag.spawnTime" class="ag-card-time">{{ fmtDur(ag.doneTime - ag.spawnTime) }}</span>
              <span v-else-if="ag.status === 'running' && ag.spawnTime" class="ag-card-time running">{{ fmtDur(Date.now() - ag.spawnTime) }}</span>
            </div>
            <div v-if="ag.description" class="ag-card-desc" :title="ag.description">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:2px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{{ ag.description }}</span>
            </div>
            <div v-if="ag.status === 'running' || ag.status === 'done'" class="ag-card-progress">
              <div class="ag-card-bar"><div class="ag-card-bar-fill" :class="ag.status === 'done' ? 'done' : ''"></div></div>
              <div class="ag-card-tool-info">
                <span v-if="ag.currentTool" class="ag-card-tool-name">{{ ag.currentTool }}</span>
                <span v-if="ag.currentToolElapsed" class="ag-card-tool-time">{{ ag.currentToolElapsed }}s</span>
                <span v-if="ag.status === 'running' && ag.spawnTime" class="ag-card-elapsed">总耗时 {{ fmtDur(Date.now() - ag.spawnTime) }}</span>
              </div>
            </div>
            <div class="ag-card-timeline">
              <div class="ag-card-step"><span class="ag-step-label">创建</span><span class="ag-step-time">{{ fmtTime(ag.spawnTime || 0) }}</span></div>
              <div class="ag-card-step"><span class="ag-step-label">启动</span><span class="ag-step-time">{{ ag.startTime ? fmtTime(ag.startTime) : '—' }}</span></div>
              <div class="ag-card-step"><span class="ag-step-label">{{ ag.status === 'error' ? '错误' : '完成' }}</span><span class="ag-step-time">{{ ag.doneTime ? fmtTime(ag.doneTime) : '—' }}</span></div>
            </div>
            <div v-if="ag.transcriptPath" class="ag-card-record">记录已保存</div>
          </div>
        </div>
      </template>
      <!-- Workflow 面板 -->
      <template v-else>
        <div class="fp-header">
          <span class="fp-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Workflow {{ wfRunState.name }}</span>
          <button class="fp-icon-btn" :title="t('ws.close')" @click="emit('closeWfPanel')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="wf-phases-bar">
          <template v-for="(ph, pi) in wfRunState.phases" :key="ph.title">
            <span class="wf-phase-dot" :class="ph.status" :title="ph.title"></span>
            <span v-if="pi < wfRunState.phases.length - 1" class="wf-phase-line" :class="{ done: ph.status === 'done' || ph.status === 'running' }"></span>
          </template>
          <span style="font-size:11px;color:var(--text-muted);margin-left:6px">{{ wfRunState.currentPhase || wfRunState.phases?.find((p: any) => p.status === 'running')?.title }}</span>
        </div>
        <div class="wf-agents-list">
          <div v-if="wfRunState.agents.length === 0" style="padding:20px;text-align:center;font-size:12px;color:var(--text-muted)">等待引擎分配 Agent...</div>
          <div v-for="ag in wfRunState.agents" :key="ag.id" class="wf-agent-row">
            <span class="wf-ag-row-dot" :class="ag.status"></span>
            <span class="wf-ag-row-label">{{ ag.id }}</span>
            <span class="wf-ag-row-status" :class="ag.status">{{ ag.status === 'running' ? '···' : ag.status === 'done' ? 'OK' : ag.status === 'error' ? 'ERR' : '—' }}</span>
          </div>
        </div>
        <div class="wf-logs">
          <div v-for="(l, li) in wfRunState.logs.slice(-15)" :key="li" class="wf-log-line">
            <span class="wf-log-phase">{{ l.phase }}</span><span class="wf-log-msg">{{ l.msg }}</span>
          </div>
        </div>
        <div v-if="wfRunState.status === 'done'" style="padding:8px 12px;font-size:11px;color:var(--success);border-top:1px solid var(--border)">完成 · {{ wfRunState.tokenSpent.toLocaleString() }} tokens</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.right-panels {
  width: 360px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-base);
  overflow: hidden;
}

.file-panel, .wf-detail-panel {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.fp-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.fp-title {
  font-family: var(--font-heading);
  font-size: 14px; font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.fp-header-actions {
  display: flex; gap: 4px; align-items: center;
}

.fp-icon-btn {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 6px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.fp-icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
.fp-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.fp-icon-btn.commit-btn:hover:not(:disabled) { color: var(--success); }

.fp-filter {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  flex-shrink: 0; flex-wrap: wrap;
}

.fp-filter-tab {
  background: none; border: none; color: var(--text-muted);
  font-size: 12px; font-family: var(--font-body);
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
}
.fp-filter-tab.active { background: var(--accent-blue); color: #fff; }

.fp-snap-time {
  font-size: 11px; color: var(--text-muted);
  margin-left: auto; font-family: var(--font-mono);
}
.fp-snap-time.warn { color: var(--warning); }

.fp-tree {
  flex: 1; overflow-y: auto; padding: 8px 0;
  scrollbar-width: thin;
}

.fp-hint {
  text-align: center; padding: 32px 16px;
  font-size: 13px; color: var(--text-muted);
}
.fp-hint.warn { color: var(--warning); }

.file-row {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 16px; cursor: pointer; font-size: 13px;
  transition: background .1s;
}
.file-row:hover { background: var(--bg-raised); }
.file-row.dir { font-weight: 500; }

.fp-chevron {
  flex-shrink: 0; transition: transform .15s;
  color: var(--text-muted);
}
.fp-chevron.open { transform: rotate(90deg); }

.fp-file-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-muted); flex-shrink: 0;
}
.fp-file-dot.added { background: var(--success); }
.fp-file-dot.modified { background: var(--warning); }
.fp-file-dot.deleted { background: var(--error); }

.fp-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text-primary);
}
.fp-name.dir { color: var(--accent-blue); }
.fp-name.deleted { text-decoration: line-through; color: var(--text-muted); }

.fp-badge {
  font-size: 10px; font-weight: 600; padding: 0 4px;
  border-radius: 3px; flex-shrink: 0;
}
.fp-badge.a { background: rgba(63,185,80,.15); color: var(--success); }
.fp-badge.m { background: rgba(240,173,78,.15); color: var(--warning); }
.fp-badge.d { background: rgba(233,69,96,.15); color: var(--error); }

.fp-add { color: var(--success); font-size: 11px; flex-shrink: 0; }
.fp-del { color: var(--error); font-size: 11px; flex-shrink: 0; }

.fp-diff-btn {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  border: 1px solid var(--border); background: var(--bg-raised);
  color: var(--accent-blue); cursor: pointer; margin-left: auto;
}

/* Agent 面板 */
.ag-panel-list {
  flex: 1; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 10px;
  scrollbar-width: thin;
}
.ag-panel-empty {
  text-align: center; padding: 40px 16px;
  font-size: 13px; color: var(--text-muted);
}
.ag-panel-card {
  background: var(--bg-deep); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px;
}
.ag-card-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.ag-card-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-muted);
}
.ag-card-dot.running { background: var(--accent-blue); }
.ag-card-dot.done { background: var(--success); }
.ag-card-dot.error { background: var(--error); }
.ag-card-type { font-size: 13px; font-weight: 500; color: var(--text-primary); flex: 1; }
.ag-card-status {
  font-size: 11px; padding: 2px 8px; border-radius: 4px;
  color: var(--text-muted);
}
.ag-card-status.running { color: var(--accent-blue); }
.ag-card-status.done { color: var(--success); }
.ag-card-status.error { color: var(--error); }
.ag-card-time { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }
.ag-card-time.running { color: var(--accent-blue); }
.ag-card-desc {
  display: flex; gap: 6px; font-size: 12px; color: var(--text-secondary);
  margin-bottom: 8px; line-height: 1.4;
}
.ag-card-progress {
  margin-bottom: 8px;
}
.ag-card-bar {
  height: 3px; background: var(--border); border-radius: 2px;
  overflow: hidden; margin-bottom: 4px;
}
.ag-card-bar-fill {
  height: 100%; width: 60%;
  background: var(--accent-blue);
  animation: agBarPulse 1.5s ease-in-out infinite;
}
.ag-card-bar-fill.done { width: 100%; animation: none; }
@keyframes agBarPulse {
  0%,100% { opacity: .6; } 50% { opacity: 1; }
}
.ag-card-tool-info {
  display: flex; gap: 8px; font-size: 11px;
  font-family: var(--font-mono); color: var(--text-muted);
}
.ag-card-elapsed { margin-left: auto; }
.ag-card-timeline {
  display: flex; gap: 12px; font-size: 10px;
  color: var(--text-muted);
}
.ag-card-step { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ag-card-record {
  font-size: 10px; color: var(--text-muted);
  text-align: right; margin-top: 6px;
}

/* Workflow 面板 */
.wf-phases-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wf-phase-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--border);
}
.wf-phase-dot.done { background: var(--success); }
.wf-phase-dot.running { background: var(--accent-blue); box-shadow: 0 0 6px var(--accent-blue); }
.wf-phase-line { flex: 1; height: 1px; background: var(--border); }
.wf-phase-line.done { background: var(--success); }

.wf-agents-list {
  flex: 1; overflow-y: auto; padding: 8px 12px;
  display: flex; flex-direction: column; gap: 4px;
  scrollbar-width: thin;
}
.wf-agent-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 4px 0;
}
.wf-ag-row-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--border); flex-shrink: 0;
}
.wf-ag-row-dot.done { background: var(--success); }
.wf-ag-row-dot.running { background: var(--accent-blue); }
.wf-ag-row-dot.error { background: var(--error); }
.wf-ag-row-label { flex: 1; font-family: var(--font-mono); color: var(--text-primary); }
.wf-ag-row-status { font-size: 10px; color: var(--text-muted); }

.wf-logs {
  max-height: 120px; overflow-y: auto;
  border-top: 1px solid var(--border); padding: 6px 12px;
  font-size: 11px; font-family: var(--font-mono);
  scrollbar-width: thin;
}
.wf-log-line {
  padding: 2px 0;
  display: flex; gap: 8px;
}
.wf-log-phase { color: var(--accent-blue); flex-shrink: 0; }
.wf-log-msg { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
