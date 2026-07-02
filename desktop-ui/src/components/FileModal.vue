<script setup lang="ts">
/**
 * FileModal — 文件内容 / Diff 预览弹窗
 * 每次打开新建 Monaco 编辑器实例，关闭时 dispose。
 * 支持 file 模式（单文件 Monaco/Markdown 预览）和 diff 模式（对比）。全封闭组件，所有状态由 props/emits 管理。
 */
import { ref, watch, nextTick, onBeforeUnmount, computed, shallowRef } from 'vue'
import * as monaco from 'monaco-editor'
import { t } from '../i18n'
import type { DiffResult } from './types'

// ═══════════════════════════════════════════
// ── Props / Emits ──
// ═══════════════════════════════════════════
const props = defineProps<{
  /** 'file' | 'diff' | null —— null 时不渲染 */
  mode: string | null
  /** 文件相对路径 */
  path: string
  /** file 模式的文件内容 */
  fileContent?: string
  /** file 模式是否为二进制 */
  fileBinary?: boolean
  /** file 模式 Markdown 渲染后的 HTML */
  markdownHtml?: string
  /** 是否有未保存更改 */
  dirty?: boolean
  /** diff 模式的结果数据 */
  diff?: DiffResult | null
  /** 加载中 */
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', content: string): void
  (e: 'dirtyChange', dirty: boolean): void
}>()

// ═══════════════════════════════════════════
// ── Monaco 实例 ──
// ═══════════════════════════════════════════
const monacoContainer = shallowRef<HTMLDivElement | null>(null)
const monacoEditor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoDiffEditor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(null)
// diff 模式下 setModel 传入 createModel 创建的外部 model，diffEditor.dispose() 不自动回收
// 需要在 disposeEditors 中单独 dispose，避免反复切换文件时 model 累积泄漏
let diffOriginalModel: monaco.editor.ITextModel | null = null
let diffModifiedModel: monaco.editor.ITextModel | null = null

/** Monaco 主题 */
function monacoTheme(): 'vs' | 'vs-dark' {
  return (document.documentElement.dataset.theme || 'dark') === 'light' ? 'vs' : 'vs-dark'
}

/** 扩展名 → Monaco language ID */
function langFromPath(p: string): string {
  const ext = (p.split('.').pop() || '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    vue: 'html', json: 'json', css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', md: 'markdown', yaml: 'yaml',
    yml: 'yaml', py: 'python', rs: 'rust', go: 'go', java: 'java',
    cs: 'csharp', c: 'c', cpp: 'cpp', h: 'c', sql: 'sql', sh: 'shell',
    bash: 'shell', ps1: 'powershell', toml: 'ini', cfg: 'ini', ini: 'ini',
  }
  return map[ext] || 'plaintext'
}

/** 销毁所有 Monaco 实例 */
function disposeEditors() {
  try { monacoDiffEditor.value?.dispose() } catch {}
  monacoDiffEditor.value = null
  try { monacoEditor.value?.dispose() } catch {}
  monacoEditor.value = null
  // diff 模式下 createModel 创建的 model 需单独 dispose，monacoDiffEditor.dispose() 不回收它们
  try { diffOriginalModel?.dispose() } catch {}
  diffOriginalModel = null
  try { diffModifiedModel?.dispose() } catch {}
  diffModifiedModel = null
}

