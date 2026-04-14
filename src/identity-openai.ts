import type { IdentityExtractor } from "./identity"

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return undefined
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"))
  } catch {
    return undefined
  }
}

const openaiExtractor: IdentityExtractor = {
  extract(accessToken) {
    const claims = decodeJwtPayload(accessToken)
    if (!claims) throw new Error("invalid OpenAI access token JWT")

    const openaiAuth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined
    const openaiProfile = claims["https://api.openai.com/profile"] as Record<string, unknown> | undefined

    const id = typeof openaiAuth?.chatgpt_account_user_id === "string"
      ? openaiAuth.chatgpt_account_user_id
      : undefined

    if (!id) throw new Error("missing OpenAI chatgpt_account_user_id claim")

    const label =
      (typeof openaiProfile?.email === "string" ? openaiProfile.email : undefined) ??
      (typeof claims.email === "string" ? claims.email : undefined)

    return { id, label }
  },
}

export default openaiExtractor
