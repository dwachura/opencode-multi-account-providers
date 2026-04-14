/**
 * Account identity extraction.
 *
 * Each managed provider needs an `IdentityExtractor` that derives a stable
 * identifier (and optional human-readable label) from an access token. The
 * identifier is what we use to deduplicate and fingerprint accounts in
 * storage.
 */

export type AccountIdentity = {
  /** Stable, provider-specific user identifier. */
  id: string
  /** Optional human-readable label (e.g. an email address). */
  label?: string
}

export interface IdentityExtractor {
  /** Extract identity from an access token. Return undefined if no stable id can be derived. */
  extract(accessToken: string): AccountIdentity | undefined
}

const registry: Record<string, IdentityExtractor> = {}

/**
 * Default fallback extractor for providers that have no dedicated implementation.
 * Uses the access token itself as the id. This is stable for the lifetime of the
 * token but breaks on refresh — accounts will be re-detected as new entries after
 * each token rotation. Acceptable as a baseline; provider-specific extractors
 * (e.g. openai) should derive a more stable id from JWT claims.
 */
const defaultExtractor: IdentityExtractor = {
  extract: (accessToken) => ({ id: accessToken }),
}

export function register(providerID: string, extractor: IdentityExtractor): void {
  registry[providerID] = extractor
}

export function get(providerID: string, enableDefaultExtractor = false): IdentityExtractor | undefined {
  return registry[providerID] ?? (enableDefaultExtractor ? defaultExtractor : undefined)
}
