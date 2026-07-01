<script setup lang="ts">
// WorkflowTab.vue —— Claude Code 原生 Workflow DAG 编辑器
import {ref, onMounted, onBeforeUnmount, nextTick} from 'vue'
import {useWorkflow} from '../composables/useWorkflow'

const GW = 'http://127.0.0.1:3456'

// ── 模式切换: 'dag' | 'script' ──
const mode = ref<'dag' | 'script'>('script')

// ── 脚本编辑器 ──
const wfScripts = ref<any[]>([])
const wfLoading = ref(false)
const editingWfName = ref('')
const editWfContent = ref('')
const wfSaving = ref(false)
const wfSaved = ref(false)
const wfCreateName = ref('')

async function loadWfScripts() {
  wfLoading.value = true
  try {
    const r = await fetch(`${GW}/api/workflows`);
    if (r.ok) {
      const d = await r.json();
      wfScripts.value = d.workflows || []
    }
  } catch {
  }
  wfLoading.value = false
}

function startWfEdit(wf: any) {
  editingWfName.value = wf.name;
  editWfContent.value = '';
  wfSaved.value = false
  fetch(`${GW}/api/workflows/${encodeURIComponent(wf.name)}`).then(r => r.json()).then(d => {
    editWfContent.value = d.content || ''
  }).catch(() => {
  })
}

async function saveWfScript() {
  if (!editingWfName.value) return;
  wfSaving.value = true;
  wfSaved.value = false
  try {
    await fetch(`${GW}/api/workflows/${encodeURIComponent(editingWfName.value)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: editWfContent.value})
    });
    wfSaved.value = true;
    setTimeout(() => wfSaved.value = false, 3000)
  } catch {
  }
  wfSaving.value = false
}

async function createWfScript() {
  const n = wfCreateName.value.trim();
  if (!n) return
  const fn = n.endsWith('.mjs') ? n : n + '.mjs'
  const tpl = `export const meta = { name: '${n.replace(/\\.mjs$/, '')}', description: '', phases: [{ title: 'Step 1' }] }\n\nphase('Step 1')\nconst result = await agent('Your prompt here', { agentType: 'general-purpose', label: 'example' })\nlog(result)\n`
  wfSaving.value = true
  try {
    await fetch(`${GW}/api/workflows/${encodeURIComponent(fn)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: tpl})
    });
    wfCreateName.value = '';
    await loadWfScripts();
    startWfEdit({name: fn})
  } catch {
  }
  wfSaving.value = false
}

const delTarget = ref<any>(null)

async function confirmDeleteWf() {
  const wf = delTarget.value;
  if (!wf) return;
  try {
    await fetch(`${GW}/api/workflows/${encodeURIComponent(wf.name)}`, {method: 'DELETE'});
    await loadWfScripts();
    if (editingWfName.value === wf.name) editingWfName.value = ''
  } catch {
  }
  ;delTarget.value = null
}

function switchMode(m: 'dag' | 'script') {
  mode.value = m;
  if (m === 'script') loadWfScripts()
}

// 脚本编辑器的介绍面板
const showIntro = ref(true)

function dismissIntro() {
  showIntro.value = false
}

const {
  agents, nodes, edges, groups, phases, wfMeta,
  selectedNodeId, connectingFrom,
  addNode, removeNode, removeEdge,
  startConnect, completeConnect, updateNodePos,
  createGroup, removeGroup, recalcGroup,
  addPhase, removePhase, updatePhasePos, updatePhaseTitle, updateGroupLabel,
  reset, dtoWorkflowScript,
} = useWorkflow()

// Esc
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') startConnect('')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// 坐标转换
const svgW = 2000;
const svgH = 1200
const svgRef = ref<SVGSVGElement | null>(null)

function toSvg(cx: number, cy: number) {
  const r = svgRef.value?.getBoundingClientRect();
  if (!r) return {x: cx, y: cy}
  return {x: (cx - r.left) * svgW / r.width, y: (cy - r.top) * svgH / r.height}
}

const connX = ref(0);
const connY = ref(0)

// 画布
function onCanvasClick(e: MouseEvent) {
  if ((e.target as any)?.closest?.('.wf-g')) return;
  selectedNodeId.value = null
}

// 节点拖拽
let dragId: string | null = null;
let dOffX = 0;
let dOffY = 0

function onNodeMDown(e: MouseEvent, nid: string) {
  if (e.button !== 0) return;
  e.stopPropagation()
  if ((e.target as any)?.closest?.('.wf-port')) return
  dragId = nid;
  selectedNodeId.value = nid
  const node = nodes.value.find(n => n.id === nid)
  if (node) {
    const p = toSvg(e.clientX, e.clientY);
    dOffX = p.x - node.x;
    dOffY = p.y - node.y
  }
}

