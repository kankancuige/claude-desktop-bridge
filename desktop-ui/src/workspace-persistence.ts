export interface WorkspaceTabShell {
  id: string
  projectPath: string
  label: string
  sessionId: string | null
  historySessionId: string | null
  taskState?: Record<string, unknown> | null
}

export interface WorkspaceShell {
  version: 1
  projects: string[]
  tabs: WorkspaceTabShell[]
  activeTabId: string | null
  activeProject: string | null
}

const VERSION = 1 as const

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizePersistedTaskState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const state = {...value as Record<string, unknown>}
  if (state.status === 'running') {
    state.status = 'interrupted'
    state.outcome = 'failed'
    state.continuationReason = 'execution_error'
    state.resumable = true
  }
  return state
}

export function parseWorkspaceShell(raw: string | null | undefined): WorkspaceShell {
  if (!raw) return {version: VERSION, projects: [], tabs: [], activeTabId: null, activeProject: null}
  try {
    const value = JSON.parse(raw) as Partial<WorkspaceShell>
    const projects = Array.isArray(value.projects)
      ? [...new Set(value.projects.map(cleanString).filter((item): item is string => !!item))]
      : []
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.map((tab): WorkspaceTabShell | null => {
          const id = cleanString(tab?.id)
          const projectPath = cleanString(tab?.projectPath)
          if (!id || !projectPath) return null
          return {
            id,
            projectPath,
            label: cleanString(tab?.label) || projectPath,
            sessionId: cleanString(tab?.sessionId),
            historySessionId: cleanString(tab?.historySessionId),
            taskState: normalizePersistedTaskState(tab?.taskState),
          }
        }).filter((item): item is WorkspaceTabShell => !!item)
      : []
    const activeTabId = cleanString(value.activeTabId)
    const activeProject = cleanString(value.activeProject)
    return {
      version: VERSION,
      projects,
      tabs,
      activeTabId: tabs.some(tab => tab.id === activeTabId) ? activeTabId : null,
      activeProject,
    }
  } catch {
    return {version: VERSION, projects: [], tabs: [], activeTabId: null, activeProject: null}
  }
}

export function serializeWorkspaceShell(value: Omit<WorkspaceShell, 'version'>): string {
  return JSON.stringify({version: VERSION, ...value})
}

export function readWorkspaceShell(storage: Pick<Storage, 'getItem'>, key: string): WorkspaceShell {
  return parseWorkspaceShell(storage.getItem(key))
}

export function writeWorkspaceShell(storage: Pick<Storage, 'setItem'>, key: string, value: Omit<WorkspaceShell, 'version'>): void {
  storage.setItem(key, serializeWorkspaceShell(value))
}
