export type RequestContext = {
  sessionID: string
  providerID: string
  startedAt: number
}

export type AuthInterval = {
  providerID: string
  accountID: string
  fingerprint: string
  startAt: number
  endAt: number | null
}

const pending: Record<string, boolean> = {}
const requests: Record<string, RequestContext> = {}
const authTimeline: Record<string, AuthInterval[]> = {}

export function reset(): void {
  for (const key of Object.keys(pending)) delete pending[key]
  for (const key of Object.keys(requests)) delete requests[key]
  for (const key of Object.keys(authTimeline)) delete authTimeline[key]
}

export function flag(sessionID: string): void {
  pending[sessionID] = true
}

export function consume(sessionID: string): boolean {
  if (!pending[sessionID]) return false
  delete pending[sessionID]
  return true
}

export function trackRequest(sessionID: string, providerID: string, startedAt = Date.now()): void {
  requests[sessionID] = { sessionID, providerID, startedAt }
}

export function request(sessionID: string): RequestContext | undefined {
  return requests[sessionID]
}

export function providers(): string[] {
  return Object.keys(authTimeline)
}

export function intervals(providerID: string): AuthInterval[] {
  return authTimeline[providerID] ?? []
}

export function openAuth(
  providerID: string,
  accountID: string,
  fingerprint: string,
  at = Date.now(),
): AuthInterval {
  const current = currentAuth(providerID)
  if (current && current.accountID === accountID && current.fingerprint === fingerprint) {
    return current
  }
  if (current) current.endAt = at
  const next: AuthInterval = { providerID, accountID, fingerprint, startAt: at, endAt: null }
  authTimeline[providerID] = [...(authTimeline[providerID] ?? []), next]
  return next
}

export function closeAuth(providerID: string, at = Date.now()): void {
  const current = currentAuth(providerID)
  if (!current) return
  current.endAt = at
}

export function currentAuth(providerID: string): AuthInterval | undefined {
  return (authTimeline[providerID] ?? []).findLast((entry) => entry.endAt === null)
}

export function authAt(providerID: string, at: number): AuthInterval | undefined {
  return (authTimeline[providerID] ?? []).findLast(
    (entry) => entry.startAt <= at && (entry.endAt === null || at < entry.endAt),
  )
}
