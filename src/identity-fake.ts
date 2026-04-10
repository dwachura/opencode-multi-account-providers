import type { IdentityExtractor } from "./identity"

const fakeExtractor: IdentityExtractor = {
  extract(accessToken) {
    return { id: accessToken, label: accessToken }
  },
}

export default fakeExtractor