function onNodeMMove(e: MouseEvent) {
  if (connectingFrom.value) {
    const p = toSvg(e.clientX, e.clientY);
    connX.value = p.x;
    connY.value = p.y
  }
  if (!dragId) return;
  const p = toSvg(e.clientX, e.clientY);
  updateNodePos(dragId, p.x - dOffX, p.y - dOffY)
}

function onNodeMUp() {
  dragId = null
}

// Phase 拖拽
let phDrag: string | null = null

function onPhDown(e: MouseEvent, pid: string) {
  e.stopPropagation();
  phDrag = pid
}

function onMMove(e: MouseEvent) {
  onNodeMMove(e);
  if (phDrag) {
    const p = toSvg(e.clientX, e.clientY);
    updatePhasePos(phDrag, p.y)
  }
}

function onMUp() {
  onNodeMUp();
  phDrag = null
}

// 端口
function onPortOut(e: MouseEvent, nid: string) {
  e.stopPropagation();
  e.preventDefault();
  startConnect(nid)
}

function onPortIn(e: MouseEvent, nid: string) {
  e.stopPropagation();
  e.preventDefault();
  if (connectingFrom.value) completeConnect(nid)
}

// 拖入
function onDrop(e: DragEvent) {
  e.preventDefault();
  const ag = e.dataTransfer?.getData('agent');
  if (ag) {
    const p = toSvg(e.clientX, e.clientY);
    addNode(ag, p.x - 75, p.y - 40)
  }
}

// Auto Layout
function autoLayout() {
  if (nodes.value.length === 0) return
  const lv = new Map<string, number>()
  for (const n of nodes.value) {
    lv.set(n.id, n.dependsOn.length === 0 ? 0 : Math.max(...n.dependsOn.map(d => lv.get(d) ?? 0)) + 1)
  }
  const maxLv = Math.max(...lv.values(), 0)
  const lay: typeof nodes.value[] = Array.from({length: maxLv + 1}, () => [])
  for (const n of nodes.value) lay[lv.get(n.id) ?? 0].push(n)
  for (let li = 0; li < lay.length; li++) for (let ni = 0; ni < lay[li].length; ni++) {
    lay[li][ni].x = 60 + li * 220;
    lay[li][ni].y = 60 + ni * 100;
    recalcGroup(lay[li][ni].id)
  }
  phases.value = []
  for (let li = 0; li < lay.length; li++) addPhase(`Phase ${li + 1}`, 40 + li * 100 - 50)
}

// 多选 → parallel 组
const multi = ref<string[]>([])

function toggleMulti(id: string) {
  const i = multi.value.indexOf(id);
  if (i >= 0) multi.value.splice(i, 1); else multi.value.push(id)
}

function mkGroup() {
  if (multi.value.length >= 2) {
    createGroup([...multi.value]);
    multi.value = []
  }
}

// ── 全局 Workflow 开关 ──
const wfEnabled = ref(false)

async function loadWfConfig() {
  try {
    const r = await fetch(`${GW}/api/config/workflow-settings`);
    if (r.ok) {
      const d = await r.json();
      wfEnabled.value = !!d.enabled
    }
  } catch {
  }
}

async function toggleWfEnabled() {
  wfEnabled.value = !wfEnabled.value
  await fetch(`${GW}/api/config/workflow-settings`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({enabled: wfEnabled.value})
  })
}

onMounted(() => {
  loadWfScripts();
  loadWfConfig()
})

// 清空确认弹框
const confirmReset = ref(false)

function doReset() {
  reset();
  confirmReset.value = false
}

// DAG → 脚本导出
const exportedScript = ref('')
const copiedToClipboard = ref(false)

function exportToScript() {
  exportedScript.value = dtoWorkflowScript()
  copiedToClipboard.value = false
}

async function copyExportedScript() {
  await navigator.clipboard.writeText(exportedScript.value)
  copiedToClipboard.value = true
  setTimeout(() => copiedToClipboard.value = false, 3000)
}
</script>

