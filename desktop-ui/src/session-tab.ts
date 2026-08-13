export interface SessionTabDescriptor {
  projectPath: string
  historySessionId?: string | null
  gatewaySessionId?: string | null
}

function clean(value: string | null | undefined): string {
  return String(value || '').trim()
}

export function tabMatchesSession(
  tab: SessionTabDescriptor,
  projectPath: string,
  historySessionId?: string | null,
): boolean {
  const requestedHistory = clean(historySessionId)
  return clean(tab.projectPath).toLowerCase() === clean(projectPath).toLowerCase()
    && !!requestedHistory
    && clean(tab.historySessionId) === requestedHistory
}

export function tabCanHostNewSession(tab: SessionTabDescriptor, projectPath: string): boolean {
  return clean(tab.projectPath).toLowerCase() === clean(projectPath).toLowerCase()
    && !clean(tab.historySessionId)
    && !clean(tab.gatewaySessionId)
}

export function findSessionTab<T extends SessionTabDescriptor>(
  tabs: T[],
  projectPath: string,
  historySessionId?: string | null,
): T | undefined {
  const requestedHistory = clean(historySessionId)
  if (requestedHistory) {
    return tabs.find(tab => tabMatchesSession(tab, projectPath, requestedHistory))
  }
  return tabs.find(tab => tabCanHostNewSession(tab, projectPath))
}

export function sessionTabIdentityKey(tab: SessionTabDescriptor): string | null {
  const sessionIdentity = clean(tab.historySessionId) || clean(tab.gatewaySessionId)
  if (!sessionIdentity) return null
  return `${clean(tab.projectPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}|${sessionIdentity}`
}
