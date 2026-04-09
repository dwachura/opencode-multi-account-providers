/** Maps sessionID -> providerID */
const sessions: Record<string, string> = {}

/** Maps sessionID -> needsRotation */
const pending: Record<string, boolean> = {}

/** Maps sessionID -> account index last used for a request */
const lastAccount: Record<string, number> = {}

export function track(sessionID: string, providerID: string): void {
  sessions[sessionID] = providerID
}

export function flag(sessionID: string): void {
  pending[sessionID] = true
}

export function consume(sessionID: string): boolean {
  if (pending[sessionID]) {
    delete pending[sessionID]
    return true
  }
  return false
}

export function provider(sessionID: string): string | undefined {
  return sessions[sessionID]
}

export function trackAccount(sessionID: string, index: number): void {
  lastAccount[sessionID] = index
}

export function usedAccount(sessionID: string): number | undefined {
  return lastAccount[sessionID]
}
