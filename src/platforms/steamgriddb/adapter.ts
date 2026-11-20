const baseUrl = 'https://www.steamgriddb.com/api/v2'
const cacheDurationMs = 6 * 60 * 60 * 1000

export interface SteamGridDbGame {
  id: number
  name: string
  verified: boolean
}

export type SteamGridDbImageKind = 'cover' | 'hero'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isSteamGridDbImage(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'steamgriddb.com' || url.hostname.endsWith('.steamgriddb.com'))
  } catch {
    return false
  }
}

/** Client de l'API officielle SteamGridDB (clé personnelle, https://www.steamgriddb.com/profile/preferences/api). */
export class SteamGridDbClient {
  private readonly getKey: () => Promise<string | null>
  private readonly cache = new Map<string, { expiresAt: number; result: Promise<unknown> }>()

  constructor(getKey: () => Promise<string | null>) {
    this.getKey = getKey
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getKey()) !== null
  }

  clearCache(): void {
    this.cache.clear()
  }

  private async request(key: string, pathAndQuery: string, allowNotFound = false): Promise<unknown> {
    const cacheKey = `${key.slice(0, 6)}:${pathAndQuery}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.result
    const result = (async () => {
      const response = await fetch(`${baseUrl}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      })
      if (response.status === 404 && allowNotFound) return null
      if (response.status === 401 || response.status === 403) throw new Error('SteamGridDB : clé d’API refusée.')
      if (!response.ok) throw new Error(`SteamGridDB : requête impossible (HTTP ${response.status}).`)
      const payload = asRecord(await response.json())
      if (!payload || payload.success !== true) return null
      return payload.data ?? null
    })()
    this.cache.set(cacheKey, { expiresAt: Date.now() + cacheDurationMs, result })
    try {
      return await result
    } catch (error) {
      this.cache.delete(cacheKey)
      throw error
    }
  }

  async validateKey(key: string): Promise<void> {
    this.clearCache()
    const response = await fetch(`${baseUrl}/search/autocomplete/test`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 401 || response.status === 403) throw new Error('SteamGridDB : clé d’API refusée.')
    if (!response.ok) throw new Error(`SteamGridDB : vérification impossible (HTTP ${response.status}).`)
  }

  async findBySteamAppId(appId: string): Promise<SteamGridDbGame | null> {
    const key = await this.getKey()
    if (!key || !/^\d+$/.test(appId)) return null
    const data = asRecord(await this.request(key, `/games/steam/${appId}`, true))
    return data && typeof data.id === 'number' && typeof data.name === 'string'
      ? { id: data.id, name: data.name, verified: data.verified === true }
      : null
  }

  async search(term: string): Promise<SteamGridDbGame[]> {
    const key = await this.getKey()
    const cleaned = term.trim().slice(0, 120)
    if (!key || !cleaned) return []
    const data = await this.request(key, `/search/autocomplete/${encodeURIComponent(cleaned)}`, true)
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      const game = asRecord(item)
      return game && typeof game.id === 'number' && typeof game.name === 'string'
        ? [{ id: game.id, name: game.name, verified: game.verified === true }]
        : []
    })
  }

  /** Images triées par note communautaire décroissante (sans contenu adulte ni humoristique). */
  async listImages(gameId: number, kind: SteamGridDbImageKind): Promise<string[]> {
    const key = await this.getKey()
    if (!key || !Number.isSafeInteger(gameId) || gameId < 1) return []
    const query = kind === 'cover'
      ? `/grids/game/${gameId}?dimensions=600x900,342x482&types=static&nsfw=false&humor=false`
      : `/heroes/game/${gameId}?dimensions=1920x620&types=static&nsfw=false&humor=false`
    const data = await this.request(key, query, true)
    if (!Array.isArray(data)) return []
    return data
      .flatMap((item) => {
        const image = asRecord(item)
        return image && isSteamGridDbImage(image.url)
          ? [{ url: image.url, score: typeof image.score === 'number' ? image.score : 0 }]
          : []
      })
      .sort((first, second) => second.score - first.score)
      .slice(0, 3)
      .map((image) => image.url)
  }
}
