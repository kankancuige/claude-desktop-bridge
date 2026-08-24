<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {t} from '../i18n'
import {apiFetch} from '../api'
import {
  activityItems,
  loadWorkbenchData,
  loadWorkbenchTaskDetail,
  sortTasks,
  summarizeWorkbench,
  taskAgents,
  taskEventLabel,
  taskEventSummary,
  taskDisplayName,
  taskIsBlocked,
  taskSteps,
  taskTimeline,
  taskWorkflows,
  workbenchAgents,
  workbenchSessions,
  type WorkbenchData,
  type WorkbenchAgent,
  type WorkbenchTask,
  type WorkbenchTaskDetail,
  type WorkbenchQuestion,
} from './workbench-view-model'

const router = useRouter()
const projectFilter = ref('')
const activeOnly = ref(false)
const viewMode = ref<'tasks' | 'agents' | 'sessions'>('tasks')
const loading = ref(false)
const error = ref('')
const selectedTaskKey = ref('')
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const taskDetail = ref<WorkbenchTaskDetail | null>(null)
const data = ref<WorkbenchData>({projectKeys: [], tasks: [], reports: [], pitfalls: [], health: null, driftCandidates: [], stateStoreDegraded: false})
let refreshTimer: ReturnType<typeof setInterval> | null = null
let requestSequence = 0

const tasks = computed(() => sortTasks(data.value.tasks))
const summary = computed(() => summarizeWorkbench(tasks.value))
const projectOptions = computed(() => data.value.projectKeys)
const selectedTask = computed(() => tasks.value.find(task => taskKey(task) === selectedTaskKey.value) || tasks.value[0] || null)
const detailTask = computed(() => taskDetail.value?.task || selectedTask.value)
const taskEvents = computed(() => [...(taskDetail.value?.events || [])].sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0) || Number(left.revision || 0) - Number(right.revision || 0)))
const questions = computed(() => taskDetail.value?.questions || [])
const selectedReport = computed(() => {
  const id = selectedTask.value?.taskId || selectedTask.value?.taskKey
  return data.value.reports.find(report => report.taskId === id || report.taskKey === id || report.taskId === selectedTask.value?.taskKey || report.taskKey === selectedTask.value?.taskId) || null
})
const currentActivities = computed(() => activityItems(tasks.value))
const agentItems = computed(() => workbenchAgents(tasks.value))
const sessionItems = computed(() => workbenchSessions(tasks.value))
const columns = computed(() => [
  {key: 'active', title: '进行中', tone: 'blue', items: tasks.value.filter(task => ['running', 'reviewing', 'changes_required', 'fixing', 'accepted', 'dispatching'].includes(statusOf(task)))},
  {key: 'attention', title: '需要关注', tone: 'warning', items: tasks.value.filter(task => taskIsBlocked(task) || ['failed', 'error', 'regression_detected'].includes(statusOf(task)))},
  {key: 'completed', title: '已完成', tone: 'success', items: tasks.value.filter(task => ['succeeded', 'completed', 'done', 'success'].includes(statusOf(task)))},
])

function taskKey(task: WorkbenchTask): string {
  return String(task.taskKey || task.taskId || task.sessionId || '')
}

function statusOf(task: WorkbenchTask): string {
  return String(task.status || task.state?.coordinator?.phase || 'unknown').toLowerCase()
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    running: '运行中', reviewing: '审查中', changes_required: '待修改', fixing: '修复中', accepted: '已接收', dispatching: '派发中',
    blocked: '已阻塞', review_paused: '审查暂停', incomplete: '未闭合', interrupted: '已中断', failed: '失败', error: '错误',
    succeeded: '成功', completed: '完成', done: '完成', success: '成功', unknown: '未知',
  }
  return labels[status] || status
}