<template>
  <div class="wf-root" @mousemove="onMMove" @mouseup="onMUp">
    <!-- module-header: DAG / Script 双模式 + 全局开关 -->
    <div class="module-header">
      <div class="module-header-left">
        <input v-if="mode==='dag'" v-model="wfMeta.name" class="wf-hdr-name" placeholder="工作流名称"/>
        <span v-if="editingWfName && mode==='script'" class="wf-hdr-name"
              style="color:var(--text-primary)">{{ editingWfName }}</span>
        <span v-if="mode==='dag'&&nodes.length" class="cat-badge device">{{ nodes.length }} 节点</span>
        <span v-if="mode==='dag'&&groups.length" class="cat-badge custom-badge">{{ groups.length }} 组</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <!-- 全局开关 -->
        <button class="wf-toggle" :class="{ on: wfEnabled }" @click="toggleWfEnabled"
                :title="wfEnabled ? 'Workflow 已启用' : 'Workflow 已禁用'">
          <span class="wf-toggle-knob"></span>
        </button>
        <span style="font-size:11px;color:var(--text-muted)">{{ wfEnabled ? 'ON' : 'OFF' }}</span>
        <div class="wf-mode-tabs">
          <button class="wf-mode-tab" :class="{ active: mode==='dag' }" @click="switchMode('dag')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            DAG
          </button>
          <button class="wf-mode-tab" :class="{ active: mode==='script' }" @click="switchMode('script')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            JS
          </button>
        </div>
        <template v-if="mode==='dag'">
          <button v-if="multi.length>=2" class="btn-primary" style="padding:6px 12px;font-size:12px" @click="mkGroup">组成
            parallel 组
          </button>
          <button class="refresh-btn" :disabled="nodes.length<2" @click="autoLayout"
                  style="width:auto;padding:0 12px;font-size:12px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </button>
          <button class="btn-text" @click="confirmReset = true" style="font-size:12px">清空</button>
          <button class="btn-add" :disabled="nodes.length===0" @click="exportToScript"
                  style="font-size:12px;padding:6px 10px;border-color:var(--accent-gold);color:var(--accent-gold)">导出脚本</button>
        </template>
        <template v-if="mode==='script'">
          <button class="refresh-btn" :class="{ spinning: wfLoading }" @click="loadWfScripts" :disabled="wfLoading"
                  style="width:auto;padding:0 12px;font-size:12px" title="刷新">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </button>
        </template>
      </div>
    </div>

    <!-- ── DAG 模式 ── -->
    <template v-if="mode==='dag'">
      <div style="flex:1;display:flex;overflow:hidden">
        <!-- 工具箱 —— 左侧窄栏 -->
        <div class="wf-toolbox">
          <div class="cat-label" style="margin-bottom:6px">Agent 节点</div>
          <div v-for="ag in agents" :key="ag.key" class="list-item wf-ag" draggable="true" style="padding:6px 8px"
               @dragstart="(e: DragEvent) => { e.dataTransfer!.setData('agent', ag.key) }">
            <span class="item-icon" style="display:flex;align-items:center;justify-content:center;width:22px"
                  v-html="ag.svg"></span>
            <span style="font-size:13px;font-weight:500;flex:1">{{ ag.label }}</span>
          </div>
          <button class="btn-add" @click="addNode('general-purpose',200+Math.random()*300,80+Math.random()*200)"
                  style="margin-top:4px">+ 添加节点
          </button>
          <div class="cat-label" style="margin-top:12px;margin-bottom:4px">结构</div>
          <button class="btn-add" @click="addPhase('New Phase', 200+phases.length*120)">━ Phase 分隔条</button>
        </div>

        <!-- SVG 画布 -->
        <div class="wf-canvas" @drop.prevent="onDrop" @dragover.prevent @click="onCanvasClick">
          <svg ref="svgRef" :width="svgW" :height="svgH" style="display:block">
            <defs>
              <pattern id="gd" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--border)" opacity="0.15"/>
              </pattern>
              <marker id="ar" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                <polygon points="0 0,6 2,0 4" fill="var(--accent-gold)"/>
              </marker>
            </defs>
            <rect width="100%" height="100%" fill="url(#gd)"/>

            <!-- Phase 分隔条 -->
            <g v-for="ph in phases" :key="ph.id" style="cursor:ns-resize" @mousedown="onPhDown($event, ph.id)">
              <line :x1="0" :y1="ph.y" :x2="svgW" :y2="ph.y" stroke="var(--accent)" stroke-width="1"
                    stroke-dasharray="8,4" opacity="0.4"/>
              <rect :x="14" :y="ph.y-13" :width="ph.title.length*11+50" height="26" rx="5" fill="var(--bg-base)"
                    stroke="var(--accent)" stroke-width="1"/>
              <foreignObject :x="18" :y="ph.y-12" :width="ph.title.length*11+36" height="24">
                <input :value="ph.title" @input="(e: any) => updatePhaseTitle(ph.id, e.target.value)" @mousedown.stop
                       style="width:100%;height:100%;background:transparent;border:none;outline:none;font-size:11px;font-weight:600;font-family:var(--font-body);color:var(--accent);padding:0"/>
              </foreignObject>
              <circle class="wf-x" :cx="14+ph.title.length*11+46" :cy="ph.y-3" r="6" fill="var(--error)" opacity="0.3"
                      @mousedown.stop="removePhase(ph.id)"/>
              <text :x="14+ph.title.length*11+46" :y="ph.y" text-anchor="middle" font-size="11" fill="#fff"
                    style="cursor:pointer" @mousedown.stop="removePhase(ph.id)">×
              </text>
            </g>

            <!-- Parallel 组框 -->
            <g v-for="g in groups" :key="g.id">
              <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" rx="8" fill="none" stroke="var(--accent)"
                    stroke-width="1" stroke-dasharray="5,3" opacity="0.5"/>
              <rect :x="g.x+4" :y="g.y-12" width="74" height="20" rx="5" fill="var(--bg-base)" stroke="var(--accent)"
                    stroke-width="1"/>
              <text :x="g.x+41" :y="g.y+2" text-anchor="middle" font-size="10" font-weight="600" fill="var(--accent)">
                parallel
              </text>
              <circle class="wf-x" :cx="g.x+g.w+8" :cy="g.y-6" r="6" fill="var(--error)" opacity="0.3"
                      @click="removeGroup(g.id)"/>
              <text :x="g.x+g.w+8" :y="g.y-3" text-anchor="middle" font-size="11" fill="#fff" style="cursor:pointer"
                    @click="removeGroup(g.id)">×
              </text>
            </g>

            <!-- 连线 -->
            <g v-for="e in edges" :key="e.from+'→'+e.to">
              <path v-if="nodes.find(n=>n.id===e.from)&&nodes.find(n=>n.id===e.to)"
                    :d="'M'+(nodes.find(n=>n.id===e.from)!.x+160)+','+(nodes.find(n=>n.id===e.from)!.y+41)+' C'+(nodes.find(n=>n.id===e.from)!.x+240)+','+(nodes.find(n=>n.id===e.from)!.y+41)+' '+(nodes.find(n=>n.id===e.to)!.x-80)+','+(nodes.find(n=>n.id===e.to)!.y+41)+' '+nodes.find(n=>n.id===e.to)!.x+','+(nodes.find(n=>n.id===e.to)!.y+36)"
                    stroke="transparent" stroke-width="16" fill="none" style="cursor:pointer"
                    @dblclick="removeEdge(e.from,e.to)"/>
              <path v-if="nodes.find(n=>n.id===e.from)&&nodes.find(n=>n.id===e.to)"
                    :d="'M'+(nodes.find(n=>n.id===e.from)!.x+160)+','+(nodes.find(n=>n.id===e.from)!.y+41)+' C'+(nodes.find(n=>n.id===e.from)!.x+240)+','+(nodes.find(n=>n.id===e.from)!.y+41)+' '+(nodes.find(n=>n.id===e.to)!.x-80)+','+(nodes.find(n=>n.id===e.to)!.y+41)+' '+nodes.find(n=>n.id===e.to)!.x+','+(nodes.find(n=>n.id===e.to)!.y+36)"
                    stroke="var(--accent-gold)" stroke-width="1.5" fill="none" opacity="0.5" marker-end="url(#ar)"
                    @dblclick="removeEdge(e.from,e.to)"/>
            </g>

            <!-- 连线预览 -->
            <path v-if="connectingFrom&&nodes.find(n=>n.id===connectingFrom)"
                  :d="'M'+(nodes.find(n=>n.id===connectingFrom)!.x+160)+','+(nodes.find(n=>n.id===connectingFrom)!.y+41)+' C'+(nodes.find(n=>n.id===connectingFrom)!.x+240)+','+(nodes.find(n=>n.id===connectingFrom)!.y+41)+' '+(connX-40)+','+connY+' '+connX+','+connY"
                  stroke="var(--accent)" stroke-width="2" stroke-dasharray="6,4" fill="none" opacity="0.5"/>

            <!-- 节点卡片（扁平化） -->
            <g v-for="node in nodes" :key="node.id" class="wf-g" @mousedown="onNodeMDown($event, node.id)"
               @dblclick="toggleMulti(node.id)">
              <!-- 选中的发光环 -->
              <rect v-if="selectedNodeId===node.id" :x="node.x-2" :y="node.y-2" width="164" height="86" rx="6"
                    fill="none" :stroke="agents.find(a=>a.key===node.agent)?.color || '#6BAEE0'" stroke-width="2"
                    opacity="0.4"/>
              <!-- 主体卡片 -->
              <rect :x="node.x" :y="node.y" width="160" height="82" rx="4"
                    :fill="selectedNodeId===node.id?'var(--bg-raised)':'var(--bg-base)'"
                    :stroke="multi.includes(node.id)?'var(--accent)':'var(--border)'" stroke-width="1"/>
              <!-- 顶部 Agent 色带 -->
              <path
                  :d="'M'+node.x+' '+node.y+' L'+(node.x+160)+' '+node.y+' L'+(node.x+160)+' '+(node.y+28)+' Q'+(node.x+80)+' '+(node.y+20)+' '+node.x+' '+(node.y+28)+' Z'"
                  :fill="agents.find(a=>a.key===node.agent)?.color || '#8B9DC3'" opacity="0.12"/>
              <rect :x="node.x" :y="node.y" width="160" height="3" rx="1.5"
                    :fill="agents.find(a=>a.key===node.agent)?.color || '#8B9DC3'"/>
              <!-- Agent 名称 -->
              <text :x="node.x+80" :y="node.y+19" text-anchor="middle" font-size="13" font-weight="600"
                    :fill="agents.find(a=>a.key===node.agent)?.color || '#8B9DC3'" font-family="var(--font-body)">
                {{ agents.find(a => a.key === node.agent)?.label }}
              </text>
              <!-- 提示文本 -->
              <text :x="node.x+80" :y="node.y+44" text-anchor="middle" font-size="10" fill="var(--text-secondary)"
                    font-family="var(--font-mono)">{{
                  (node.prompt || '未设置提示词').substring(0, 26)
                }}{{ (node.prompt || '').length > 26 ? '…' : '' }}
              </text>
              <!-- 底部信息行 -->
              <text :x="node.x+12" :y="node.y+72" font-size="10" fill="var(--text-muted)">{{
                  node.status || 'pending'
                }}
              </text>
              <text :x="node.x+148" :y="node.y+72" text-anchor="end" font-size="10" fill="var(--text-muted)">
                {{ node.model === 'inherit' ? 'inherit' : node.model }}{{ node.groupId ? ' / G' : '' }}
              </text>
              <!-- 输出端口（右侧） -->
              <circle :cx="node.x+160" :cy="node.y+41" r="5" fill="var(--bg-base)"
                      :stroke="agents.find(a=>a.key===node.agent)?.color || '#8B9DC3'" stroke-width="2" class="wf-port"
                      style="cursor:crosshair" @mousedown.stop="onPortOut($event, node.id)"/>
              <!-- 输入端口（左侧） -->
              <circle :cx="node.x" :cy="node.y+41" r="5" fill="var(--bg-base)"
                      :stroke="agents.find(a=>a.key===node.agent)?.color || '#8B9DC3'" stroke-width="2" class="wf-port"
                      style="cursor:pointer" @mousedown.stop="onPortIn($event, node.id)"/>
            </g>

            <text v-if="nodes.length===0" :x="svgW/2" :y="svgH/2" text-anchor="middle" fill="var(--text-muted)"
                  font-size="14" font-family="var(--font-body)">从左侧 Agent 列表拖拽到画布<br>点击节点端口连线 · 双击多选组成
              parallel 组
            </text>
          </svg>
        </div>

        <!-- 属性面板 -->
        <div class="wf-props">
          <!-- 工作流属性 -->
          <section class="section-block" style="margin-bottom:16px">
            <h2 class="section-title">工作流属性</h2>
            <div class="field">
              <label>名称</label>
              <input :value="wfMeta.name" @input="(e: any)=>wfMeta.name=e.target.value" class="field-input"
                     placeholder="My Workflow"/>
            </div>
            <div class="field">
              <label>描述</label>
              <input :value="wfMeta.description" @input="(e: any)=>wfMeta.description=e.target.value"
                     class="field-input" placeholder="可选项"/>
            </div>
            <div class="field">
              <label>Token 预算 (0=不限)</label>
              <input :value="wfMeta.budgetTokens" type="number" min="0" class="field-input"
                     @change="(e: any)=>wfMeta.budgetTokens=parseInt(e.target.value)||0"/>
            </div>
          </section>

          <!-- 节点属性 -->
          <section class="section-block" v-if="selectedNodeId">
            <h2 class="section-title"><span
                v-html="agents.find(a=>a.key===nodes.find(n=>n.id===selectedNodeId)?.agent)?.svg"></span>
              {{ agents.find(a => a.key === nodes.find(n => n.id === selectedNodeId)?.agent)?.label }}</h2>
            <div class="field">
              <label>Agent</label>
              <select :value="nodes.find(n=>n.id===selectedNodeId)?.agent"
                      @change="(e: any)=>{const n=nodes.find(n=>n.id===selectedNodeId);if(n)n.agent=e.target.value}"
                      class="field-input">
                <option v-for="ag in agents" :key="ag.key" :value="ag.key">{{ ag.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>任务描述</label>
              <textarea :value="nodes.find(n=>n.id===selectedNodeId)?.prompt"
                        @input="(e: any)=>{const n=nodes.find(n=>n.id===selectedNodeId);if(n)n.prompt=e.target.value}"
                        class="field-input mono" rows="4" style="resize:vertical;min-height:60px;font-size:12px"
                        placeholder="描述这个步骤..."/>
            </div>
            <div class="field">
              <label>模型</label>
              <select :value="nodes.find(n=>n.id===selectedNodeId)?.model"
                      @change="(e: any)=>{const n=nodes.find(n=>n.id===selectedNodeId);if(n)n.model=e.target.value}"
                      class="field-input">
                <option value="inherit">inherit</option>
                <option value="Opus">Opus</option>
                <option value="Sonnet">Sonnet</option>
                <option value="Haiku">Haiku</option>
              </select>
            </div>
            <div class="field">
              <label>最大轮数</label>
              <input :value="nodes.find(n=>n.id===selectedNodeId)?.maxTurns" type="number" min="1" max="50"
                     class="field-input"
                     @change="(e: any)=>{const n=nodes.find(n=>n.id===selectedNodeId);if(n)n.maxTurns=parseInt(e.target.value)||15}"/>
            </div>
            <div v-if="nodes.find(n=>n.id===selectedNodeId)?.dependsOn.length" class="field">
              <label>依赖</label>
              <div style="display:flex;flex-wrap:wrap;gap:4px;padding-top:2px">
                <span v-for="d in nodes.find(n=>n.id===selectedNodeId)?.dependsOn" :key="d" class="cat-badge"
                      style="font-family:var(--font-mono);font-size:10px">{{ d }}</span>
              </div>
            </div>
            <button class="btn-danger-sm" @click="removeNode(selectedNodeId)"
                    style="margin-top:4px;justify-content:center;padding:6px">删除节点
            </button>
          </section>
        </div>
      </div>

      <!-- 底栏提示 -->
      <div class="action-bar" v-if="nodes.length>0">
        <span style="font-size:13px;color:var(--text-muted);flex:1">DAG 用于可视化编排预览，切到 JS 模式保存脚本后，模型会根据任务复杂度自主调用</span>
      </div>
    </template>

    <!-- ── 脚本模式 ── -->
    <template v-if="mode==='script'">
      <div style="flex:1;display:flex;overflow:hidden">
        <!-- 左侧文件列表 -->
        <div class="wf-script-sidebar">
          <div class="wf-script-hdr">Scripts</div>
          <div class="wf-script-create">
            <input v-model="wfCreateName" placeholder="文件名.mjs" class="field-input"
                   style="flex:1;font-size:11px;padding:5px 8px" @keydown.enter="createWfScript"/>
            <button class="btn-primary" :disabled="!wfCreateName.trim()||wfSaving" @click="createWfScript"
                    style="padding:5px 8px;font-size:11px">+
            </button>
          </div>
          <div class="wf-script-list">
            <div v-for="wf in wfScripts" :key="wf.name" class="wf-script-row"
                 :class="{ active: editingWfName===wf.name }" @click="startWfEdit(wf)">
              <span
                  style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">{{
                  wf.name
                }}</span>
              <button class="wf-del-btn" @click.stop="delTarget = wf" title="删除">×</button>
            </div>
            <div v-if="wfScripts.length===0"
                 style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">暂无脚本
            </div>
          </div>
        </div>

        <!-- 中央编辑器 -->
        <div class="wf-script-editor" v-if="editingWfName">
          <div class="wf-editor-hdr">
            <span style="font-weight:600;font-size:14px">{{ editingWfName }}</span>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn-primary" :disabled="wfSaving" @click="saveWfScript"
                      style="padding:5px 14px;font-size:12px">{{ wfSaved ? '已保存' : '保存' }}
              </button>
            </div>
          </div>
          <textarea v-model="editWfContent" class="code-editor" spellcheck="false"
                    style="flex:1;min-height:300px;font-family:var(--font-mono);font-size:13px;line-height:1.6;resize:none;border:none;background:var(--bg-deep);color:var(--text-primary);padding:14px;outline:none;border-radius:0"/>
          <div class="wf-editor-ftr">
            <span style="font-size:12px;color:var(--text-muted)">模型根据任务复杂度自主判断是否调用此脚本</span>
          </div>
        </div>
        <div class="wf-script-editor" v-else>
          <!-- 简介面板 -->
          <div v-if="showIntro" class="wf-intro">
            <button class="btn-text" @click="dismissIntro" style="position:absolute;top:10px;right:14px;font-size:18px">
              ×
            </button>
            <div style="font-size:32px;margin-bottom:8px">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
            </div>
            <h2>Claude Code Workflow</h2>
            <p style="font-size:13px;color:var(--text-muted);line-height:1.6;max-width:480px;margin:0 auto 16px">
              使用 Claude Code 原生 Workflow JS API 编写多 Agent 编排脚本。
              支持 <code>agent()</code> <code>parallel()</code> <code>pipeline()</code> <code>phase()</code>
              <code>log()</code> <code>budget</code>。
            </p>
            <div class="wf-intro-actions">
              <button class="btn-add" @click="() => { wfCreateName = 'my-workflow'; createWfScript() }"
                      style="font-size:13px;padding:8px 16px">+ 新建脚本
              </button>
              <button class="btn-add" @click="dismissIntro" style="font-size:13px;padding:8px 16px">知道了</button>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:16px">
              也可以切到 DAG 模式，拖拽节点可视化编排
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Toast -->

    <!-- 删除确认弹框 -->
    <div v-if="delTarget" class="wf-overlay" @click.self="delTarget = null">
      <div class="wf-modal glass">
        <button class="wf-modal-close" @click="delTarget = null">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="wf-modal-title">删除脚本</h2>
        <p class="wf-modal-note">确定删除 {{ delTarget.name }} 吗？此操作不可撤销。</p>
        <div class="wf-modal-actions">
          <button class="btn-text" @click="delTarget = null">取消</button>
          <button class="btn-primary danger" @click="confirmDeleteWf">删除</button>
        </div>
      </div>
    </div>

    <!-- 清空确认弹框 -->
    <div v-if="confirmReset" class="wf-overlay" @click.self="confirmReset = false">
      <div class="wf-modal glass">
        <button class="wf-modal-close" @click="confirmReset = false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="wf-modal-title">清空画布</h2>
        <p class="wf-modal-note">确定清空所有节点、连线和阶段吗？此操作不可撤销。</p>
        <div class="wf-modal-actions">
          <button class="btn-text" @click="confirmReset = false">取消</button>
          <button class="btn-primary danger" @click="doReset">清空</button>
        </div>
      </div>
    </div>

    <!-- 导出脚本预览弹框 -->
    <div v-if="exportedScript" class="wf-overlay" @click.self="exportedScript = ''">
      <div class="wf-modal glass" style="max-width:700px;max-height:80vh;display:flex;flex-direction:column;text-align:left">
        <button class="wf-modal-close" @click="exportedScript = ''">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 class="wf-modal-title" style="text-align:center">导出脚本</h2>
        <p class="wf-modal-note" style="text-align:center">此代码由 DAG 拓扑自动编译，可粘贴到 JS 模式保存执行</p>
        <pre style="flex:1;overflow:auto;background:var(--bg-deep);color:var(--text-primary);padding:14px;border-radius:8px;font-family:var(--font-mono);font-size:12px;line-height:1.5;margin:0;max-height:50vh;white-space:pre-wrap;word-break:break-all">{{ exportedScript }}</pre>
        <div class="wf-modal-actions" style="margin-top:16px">
          <button class="btn-text" @click="exportedScript = ''">关闭</button>
          <button class="btn-primary" @click="copyExportedScript" style="font-size:13px">{{ copiedToClipboard ? '已复制' : '复制到剪贴板' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wf-root {
  display: flex;
  flex-direction: column;
  height: 100%
}

/* ── 复刻 SettingsView scoped 样式（scoped 隔离，无法继承） ── */

/* module-header */
.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0
}

.module-header-left {
  display: flex;
  align-items: center;
  gap: 10px
}

.tab-icon {
  font-size: 21px;
  width: 26px;
  text-align: center;
  flex-shrink: 0
}

/* cat-badge */
.cat-badge {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(107, 174, 224, 0.1);
  color: var(--accent-blue);
  margin-left: 8px;
  vertical-align: middle
}

.cat-badge.device {
  background: rgba(63, 185, 80, 0.1);
  color: var(--success)
}

.cat-badge.custom-badge {
  background: rgba(233, 69, 96, 0.08);
  color: var(--accent)
}

/* cat-label / btn-add */
.cat-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px
}