// ═══════════════════════════════════════════
// ── 创建编辑器 ──
// ═══════════════════════════════════════════
watch([() => props.mode, () => props.loading], async ([mode, loading]) => {
  disposeEditors()
  if (mode !== 'file' && mode !== 'diff') return
  if (loading) return
  await nextTick()
  await nextTick()
  const container = monacoContainer.value
  if (!container) return

  const lang = langFromPath(props.path)

  if (mode === 'file') {
    // file 模式：创建单文件编辑器
    const editor = monaco.editor.create(container, {
      value: props.fileContent || '',
      language: lang,
      theme: monacoTheme(),
      automaticLayout: true,
      readOnly: false,
      fontSize: 13,
      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    const model = editor.getModel()
    if (model) {
      model.onDidChangeContent(() => {
        const val = model.getValue()
        const isDirty = val !== (props.fileContent || '')
        emit('dirtyChange', isDirty)
      })
    }
    monacoEditor.value = editor
  } else if (mode === 'diff' && props.diff && !props.diff.binary && !props.diff.tooLarge) {
    // diff 模式：创建 diff 编辑器
    const oldText = (props.diff.lines || [])
      .filter(l => l.type === 'context' || l.type === 'del')
      .map(l => ((l.type === 'del' ? '-' : ' ') + l.text)).join('\n')
    const newText = (props.diff.lines || [])
      .filter(l => l.type === 'context' || l.type === 'add')
      .map(l => ((l.type === 'add' ? '+' : ' ') + l.text)).join('\n')

    const diffEditor = monaco.editor.createDiffEditor(container, {
      theme: monacoTheme(),
      automaticLayout: true,
      readOnly: true,
      fontSize: 13,
      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    diffEditor.setModel({
      original: (diffOriginalModel = monaco.editor.createModel(oldText, lang)),
      modified: (diffModifiedModel = monaco.editor.createModel(newText, lang)),
    })
    monacoDiffEditor.value = diffEditor
  }
}, { immediate: true })

// ═══════════════════════════════════════════
// ── 保存 ──
// ═══════════════════════════════════════════
function doSave() {
  const editor = monacoEditor.value
  if (!editor) return
  const model = editor.getModel()
  if (!model) return
  emit('save', model.getValue())
  emit('dirtyChange', false)
}

// ═══════════════════════════════════════════
// ── 关闭 + Esc ──
// ═══════════════════════════════════════════
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (props.mode === 'file' && !props.fileBinary && !props.markdownHtml) doSave()
  }
}

// 组件卸载时清理
onBeforeUnmount(() => {
  disposeEditors()
  document.removeEventListener('keydown', onKeydown)
})

// mode 变化时注册/注销键盘监听（用闭包状态防止双重注册）
let _keydownRegistered = false
watch(() => props.mode, (m) => {
  if (m && !_keydownRegistered) {
    document.addEventListener('keydown', onKeydown)
    _keydownRegistered = true
  } else if (!m && _keydownRegistered) {
    document.removeEventListener('keydown', onKeydown)
    _keydownRegistered = false
  }
}, { immediate: true })

// ═══════════════════════════════════════════
// ── Computed ──
// ═══════════════════════════════════════════
const showMonaco = computed(() => {
  if (props.loading) return false
  if (props.markdownHtml) return false
  if (props.mode === 'file' && !props.fileBinary) return true
  if (props.mode === 'diff' && props.diff && !props.diff.binary && !props.diff.tooLarge && props.diff.lines && props.diff.lines.length > 0) return true
  return false
})
</script>

<template>
  <!-- 文件内容 / Diff Modal：v-if 直接控制挂载/卸载 -->
  <div v-if="mode" class="diff-overlay" @click.self="emit('close')">
    <div class="diff-modal glass">
      <!-- 标题栏 -->
      <div class="diff-modal-header">
        <span class="diff-modal-mode">{{ mode === 'diff' ? t('ws.diffMode') : t('ws.fileMode') }}</span>
        <code class="diff-modal-path">{{ path }}</code>
        <span v-if="mode === 'file' && dirty" class="diff-dirty-mark">*</span>
        <span v-if="mode === 'diff' && diff && !diff.tooLarge && !diff.binary" class="diff-modal-stats">
          <span v-if="diff.added" class="fp-add">+{{ diff.added }}</span>
          <span v-if="diff.removed" class="fp-del">-{{ diff.removed }}</span>
        </span>
        <div class="diff-modal-spacer"></div>
        <!-- 保存按钮：仅 file 模式且非二进制非 markdown -->
        <button v-if="mode === 'file' && !fileBinary && !markdownHtml"
                class="diff-save-btn" :title="t('common.save') + ' (Ctrl+S)'" @click="doSave">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          <span>{{ t('common.save') }}</span>
        </button>
        <button class="fp-icon-btn" :title="t('ws.close') + ' (Esc)'" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- 内容区 -->
      <div class="diff-modal-body">
        <div v-if="loading" class="fp-hint">{{ t('common.loading') }}</div>
        <div v-if="!loading && mode === 'file' && fileBinary" class="fp-hint">{{ t('ws.binaryNoPreview') }}</div>
        <div v-if="!loading && mode === 'diff' && diff && diff.binary" class="fp-hint">{{ t('ws.binaryNoDiff') }}</div>
        <div v-if="!loading && mode === 'diff' && diff && diff.tooLarge" class="fp-hint">{{ t('ws.tooLargeNoDiff') }}</div>
        <div v-if="!loading && mode === 'diff' && diff && !diff.binary && !diff.tooLarge && (!diff.lines || diff.lines.length === 0)" class="fp-hint">{{ t('ws.noDiff') }}</div>
        <!-- Markdown 渲染预览 -->
        <div v-if="!loading && mode === 'file' && markdownHtml" class="md-preview" v-html="markdownHtml"></div>
        <!-- Monaco 容器 -->
        <div ref="monacoContainer" class="monaco-container" v-show="showMonaco"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-overlay {
  position: fixed; inset: 0; z-index: 290;
  background: rgba(0,0,0,.7); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}

.diff-modal {
  background: var(--bg-base, #1e1e2e);
  border: 1px solid var(--border, rgba(255,255,255,.08));
  border-radius: 16px;
  width: 90vw; max-width: 1200px;
  height: 85vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.diff-modal-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, rgba(255,255,255,.08));
  flex-shrink: 0;
}

.diff-modal-mode {
  font-size: 13px; font-weight: 600;
  color: var(--accent-blue, #818cf8);
  text-transform: uppercase; letter-spacing: .5px;
}

.diff-modal-path {
  font-size: 13px; font-family: var(--font-mono, monospace);
  color: var(--text-secondary, #aaa);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 500px;
}

.diff-dirty-mark { color: var(--warning, #f0ad4e); font-weight: bold; }

.diff-modal-stats {
  display: flex; gap: 6px; font-size: 12px; font-family: var(--font-mono, monospace);
}

.fp-add { color: var(--success, #3FB950); }
.fp-del { color: var(--error, #E94560); }

.diff-modal-spacer { flex: 1; }

.diff-save-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--accent, #E94560); color: #fff;
  border: none; padding: 7px 16px; border-radius: 8px;
  font-size: 13px; font-family: var(--font-body); cursor: pointer;
}
.diff-save-btn:hover { background: #d43d54; }

.fp-icon-btn {
  background: none; border: none; color: var(--text-muted, #888);
  cursor: pointer; padding: 6px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.fp-icon-btn:hover { color: var(--text-primary, #e0e0e0); background: var(--bg-raised, #2a2a3e); }

.diff-modal-body {
  flex: 1; overflow: hidden; position: relative;
}

.fp-hint {
  text-align: center; padding: 40px; font-size: 14px;
  color: var(--text-muted, #888);
}

.md-preview {
  padding: 24px 32px; overflow-y: auto; height: 100%;
  font-size: 14px; line-height: 1.7; color: var(--text-primary, #e0e0e0);
}

.monaco-container {
  width: 100%; height: 100%;
}
</style>
