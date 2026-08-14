<script setup lang="ts">
import {computed} from 'vue'
import type {TaskActivityEntry, TaskActivityState} from '../task-activity'

const props = defineProps<{
  state: TaskActivityState
  now: number
}>()

const emit = defineEmits<{
  toggle: [expanded: boolean]
}>()

const totalDuration = computed(() => {
  if (!props.state.startedAt) return 0
  const end = props.state.running ? props.now : props.state.updatedAt
  return Math.max(0, end - props.state.startedAt)
})

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分`
}

function entryDuration(entry: TaskActivityEntry): number {
  if (entry.durationMs) return entry.durationMs
  const end = ['running', 'waiting'].includes(entry.status) ? props.now : (entry.completedAt || entry.updatedAt)
  return entry.startedAt ? Math.max(0, end - entry.startedAt) : 0
}

function onToggle(event: Event) {
  emit('toggle', (event.currentTarget as HTMLDetailsElement).open)
}
</script>

<template>
  <details class="activity-timeline" :open="state.expanded" @toggle="onToggle">
    <summary class="activity-header">
      <span class="activity-state-mark" :class="state.phase" aria-hidden="true"></span>
      <span class="activity-header-main">
        <strong>{{ state.title || '任务执行轨迹' }}</strong>
        <span v-if="state.detail" class="activity-current-detail">{{ state.detail }}</span>
      </span>
      <span class="activity-summary-meta">
        {{ state.entries.length }} 步 · {{ formatDuration(totalDuration) }}
      </span>
      <span class="activity-chevron" aria-hidden="true"></span>
    </summary>

    <div class="activity-entries">
      <div v-for="entry in state.entries" :key="entry.id" class="activity-entry" :class="entry.status">
        <span class="entry-rail" aria-hidden="true">
          <span class="entry-dot"></span>
        </span>
        <details v-if="entry.detail" class="entry-details">
          <summary class="entry-summary">
            <span class="entry-title">{{ entry.title }}</span>
            <span class="entry-duration">{{ formatDuration(entryDuration(entry)) }}</span>
          </summary>
          <div class="entry-detail">{{ entry.detail }}</div>
        </details>
        <div v-else class="entry-summary no-detail">
          <span class="entry-title">{{ entry.title }}</span>
          <span class="entry-duration">{{ formatDuration(entryDuration(entry)) }}</span>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.activity-timeline {
  width: min(760px, calc(100% - 32px));
  margin: 4px auto 10px;
  color: var(--text-primary);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.activity-header {
  min-height: 42px;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto 12px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  list-style: none;
  background: var(--bg-raised);
}

.activity-header::-webkit-details-marker,
.entry-summary::-webkit-details-marker {
  display: none;
}

.activity-header-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.activity-header-main strong {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
}

.activity-current-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
}

.activity-summary-meta,
.entry-duration {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.activity-state-mark,
.entry-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.activity-state-mark.starting,
.activity-state-mark.planning,
.activity-state-mark.thinking,
.activity-state-mark.tool,
.activity-state-mark.agent,
.activity-state-mark.compacting,
.activity-state-mark.responding,
.activity-state-mark.reviewing,
.activity-state-mark.fixing {
  background: var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent);
}

.activity-state-mark.completed,
.activity-entry.completed .entry-dot {
  background: var(--success);
}

.activity-state-mark.failed,
.activity-entry.failed .entry-dot {
  background: var(--error);
}

.activity-state-mark.stopped,
.activity-entry.stopped .entry-dot {
  background: var(--text-muted);
}

.activity-entry.running .entry-dot,
.activity-entry.waiting .entry-dot {
  background: var(--warning);
}

.activity-chevron {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: var(--text-muted);
  transform: rotate(45deg) translateY(-2px);
  transition: transform 160ms ease;
}

.activity-timeline[open] .activity-chevron {
  transform: rotate(225deg) translate(-1px, -1px);
}

.activity-entries {
  padding: 8px 12px 10px;
  background: var(--bg-base);
}

.activity-entry {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  min-height: 30px;
}

.entry-rail {
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: 7px;
}

.entry-rail::after {
  content: '';
  position: absolute;
  top: 17px;
  bottom: -7px;
  width: 1px;
  background: var(--border);
}

.activity-entry:last-child .entry-rail::after {
  display: none;
}

.entry-dot {
  width: 7px;
  height: 7px;
  z-index: 1;
}

.entry-details {
  min-width: 0;
}

.entry-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 6px;
  list-style: none;
  cursor: pointer;
}

.entry-summary.no-detail {
  cursor: default;
}

.entry-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
}

.entry-detail {
  margin: 0 0 8px;
  padding: 7px 9px;
  max-height: 120px;
  overflow: auto;
  color: var(--text-secondary);
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .activity-timeline {
    width: calc(100% - 20px);
  }

  .activity-header {
    grid-template-columns: 12px minmax(0, 1fr) 12px;
  }

  .activity-summary-meta {
    grid-column: 2;
  }

  .activity-header-main {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .activity-chevron {
    transition: none;
  }
}
</style>