.btn-add {
  background: none;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  padding: 7px 12px;
  border-radius: var(--radius-btn);
  font-size: 12px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0
}

.btn-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(233, 69, 96, 0.05)
}

/* list-item */
.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius-btn);
  border: 1px solid transparent;
  transition: all var(--transition-fast);
  cursor: pointer;
  font-family: var(--font-body)
}

.list-item:hover {
  background: var(--bg-base);
  border-color: var(--border)
}

.item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  flex-shrink: 0;
  color: var(--accent-gold)
}

.item-icon:deep(svg) {
  width: 16px;
  height: 16px;
  display: block
}

/* refresh-btn */
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
  font-family: var(--font-body)
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-primary);
  background: var(--bg-raised)
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed
}

/* section-block / section-title */
.section-block {
  margin-bottom: 16px
}

.section-title {
  font-family: var(--font-heading);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border)
}

/* field / field-input */
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px
}

.field label {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px
}

.field-input {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 10px;
  border-radius: var(--radius-input);
  font-size: 14px;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-fast)
}

.field-input:focus {
  border-color: var(--accent)
}

.field-input.mono {
  font-family: var(--font-mono);
  font-size: 13px
}

/* 工具箱 */
.wf-toolbox {
  width: 150px;
  background: var(--bg-base);
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-shrink: 0;
  overflow-y: auto
}