function formatTime(value: unknown): string {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toLocaleString('zh-CN', {hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit'}) : '未记录'
}

function reportStatusLabel(value: unknown): string {
  const labels: Record<string, string> = {succeeded: '已成功', completed: '已完成', failed: '失败', blocked: '已阻塞', incomplete: '未闭合', inconclusive: '验证不足', regression_detected: '发现回归'}
  const status = String(value || '').toLowerCase()
  return labels[status] || status || '未记录'
}

function reportStepLabel(step: any): string {
  return [String(step?.phase || '未命名阶段'), String(step?.role || '未指定角色'), reportStatusLabel(step?.status)].join(' · ')
}

function reportTestLabel(test: any): string {
  return [String(test?.name || test?.command || '未命名测试'), test?.executed === true ? '已执行' : '未执行', test?.status ? reportStatusLabel(test.status) : ''].filter(Boolean).join(' · ')
}

function openQuestion(question: WorkbenchQuestion) {
  const link = question.sessionLink
  const task = detailTask.value
  if (!link?.available || !link.sessionId || !link.encodedDir || !task) return
  openSession({...task, taskId: question.taskId || task.taskId, projectKey: link.encodedDir, sessionId: link.sessionId, sdkSessionId: link.sdkSessionId || task.sdkSessionId, historySessionId: link.historySessionId || task.historySessionId, turnId: question.turnId || link.turnId || task.turnId})
}

function healthLabel(): string {
  if (!data.value.health) return '未读取'
  return data.value.health.healthy ? '正常' : '需要检查'
}

async function refresh() {
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  try {
    const next = await loadWorkbenchData({fetcher: apiFetch, projectKey: projectFilter.value, activeOnly: activeOnly.value})
    if (sequence !== requestSequence) return
    data.value = next
    if (selectedTaskKey.value && !next.tasks.some(task => taskKey(task) === selectedTaskKey.value)) selectedTaskKey.value = ''
  } catch (cause: any) {
    if (sequence === requestSequence) error.value = cause?.message || '加载协作工作台失败'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

function selectTask(task: WorkbenchTask) {
  selectedTaskKey.value = taskKey(task)
  detailOpen.value = true
  void loadTaskDetail(task)
}

async function loadTaskDetail(task: WorkbenchTask) {
  const projectKey = String(task.projectKey || '').trim()
  const id = String(task.taskId || task.taskKey || '').trim()
  if (!projectKey || !id) return
  detailLoading.value = true
  detailError.value = ''
  try {
    taskDetail.value = await loadWorkbenchTaskDetail({fetcher: apiFetch, projectKey, taskId: id})
  } catch (cause: any) {
    detailError.value = cause?.message || '任务详情暂不可用'
    taskDetail.value = null
  } finally {
    detailLoading.value = false
  }
}

function selectAgent(agent: WorkbenchAgent) {
  const task = tasks.value.find(item => taskKey(item) === agent.taskKey)
  if (task) selectTask(task)
}

function selectSession(sessionId: string, projectKey: string) {
  const task = tasks.value.find(item => String(item.sessionId || '') === sessionId && String(item.projectKey || '') === projectKey)
  if (task) selectTask(task)
}

function openSession(task: WorkbenchTask) {
  if (!task.sessionId || !task.projectKey) return
  void router.push({path: '/', query: {encodedDir: task.projectKey, sessionId: task.sessionId, taskId: task.taskId || task.taskKey, turnId: task.turnId || undefined}})
}

function clearFilter() {
  projectFilter.value = ''
}

watch([projectFilter, activeOnly], () => { void refresh() })

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(() => { void refresh() }, 5000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
})
</script>

<template>
  <main class="workbench-page">
    <header class="workbench-header">
      <div>
        <div class="eyebrow">LOCAL COLLABORATION</div>
        <h1>{{ t('ws.workbench') }}</h1>
        <p>把本地项目、任务协调、Agent 运行和验证证据放在同一个可扫描的工作台里。</p>
      </div>
      <div class="header-actions">
        <button class="back-button" type="button" @click="router.push('/')" title="返回会话工作区">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/><path d="M9 12h12"/></svg>
          会话
        </button>
        <button class="refresh-button" type="button" :disabled="loading" @click="refresh" title="刷新工作台数据">
          <svg class="refresh-icon" :class="{spinning: loading}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11"/><path d="M3 4v7h7"/><path d="M4 13a8.1 8.1 0 0 0 14.8 3L21 13"/><path d="M21 20v-7h-7"/></svg>
          刷新
        </button>
      </div>
    </header>

    <section class="workbench-toolbar" aria-label="工作台筛选">
      <div class="view-switch" role="tablist" aria-label="工作台视图">
        <button type="button" :class="{active: viewMode === 'tasks'}" role="tab" :aria-selected="viewMode === 'tasks'" @click="viewMode = 'tasks'">任务</button>
        <button type="button" :class="{active: viewMode === 'agents'}" role="tab" :aria-selected="viewMode === 'agents'" @click="viewMode = 'agents'">Agent</button>
        <button type="button" :class="{active: viewMode === 'sessions'}" role="tab" :aria-selected="viewMode === 'sessions'" @click="viewMode = 'sessions'">会话</button>
      </div>
      <label class="filter-field">
        <span>项目</span>
        <select v-model="projectFilter">
          <option value="">全部本地项目</option>
          <option v-for="project in projectOptions" :key="project" :value="project">{{ project }}</option>
        </select>
      </label>
      <label class="toggle-field">
        <input v-model="activeOnly" type="checkbox" />
        <span>只看活动任务</span>
      </label>
      <button v-if="projectFilter || activeOnly" class="clear-filter" type="button" @click="clearFilter(); activeOnly = false">清除筛选</button>
      <span class="toolbar-status" :class="{degraded: data.stateStoreDegraded}">{{ data.stateStoreDegraded ? 'PostgreSQL 投影降级：当前数据可能不完整' : 'PostgreSQL 本地只读观测' }}</span>
    </section>

    <div v-if="error" class="state-banner error-banner" role="alert">
      <span>{{ error }}</span>
      <button type="button" @click="refresh">重试</button>
    </div>
    <div v-else-if="loading && tasks.length === 0" class="state-banner loading-banner">正在读取本地任务投影...</div>

    <section class="summary-grid" aria-label="运行概览">
      <div class="summary-item"><span class="summary-label">任务总数</span><strong>{{ summary.total }}</strong><span class="summary-note">当前筛选范围</span></div>
      <div class="summary-item tone-blue"><span class="summary-label">活动任务</span><strong>{{ summary.active }}</strong><span class="summary-note">{{ summary.agentsRunning }} 个 Agent 运行中</span></div>
      <div class="summary-item tone-warning"><span class="summary-label">需要关注</span><strong>{{ summary.blocked + summary.failed }}</strong><span class="summary-note">阻塞 {{ summary.blocked }} · 失败 {{ summary.failed }}</span></div>
      <div class="summary-item tone-success"><span class="summary-label">已验证</span><strong>{{ summary.verified }}</strong><span class="summary-note">完成 {{ summary.completed }} · 健康 {{ healthLabel() }}</span></div>
    </section>

    <section v-if="viewMode === 'tasks'" class="board-section">
      <div class="section-heading"><div><h2>任务看板</h2><span>状态来自 Coordinator / PostgreSQL task projection，不在 UI 侧推断终态。</span></div><span class="last-updated">最后更新 {{ formatTime(summary.lastUpdated) }}</span></div>
      <div v-if="tasks.length === 0 && !loading" class="empty-panel"><strong>还没有可展示的本地任务</strong><span>开始一个会话或完成一次任务后，这里会出现任务卡片。</span></div>
      <div v-else class="task-board">
        <section v-for="column in columns" :key="column.key" class="task-column" :class="`column-${column.tone}`">
          <div class="column-heading"><span>{{ column.title }}</span><b>{{ column.items.length }}</b></div>
          <div v-if="column.items.length === 0" class="column-empty">暂无任务</div>
          <button v-for="task in column.items" :key="taskKey(task)" type="button" class="task-card" :class="{selected: selectedTask && taskKey(selectedTask) === taskKey(task)}" @click="selectTask(task)">
            <div class="task-card-top"><span class="status-dot"></span><span class="task-status">{{ statusLabel(statusOf(task)) }}</span><time>{{ formatTime(task.updatedAt) }}</time></div>
            <strong>{{ taskDisplayName(task) }}</strong>
            <p class="task-card-summary">{{ task.summary || task.goal || '暂无任务摘要' }}</p>
            <div class="task-card-meta"><span>{{ task.projectKey || '本地项目' }}</span><span>{{ task.phase || statusLabel(statusOf(task)) }}</span><span>Agent {{ Object.keys(task.state?.coordinator?.agents || {}).length }}</span></div>
          </button>
        </section>
      </div>
    </section>

    <section v-else-if="viewMode === 'agents'" class="board-section">
      <div class="section-heading"><div><h2>Agent 运行</h2><span>显示每个 Agent 的实际身份、负责内容和结构化结果摘要。</span></div><span class="last-updated">{{ agentItems.length }} 个 Agent</span></div>
      <div v-if="agentItems.length === 0" class="empty-panel"><strong>暂无 Agent 投影</strong><span>任务进入执行阶段后，这里会显示 Agent 运行信息。</span></div>
      <div v-else class="agent-grid">
        <button v-for="agent in agentItems" :key="agent.id" type="button" class="agent-card" @click="selectAgent(agent)">
          <div class="agent-card-top"><span class="status-dot" :class="`agent-status-${agent.status}`"></span><strong>{{ agent.name }}</strong><span class="agent-state">{{ statusLabel(agent.status) }}</span></div>
          <div class="agent-role">{{ agent.agentType }} · {{ agent.role }}</div>
          <p><b>负责：</b>{{ agent.purpose }}</p>
          <p v-if="agent.goal"><b>目标：</b>{{ agent.goal }}</p>
          <p v-if="agent.resultSummary" class="agent-result"><b>结果：</b>{{ agent.resultSummary }}</p>
          <div class="agent-meta"><span>{{ agent.taskName }}</span><span>{{ agent.projectKey }}</span><span>文件 {{ agent.changedFileCount }} · 测试 {{ agent.testCount }}</span></div>
        </button>
      </div>
    </section>

    <section v-else class="board-section">
      <div class="section-heading"><div><h2>会话跟踪</h2><span>按项目和会话聚合任务，点击后打开最新关联任务详情。</span></div><span class="last-updated">{{ sessionItems.length }} 个会话</span></div>
      <div v-if="sessionItems.length === 0" class="empty-panel"><strong>暂无可跟踪会话</strong><span>建立会话并接受任务后，这里会显示会话状态。</span></div>
      <div v-else class="session-list">
        <button v-for="session in sessionItems" :key="session.id" type="button" class="session-row" @click="selectSession(session.sessionId, session.projectKey)">
          <span class="status-dot"></span><span class="session-copy"><strong>{{ session.latestTaskName }}</strong><small>{{ session.sessionId }}</small></span><span>{{ session.projectKey }}</span><span>{{ session.taskCount }} 个任务</span><span class="agent-state">{{ statusLabel(session.status) }}</span><time>{{ formatTime(session.updatedAt) }}</time>
        </button>
      </div>
    </section>

    <section v-if="viewMode === 'tasks' || detailOpen" class="detail-layout" :class="{ 'detail-drawer': detailOpen }">
      <article class="detail-section task-detail">
        <div class="section-heading"><div><h2>任务详情</h2><span>{{ selectedTask ? taskDisplayName(selectedTask) : '选择任务查看 Coordinator 状态' }}</span></div><div class="detail-actions"><button v-if="selectedTask?.sessionId" class="text-button" type="button" @click="openSession(selectedTask)">打开会话</button><button v-if="detailOpen" class="close-detail" type="button" title="关闭任务详情" @click="detailOpen = false">×</button></div></div>
        <div v-if="!selectedTask" class="empty-panel compact"><span>从上方任务看板选择一项任务。</span></div>
        <template v-else>
          <div v-if="detailLoading" class="state-banner loading-banner">正在读取任务详情...</div>
          <div v-if="detailError" class="state-banner error-banner">{{ detailError }}</div>
          <div class="detail-summary"><span class="detail-status" :class="`status-${statusOf(detailTask)}`">{{ statusLabel(statusOf(detailTask)) }}</span><span>项目 {{ detailTask.projectKey || '本地项目' }}</span><span>更新于 {{ formatTime(detailTask.updatedAt) }}</span></div>
          <div class="detail-block overview-block"><h3>任务概述</h3><p>{{ detailTask.summary || detailTask.goal || '未记录任务概述' }}</p><div class="overview-meta"><span>来源 {{ detailTask.source || 'desktop' }}</span><span>回合 {{ detailTask.turnId || '未记录' }}</span><span>问题 {{ questions.length }}</span></div></div>
          <div class="detail-block request-block"><h3>原始请求</h3><p>{{ detailTask.requestText || detailTask.goal || detailTask.summary || '未记录原始请求' }}</p></div>
          <div class="detail-block questions-block"><h3>问题与关联对话</h3><div v-if="questions.length === 0" class="muted">暂无可关联的问题记录</div><div v-for="question in questions" :key="question.questionId" class="question-row"><div class="question-copy"><strong>{{ question.eventType === 'task/input-appended' ? '补充问题' : '初始问题' }}</strong><p>{{ question.text || question.summary || '未记录问题内容' }}</p><small>{{ question.turnId || '未记录回合' }} · {{ formatTime(question.createdAt) }}</small></div><button class="text-button" type="button" :disabled="!question.sessionLink?.available" @click="openQuestion(question)">{{ question.sessionLink?.available ? '打开对应对话' : '对话不可用' }}</button></div></div>
          <div class="detail-grid">
            <div class="detail-block"><h3>执行预算</h3><div class="evidence-line"><span>模式</span><b>{{ detailTask.execution?.mode || 'session' }}</b></div><div class="evidence-line"><span>当前步骤</span><b>{{ detailTask.execution?.currentStepId || '未记录' }}</b></div><div class="evidence-line"><span>续跑次数</span><b>{{ detailTask.execution?.continuationCount || 0 }}</b></div><div class="evidence-line"><span>轮次剩余</span><b>{{ detailTask.execution?.budget?.remaining?.rounds ?? '未知' }}</b></div><div class="evidence-line"><span>Token 剩余</span><b>{{ detailTask.execution?.budget?.remaining?.tokens ?? '未知' }}</b></div></div>
            <div class="detail-block"><h3>执行预算</h3><div class="evidence-line"><span>模式</span><b>{{ detailTask.execution?.mode || 'session' }}</b></div><div class="evidence-line"><span>当前步骤</span><b>{{ detailTask.execution?.currentStepId || '未记录' }}</b></div><div class="evidence-line"><span>续跑次数</span><b>{{ detailTask.execution?.continuationCount || 0 }}</b></div><div class="evidence-line"><span>轮次剩余</span><b>{{ detailTask.execution?.budget?.remaining?.rounds ?? '未知' }}</b></div><div class="evidence-line"><span>Token 剩余</span><b>{{ detailTask.execution?.budget?.remaining?.tokens ?? '未知' }}</b></div></div>
            <div class="detail-block"><h3>上下文计划</h3><div class="evidence-line"><span>档位</span><b>{{ detailTask.context?.profile || '未记录' }}</b></div><div class="evidence-line"><span>估算输入 Token</span><b>{{ detailTask.context?.estimatedInputTokens ?? '未知' }}/{{ detailTask.context?.maxInputTokens ?? '未知' }}</b></div><div class="evidence-line"><span>加载层</span><b>{{ detailTask.context?.selectedLayers?.join('、') || '无' }}</b></div><div v-if="detailTask.context?.omitted?.length" class="report-list"><strong>裁剪原因</strong><span v-for="item in detailTask.context.omitted" :key="`${item.layer}-${item.reason}`">{{ item.layer }}：{{ item.reason }}</span></div></div>
            <div class="detail-block"><h3>Coordinator 步骤</h3><div v-if="taskSteps(selectedTask).length === 0" class="muted">暂无步骤投影</div><div v-for="step in taskSteps(selectedTask)" :key="step.id" class="detail-row"><span>{{ step.phase }} · {{ step.role }}</span><b>{{ step.status }}</b></div></div>
            <div class="detail-block"><h3>Agent / Workflow</h3><div v-if="taskAgents(selectedTask).length === 0 && taskWorkflows(selectedTask).length === 0" class="muted">暂无协作运行</div><div v-for="agent in taskAgents(selectedTask)" :key="agent.id" class="agent-detail-row"><div><strong>{{ agent.name }}</strong><span>{{ agent.agentType }} · {{ agent.role }}</span><small>负责：{{ agent.purpose }}</small><small v-if="agent.goal">目标：{{ agent.goal }}</small><small v-if="agent.resultSummary">结果：{{ agent.resultSummary }}</small></div><b>{{ statusLabel(agent.status) }}</b></div><div v-for="workflow in taskWorkflows(selectedTask)" :key="workflow.id" class="detail-row"><span>Workflow · {{ workflow.id }}</span><b>{{ workflow.status }}</b></div></div>
            <div class="detail-block timeline-block"><h3>任务事件时间线</h3><div v-if="taskEvents.length === 0" class="muted">暂无任务事件</div><div v-for="event in taskEvents" :key="`${event.taskKey || detailTask.taskId}-${event.revision}-${event.eventType}`" class="timeline-row"><span class="timeline-marker"></span><div><strong>{{ taskEventLabel(event.eventType) }}</strong><small class="timeline-code">{{ event.eventType || 'task/event' }} · revision {{ event.revision }}</small><p>{{ taskEventSummary(event) }}</p></div><time>{{ formatTime(event.createdAt) }}</time></div></div>
            <div class="detail-block timeline-block"><h3>Agent 执行时间线</h3><div v-if="taskTimeline(selectedTask).length === 0" class="muted">暂无 Agent 事件</div><div v-for="event in taskTimeline(selectedTask)" :key="`${event.agentRunId}-${event.at}-${event.type}`" class="timeline-row"><span class="timeline-marker"></span><div><strong>{{ event.name || event.agentType || 'Agent' }}</strong><small>{{ event.type }} · {{ event.summary || '状态更新' }}</small></div><time>{{ formatTime(event.at) }}</time></div></div>
            <div class="detail-block verification-block"><h3>验证证据</h3><div class="evidence-line"><span>状态</span><b>{{ selectedTask.state?.coordinator?.verification?.status || '未记录' }}</b></div><div class="evidence-line"><span>Evidence level</span><b>{{ selectedTask.state?.coordinator?.verification?.evidenceLevel || 'L0' }}</b></div><div class="evidence-line"><span>测试已执行</span><b>{{ selectedTask.state?.coordinator?.verification?.testsExecuted ? '是' : '否' }}</b></div></div>
            <div v-if="selectedReport" class="detail-block report-block"><h3>执行报告</h3><div class="evidence-line"><span>报告状态</span><b>{{ reportStatusLabel(selectedReport.status) }}</b></div><div class="evidence-line"><span>执行步骤</span><b>{{ selectedReport.actualSteps?.length || 0 }}/{{ selectedReport.plannedSteps?.length || 0 }}</b></div><div class="evidence-line"><span>变更文件</span><b>{{ selectedReport.changedFiles?.length || 0 }} 个</b></div><div class="evidence-line"><span>验证证据</span><b>{{ selectedReport.verification?.evidenceLevel || 'L0' }} · {{ selectedReport.verification?.testsExecuted ? '已执行测试' : '未执行测试' }}</b></div><div v-if="selectedReport.actualSteps?.length" class="report-list"><strong>实际执行</strong><span v-for="step in selectedReport.actualSteps" :key="step.stepId">{{ reportStepLabel(step) }}<em v-if="step.summary">：{{ step.summary }}</em></span></div><div v-if="selectedReport.tests?.length" class="report-list"><strong>测试记录</strong><span v-for="item in selectedReport.tests" :key="item.name || item.command">{{ reportTestLabel(item) }}<em v-if="item.evidence">：{{ item.evidence }}</em></span></div><div v-if="selectedReport.unresolvedRisks?.length" class="report-list report-risk-list"><strong>未闭合风险</strong><span v-for="risk in selectedReport.unresolvedRisks" :key="risk">{{ risk }}</span></div></div>
            <div class="detail-block session-link-block"><h3>关联会话</h3><div v-if="taskDetail?.sessionLink?.available"><div class="evidence-line"><span>Session</span><b>{{ taskDetail.sessionLink.sessionId }}</b></div><div class="evidence-line"><span>回合</span><b>{{ taskDetail.sessionLink.turnId || detailTask.turnId || '未记录' }}</b></div><button class="text-button" type="button" @click="openSession({...detailTask, sessionId: taskDetail.sessionLink.sessionId, projectKey: taskDetail.sessionLink.encodedDir || detailTask.projectKey, turnId: taskDetail.sessionLink.turnId || detailTask.turnId})">打开对应会话</button></div><div v-else class="muted">对应会话暂不可用，任务数据仍可查看。</div></div>
          </div>
        </template>
      </article>

      <aside class="side-stack">
        <article class="detail-section activity-section"><div class="section-heading"><div><h2>最近活动</h2><span>按任务投影更新时间排序</span></div></div><div v-if="currentActivities.length === 0" class="muted">暂无活动</div><button v-for="item in currentActivities" :key="item.id" type="button" class="activity-row" @click="selectedTaskKey = item.id; detailOpen = true"><span class="activity-marker"></span><span class="activity-copy"><strong>{{ item.title }}</strong><small>{{ item.projectKey }} · {{ statusLabel(item.status) }}</small></span><time>{{ formatTime(item.updatedAt) }}</time></button></article>
        <article class="detail-section health-section"><div class="section-heading"><div><h2>AI 层健康</h2><span>规则、Skill 和运行证据的本地检查</span></div><span class="health-badge" :class="{healthy: data.health?.healthy}">{{ healthLabel() }}</span></div><div class="health-stat"><span>规则漂移候选</span><b>{{ data.driftCandidates.length }}</b></div><div class="health-stat"><span>待处理 Pitfall</span><b>{{ data.pitfalls.filter(item => !['mitigated', 'retired'].includes(item.status)).length }}</b></div><div v-if="data.driftCandidates.length || data.pitfalls.length" class="health-note">详细治理仍在设置页 Workbench Tab 中处理。</div></article>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.workbench-page { min-height: 100%; overflow: auto; padding: 30px clamp(20px, 4vw, 56px) 48px; background: var(--bg-deep); color: var(--text-primary); }
.workbench-header, .workbench-toolbar, .summary-grid, .board-section, .detail-layout { max-width: 1480px; margin: 0 auto; }
.workbench-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding-bottom: 24px; }.workbench-header > div { min-width: 0; }
.eyebrow { color: var(--accent-blue); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }
h1, h2, h3, p { margin: 0; }
h1 { margin-top: 5px; font-size: clamp(24px, 3vw, 34px); line-height: 1.15; letter-spacing: 0; }
.workbench-header p { margin-top: 8px; max-width: 690px; color: var(--text-secondary); font-size: 13px; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }
button { font: inherit; }
.back-button, .refresh-button, .text-button, .clear-filter { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 7px 11px; border: 1px solid var(--border); border-radius: var(--radius-btn); background: var(--bg-raised); color: var(--text-secondary); cursor: pointer; }
.back-button:hover, .refresh-button:hover, .text-button:hover, .clear-filter:hover { border-color: var(--border-hover); color: var(--text-primary); }
.refresh-button { background: var(--accent); border-color: var(--accent); color: #fff; }
.refresh-button:disabled { cursor: wait; opacity: .65; }
.refresh-icon.spinning { animation: workbench-spin .8s linear infinite; }
@keyframes workbench-spin { to { transform: rotate(360deg); } }
.workbench-toolbar { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid var(--border); background: var(--bg-base); }
.view-switch { display: inline-flex; align-items: center; padding: 2px; border: 1px solid var(--border); background: var(--bg-deep); }
.view-switch button { min-height: 28px; padding: 4px 11px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; }
.view-switch button.active { background: var(--accent); color: #fff; }
.filter-field, .toggle-field { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 12px; }
.filter-field select { min-width: 190px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-deep); color: var(--text-primary); }
.toggle-field input { accent-color: var(--accent-blue); }
.clear-filter { min-height: 30px; padding: 5px 9px; background: transparent; font-size: 12px; }
.toolbar-status { margin-left: auto; color: var(--text-muted); font-size: 12px; }
.toolbar-status.degraded { color: var(--warning); }
.state-banner { max-width: 1480px; margin: 14px auto 0; padding: 11px 14px; border: 1px solid var(--border); background: var(--bg-base); color: var(--text-secondary); font-size: 13px; }
.error-banner { display: flex; justify-content: space-between; gap: 12px; border-color: var(--error); color: var(--error); }
.error-banner button { border: 0; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.summary-item { min-height: 112px; padding: 15px 17px; border: 1px solid var(--border); border-top: 3px solid var(--border); background: var(--bg-base); }
.summary-item.tone-blue { border-top-color: var(--accent-blue); }.summary-item.tone-warning { border-top-color: var(--warning); }.summary-item.tone-success { border-top-color: var(--success); }
.summary-label, .summary-note { display: block; color: var(--text-muted); font-size: 12px; }.summary-item strong { display: block; margin: 4px 0 2px; font-size: 28px; line-height: 1; }.summary-note { color: var(--text-secondary); }
.board-section, .detail-layout { margin-top: 18px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; min-width: 0; margin-bottom: 12px; }.section-heading > div { min-width: 0; }
.section-heading h2 { font-size: 17px; line-height: 1.3; }.section-heading span, .last-updated { color: var(--text-muted); font-size: 12px; }.section-heading h2 + span { display: block; margin-top: 3px; }
.task-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.task-column { min-width: 0; min-height: 210px; padding: 11px; border: 1px solid var(--border); background: var(--bg-base); }
.task-column.column-blue { border-top: 3px solid var(--accent-blue); }.task-column.column-warning { border-top: 3px solid var(--warning); }.task-column.column-success { border-top: 3px solid var(--success); }
.column-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; color: var(--text-secondary); font-size: 12px; font-weight: 700; }.column-heading b { min-width: 21px; padding: 2px 5px; border-radius: 10px; background: var(--bg-raised); color: var(--text-primary); text-align: center; font-size: 11px; }
.column-empty { padding: 24px 5px; color: var(--text-muted); font-size: 12px; text-align: center; }
.task-card { display: block; width: 100%; min-width: 0; margin-bottom: 7px; padding: 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-raised); color: var(--text-primary); text-align: left; cursor: pointer; }.task-card:last-child { margin-bottom: 0; }.task-card:hover, .task-card.selected { border-color: var(--accent-blue); }.task-card strong { display: block; min-width: 0; margin: 7px 0 5px; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.task-card-summary { display: -webkit-box; margin: 0 0 9px; overflow: hidden; color: var(--text-secondary); font-size: 11px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.task-card-top, .task-card-meta, .detail-summary, .evidence-line, .detail-row, .health-stat { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.task-card-top, .task-card-meta { color: var(--text-muted); font-size: 11px; }.task-card-meta span:first-child { max-width: 68%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.status-dot, .activity-marker { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--accent-blue); }.column-warning .status-dot { background: var(--warning); }.column-success .status-dot { background: var(--success); }.task-status { flex: 1; color: var(--text-secondary); }
.detail-layout { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(280px, .85fr); gap: 10px; align-items: start; min-width: 0; }.detail-section { min-width: 0; padding: 15px; border: 1px solid var(--border); background: var(--bg-base); }.side-stack { display: grid; min-width: 0; gap: 10px; }.detail-summary { min-width: 0; justify-content: flex-start; flex-wrap: wrap; margin-bottom: 13px; color: var(--text-muted); font-size: 12px; }.detail-status { padding: 3px 7px; border: 1px solid var(--border); border-radius: 5px; color: var(--text-secondary); }.status-running, .status-reviewing, .status-fixing { border-color: var(--accent-blue); color: var(--accent-blue); }.status-blocked, .status-failed, .status-error { border-color: var(--warning); color: var(--warning); }.status-succeeded, .status-completed, .status-done { border-color: var(--success); color: var(--success); }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; min-width: 0; }.detail-block { min-width: 0; padding: 11px; border: 1px solid var(--border); background: var(--bg-raised); }.detail-block h3 { margin-bottom: 8px; color: var(--text-secondary); font-size: 12px; }.detail-row, .evidence-line { padding: 6px 0; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; }.detail-row:first-of-type, .evidence-line:first-of-type { border-top: 0; }.detail-row b, .evidence-line b { color: var(--text-primary); font-weight: 500; }.report-list { display: grid; gap: 5px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; line-height: 1.4; }.report-list strong { color: var(--text-primary); font-size: 11px; }.report-list em { color: var(--text-muted); font-style: normal; }.report-risk-list { color: var(--warning); }.muted { color: var(--text-muted); font-size: 12px; }.empty-panel { display: flex; min-height: 150px; align-items: center; justify-content: center; flex-direction: column; gap: 5px; border: 1px dashed var(--border); color: var(--text-muted); font-size: 12px; }.empty-panel strong { color: var(--text-secondary); font-size: 13px; }.empty-panel.compact { min-height: 100px; }
.overview-block p, .question-copy p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }.overview-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 9px; color: var(--text-muted); font-size: 11px; }.questions-block { grid-column: 1 / -1; }.question-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); }.question-row:first-of-type { border-top: 0; }.question-copy { min-width: 0; flex: 1; }.question-copy strong, .question-copy small { display: block; }.question-copy strong { margin-bottom: 4px; color: var(--text-primary); font-size: 12px; }.question-copy small { margin-top: 5px; color: var(--text-muted); font-size: 10px; }.question-row .text-button { flex: 0 0 auto; white-space: nowrap; }.question-row .text-button:disabled { cursor: not-allowed; opacity: .55; }
.activity-row { display: flex; width: 100%; align-items: center; gap: 9px; padding: 8px 0; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }.activity-row:first-of-type { border-top: 0; }.activity-row:hover strong { color: var(--accent-blue); }.activity-copy { min-width: 0; flex: 1; }.activity-copy strong, .activity-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.activity-copy strong { font-size: 12px; }.activity-copy small, .activity-row time { color: var(--text-muted); font-size: 11px; }.health-badge { padding: 3px 7px; border: 1px solid var(--warning); color: var(--warning) !important; }.health-badge.healthy { border-color: var(--success); color: var(--success) !important; }.health-stat { padding: 8px 0; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; }.health-stat:first-of-type { border-top: 0; }.health-stat b { color: var(--text-primary); font-size: 16px; }.health-note { margin-top: 8px; color: var(--text-muted); font-size: 11px; }
.detail-actions { display: flex; align-items: center; gap: 7px; }.close-detail { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--bg-raised); color: var(--text-secondary); cursor: pointer; font-size: 20px; line-height: 1; }.detail-drawer { position: fixed; z-index: 20; top: 18px; right: 18px; bottom: 18px; width: min(880px, calc(100vw - 36px)); max-width: 100%; overflow: auto; padding: 12px; border: 1px solid var(--border-hover); background: var(--bg-deep); box-shadow: 0 18px 50px rgba(0, 0, 0, .42); }.detail-drawer .side-stack { display: none; }
.agent-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }.agent-card { min-width: 0; padding: 14px; border: 1px solid var(--border); background: var(--bg-base); color: var(--text-primary); text-align: left; cursor: pointer; }.agent-card:hover { border-color: var(--accent-blue); }.agent-card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }.agent-card-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.agent-state { margin-left: auto; color: var(--text-secondary); font-size: 11px; }.agent-role { margin: 6px 0 11px; color: var(--accent-blue); font-size: 11px; }.agent-card p { margin: 5px 0; color: var(--text-secondary); font-size: 12px; line-height: 1.45; }.agent-card p b { color: var(--text-primary); }.agent-result { color: var(--success) !important; }.agent-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; color: var(--text-muted); font-size: 10px; }.agent-detail-row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--border); }.agent-detail-row > div { display: grid; min-width: 0; gap: 3px; }.agent-detail-row strong { font-size: 12px; }.agent-detail-row span, .agent-detail-row small { color: var(--text-muted); font-size: 11px; line-height: 1.35; }.agent-detail-row b { color: var(--text-secondary); font-size: 11px; white-space: nowrap; }.timeline-block { grid-column: 1 / -1; }.timeline-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); }.timeline-row:first-of-type { border-top: 0; }.timeline-row > div { display: grid; min-width: 0; gap: 2px; }.timeline-row strong { font-size: 11px; }.timeline-row small { overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.timeline-row .timeline-code { color: var(--text-muted); font-family: var(--font-mono, monospace); font-size: 10px; }.timeline-row p { margin: 2px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }.timeline-row time { color: var(--text-muted); font-size: 10px; }.timeline-marker { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-blue); }
.session-list { display: grid; gap: 6px; }.session-row { display: grid; grid-template-columns: 8px minmax(180px, 1fr) minmax(120px, .7fr) auto auto auto; align-items: center; gap: 10px; min-width: 0; padding: 12px; border: 1px solid var(--border); background: var(--bg-base); color: var(--text-primary); text-align: left; cursor: pointer; }.session-row:hover { border-color: var(--accent-blue); }.session-copy { display: grid; min-width: 0; gap: 3px; }.session-copy strong, .session-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.session-copy small, .session-row > span:not(.status-dot) { color: var(--text-muted); font-size: 11px; }.session-row time { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.detail-grid .timeline-row { justify-content: initial; }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.detail-layout { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .workbench-page { padding: 20px 14px 34px; }.workbench-header { flex-direction: column; }.header-actions { width: 100%; }.back-button, .refresh-button { flex: 1; justify-content: center; }.workbench-toolbar { align-items: flex-start; flex-wrap: wrap; }.toolbar-status { width: 100%; margin-left: 0; }.filter-field { width: 100%; justify-content: space-between; }.filter-field select { min-width: 0; flex: 1; }.task-board, .summary-grid, .detail-grid, .agent-grid { grid-template-columns: 1fr; }.task-column { min-height: 0; }.section-heading { flex-direction: column; }.last-updated { align-self: flex-start; }.session-row { grid-template-columns: 8px minmax(0, 1fr) auto; }.session-row > span:nth-of-type(3), .session-row > span:nth-of-type(4), .session-row time { display: none; }.detail-drawer { top: 8px; right: 8px; bottom: 8px; width: calc(100vw - 16px); padding: 8px; } }
@media (prefers-reduced-motion: reduce) { .refresh-icon.spinning { animation: none; } }
</style>
