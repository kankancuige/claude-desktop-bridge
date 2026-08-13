export interface ProjectSessionItem {
  id: string
  title?: string
  size: number
  encodedDir?: string
}

export interface ProjectSessionGroup {
  workDir: string
  encodedDir: string
  sessionCount: number
  lastActive: number
  sessions: ProjectSessionItem[]
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function upsertProjectSession<T extends ProjectSessionGroup>(
  projects: T[],
  {workDir, encodedDir, sessionId, now = Date.now()}: {workDir: string; encodedDir: string; sessionId: string; now?: number},
): T[] {
  if (!String(workDir || '').trim() || !String(sessionId || '').trim()) return projects
  const targetPath = normalizePath(workDir)
  let foundProject = false
  const next = projects.map(project => {
    if (normalizePath(project.workDir) !== targetPath) return project
    foundProject = true
    const existing = project.sessions.find(session => session.id === sessionId)
    const sessions = existing
      ? project.sessions.map(session => session.id === sessionId ? {...session} : session)
      : [{id: sessionId, size: 0, encodedDir}, ...project.sessions]
    return {...project, sessions, sessionCount: sessions.length, lastActive: Math.max(project.lastActive || 0, now)}
  })
  if (foundProject) return next
  return [{workDir, encodedDir, sessionCount: 1, lastActive: now, sessions: [{id: sessionId, size: 0, encodedDir}]} as T, ...next]
}