.wf-ag {
  padding: 5px 8px !important;
  margin: 0;
  border-radius: var(--radius-btn) !important
}

.wf-ag:hover {
  background: var(--bg-raised);
  border-color: var(--accent) !important
}

/* 画布 */
.wf-canvas {
  flex: 1;
  overflow: auto;
  background: var(--bg-deep)
}

.wf-g {
  cursor: grab
}

.wf-g:active {
  cursor: grabbing
}

.wf-port {
  transition: opacity .15s, r .15s
}

.wf-port:hover {
  opacity: 0.7 !important;
  r: 9
}

.wf-x {
  transition: opacity .15s;
  opacity: 0
}

.wf-x:hover {
  opacity: 0.7
}

g:hover > .wf-x {
  opacity: 1
}

/* 属性面板 */
.wf-props {
  width: 230px;
  background: var(--bg-base);
  border-left: 1px solid var(--border);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto
}

.wf-hdr-name {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-body);
  width: 180px;
  outline: none
}

.wf-hdr-name::placeholder {
  color: var(--text-muted)
}

/* action-bar / buttons */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0
}

.save-ok {
  font-size: 14px;
  color: var(--success);
  font-weight: 500
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
  transition: all var(--transition-fast)
}

.btn-primary:hover:not(:disabled) {
  background: #d43d54;
  box-shadow: var(--shadow-glow)
}

.btn-primary:disabled {
  opacity: .3;
  cursor: default
}

.btn-text {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font-body);
  padding: 4px 8px;
  border-radius: 4px
}

.btn-text:hover {
  color: var(--text-primary);
  background: var(--bg-raised)
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
  align-items: center
}

.btn-danger-sm:hover {
  color: var(--error);
  border-color: rgba(248, 81, 73, 0.3);
  background: rgba(248, 81, 73, 0.08)
}

/* ── Modal overlay (glass 风格，同 Settings) ── */
.wf-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(4px)
}

.wf-modal {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-modal, 16px);
  padding: 28px 32px;
  text-align: center;
  max-width: 400px;
  width: 90vw;
  position: relative
}

.wf-modal.glass {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06)
}

.wf-modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-btn);
  transition: all var(--transition-fast)
}

.wf-modal-close:hover {
  color: var(--text-primary);
  background: var(--bg-raised)
}

.wf-modal-title {
  font-family: var(--font-heading);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px
}

.wf-modal-note {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 24px;
  line-height: 1.6
}

.wf-modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center
}

.btn-primary.danger {
  background: #ef4444
}

.btn-primary.danger:hover:not(:disabled) {
  background: #dc2626
}

/* ── 模式切换标签 ── */
/* ── 全局开关 toggle ── */
.wf-toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-deep);
  cursor: pointer;
  position: relative;
  transition: all .2s;
  flex-shrink: 0;
  padding: 0
}

.wf-toggle.on {
  background: var(--accent);
  border-color: var(--accent)
}

.wf-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: all .2s
}

.wf-toggle.on .wf-toggle-knob {
  left: 18px;
  background: #fff
}

.wf-mode-tabs {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  overflow: hidden
}

.wf-mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-body);
  transition: all var(--transition-fast)
}

.wf-mode-tab.active {
  background: var(--accent);
  color: #fff
}

.wf-mode-tab:not(.active):hover {
  background: var(--bg-raised);
  color: var(--text-primary)
}

/* intro panel */
.wf-intro {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  height: 100%
}

.wf-intro h2 {
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px
}

.wf-intro code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-deep);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--accent-gold)
}

.wf-intro-actions {
  display: flex;
  gap: 8px
}

/* ── 脚本列表 ── */
.wf-script-sidebar {
  width: 180px;
  background: var(--bg-base);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0
}

.wf-script-hdr {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 500;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border)
}

.wf-script-list {
  flex: 1;
  overflow-y: auto
}

.wf-script-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: all .15s;
  font-size: 12px
}

.wf-script-row:hover {
  background: var(--bg-raised)
}

.wf-script-row.active {
  background: rgba(233, 69, 96, 0.06);
  border-left: 3px solid var(--accent)
}

.wf-del-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0
}

.wf-script-row:hover .wf-del-btn {
  opacity: 0.6
}

.wf-del-btn:hover {
  color: var(--error)
}

.wf-script-create {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border)
}

.wf-script-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden
}

.wf-editor-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base)
}

.wf-editor-ftr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-base)
}

/* code-editor (同 SettingsView 的 .code-editor 样式) */
.code-editor {
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
  tab-size: 2
}

.code-editor:focus {
  border-color: var(--accent)
}

/* refresh-btn spinning */
.refresh-btn.spinning svg {
  animation: test-spin .8s linear infinite
}

@keyframes test-spin {
  to {
    transform: rotate(360deg)
  }
}

</style>
