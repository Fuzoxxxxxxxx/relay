export interface IgdbCredentials {
  clientId: string
  clientSecret: string
}

export interface IgdbGameInfo {
  id: number
  name: string
  altNames: string[]
  summary: string | null
  storyline: string | null
  genres: string[]
  developers: string[]
  publishers: string[]
  /** Timestamp UNIX (secondes) de la première sortie. */
  firstRelease: number | null
  /** Vrai pour un DLC, une extension ou une édition : à éviter pour une correspondance automatique. */
  isDlcOrEdition: boolean
  popularity: number
  coverId: string | null
  artworkIds: string[]
  screenshotIds: string[]
  /** Bandes-annonces YouTube référencées par IGDB. */
  videos?: Array<{ videoId: string; name: string }>
}

export type IgdbImageSize = 'cover_small' | 'cover_big' | 'cover_big_2x' | 'screenshot_med' | '720p' | '1080p'

export function igdbImageUrl(imageId: string, size: IgdbImageSize): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`
}

class IgdbHttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface IgdbToken {
  clientId: string
  accessToken: string
  expiresAt: number
}

const gameFields = [
  'name', 'alternative_names.name', 'summary', 'storyline', 'genres.name',
  'involved_companies.developer', 'involved_companies.publisher', 'involved_companies.company.name',
  'first_release_date', 'parent_game', 'version_parent', 'total_rating_count',
  'cover.image_id', 'artworks.image_id', 'screenshots.image_id', 'videos.video_id', 'videos.name',
].join(',')
const cacheDurationMs = 6 * 60 * 60 * 1000
const imageIdPattern = /^[A-Za-z0-9_-]{4,64}$/
let requestQueue: Promise<void> = Promise.resolve()
let lastRequestAt = 0

function runRateLimited<T>(request: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(async () => {
    const waitMs = Math.max(0, 250 - (Date.now() - lastRequestAt))
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    lastRequestAt = Date.now()
    return request()
  })
  requestQueue = result.then(() => undefined, () => undefined)
  return result
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const name = asRecord(item)?.name
    return typeof name === 'string' && name.trim() ? [name.trim()] : []
  })
}

function imageIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const id = asRecord(item)?.image_id
    return typeof id === 'string' && imageIdPattern.test(id) ? [id] : []
  })
}

function companiesOf(value: unknown, role: 'developer' | 'publisher'): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    const entry = asRecord(item)
    const name = asRecord(entry?.company)?.name
    return entry?.[role] === true && typeof name === 'string' ? [name] : []
  }))]
}

function videosOf(value: unknown): Array<{ videoId: string; name: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const entry = asRecord(item)
    const videoId = entry?.video_id
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return []
    const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Bande-annonce'
    return [{ videoId, name }]
  })
}

export function parseIgdbGame(entry: unknown): IgdbGameInfo | null {
  const game = asRecord(entry)
  if (!game || typeof game.id !== 'number' || typeof game.name !== 'string') return null
  const coverId = asRecord(game.cover)?.image_id
  return {
    id: game.id,
    name: game.name,
    altNames: namesOf(game.alternative_names),
    summary: typeof game.summary === 'string' && game.summary.trim() ? game.summary.trim() : null,
    storyline: typeof game.storyline === 'string' && game.storyline.trim() ? game.storyline.trim() : null,
    genres: namesOf(game.genres),
    developers: companiesOf(game.involved_companies, 'developer'),
    publishers: companiesOf(game.involved_companies, 'publisher'),
    firstRelease: typeof game.first_release_date === 'number' ? game.first_release_date : null,
    isDlcOrEdition: game.parent_game !== undefined || game.version_parent !== undefined,
    popularity: typeof game.total_rating_count === 'number' ? game.total_rating_count : 0,
    coverId: typeof coverId === 'string' && imageIdPattern.test(coverId) ? coverId : null,
    artworkIds: imageIdsOf(game.artworks),
    screenshotIds: imageIdsOf(game.screenshots),
    videos: videosOf(game.videos),
  }
}

function escapeApicalypse(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export class IgdbClient {
  private readonly getCredentials: () => Promise<IgdbCredentials | null>
  private token: IgdbToken | null = null
  private tokenPromise: { clientId: string; promise: Promise<string> } | null = null
  private readonly results = new Map<string, { expiresAt: number; result: Promise<unknown[]> }>()

  constructor(getCredentials: () => Promise<IgdbCredentials | null>) {
    this.getCredentials = getCredentials
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getCredentials()) !== null
  }

  clearCache(): void {
    this.token = null
    this.tokenPromise = null
    this.results.clear()
  }

  async validateCredentials(credentials: IgdbCredentials): Promise<void> {
    this.token = null
    this.tokenPromise = null
    const accessToken = await this.getAccessToken(credentials)
    const response = await this.post(credentials, accessToken, 'games', 'fields id; limit 1;')
    if (!response.ok) throw new Error(`IGDB : accès à l’API refusé (HTTP ${response.status}).`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('IGDB : réponse de vérification invalide.')
  }

  private post(credentials: IgdbCredentials, accessToken: string, endpoint: string, body: string): Promise<Response> {
    return runRateLimited(() => fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': credentials.clientId,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'content-type': 'text/plain',
      },
      body,
      signal: AbortSignal.timeout(8_000),
    }))
  }

  private async getAccessToken(credentials: IgdbCredentials): Promise<string> {
    if (this.token?.clientId === credentials.clientId && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken
    }
    if (this.tokenPromise?.clientId === credentials.clientId) return this.tokenPromise.promise

    const pending = runRateLimited(async () => {
      const body = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'client_credentials',
      })
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error(`IGDB : authentification refusée (HTTP ${response.status}).`)
      const payload = asRecord(await response.json())
      if (!payload || typeof payload.access_token !== 'string' || typeof payload.expires_in !== 'number') {
        throw new Error('IGDB : réponse d’authentification invalide.')
      }
      this.token = {
        clientId: credentials.clientId,
        accessToken: payload.access_token,
        expiresAt: Date.now() + Math.max(0, payload.expires_in) * 1000,
      }
      return payload.access_token
    })
    this.tokenPromise = { clientId: credentials.clientId, promise: pending }
    try {
      return await pending
    } finally {
      if (this.tokenPromise?.promise === pending) this.tokenPromise = null
    }
  }

  /** Requête mise en cache. Sans identifiants configurés, renvoie une liste vide. */
  private async query(endpoint: string, body: string): Promise<unknown[]> {
    const credentials = await this.getCredentials()
    if (!credentials) return []
    const key = `${endpoint}:${body}`
    const cached = this.results.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.result

    const result = (async () => {
      const accessToken = await this.getAccessToken(credentials)
      const response = await this.post(credentials, accessToken, endpoint, body)
      if (!response.ok) throw new IgdbHttpError(`IGDB : requête impossible (HTTP ${response.status}).`, response.status)
      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) throw new Error('IGDB : réponse de recherche invalide.')
      return payload
    })()
    this.results.set(key, { expiresAt: Date.now() + cacheDurationMs, result })
    try {
      return await result
    } catch (error) {
      this.results.delete(key)
      throw error
    }
  }

  private parseGames(rows: unknown[]): IgdbGameInfo[] {
    return rows.flatMap((row) => {
      const game = parseIgdbGame(row)
      return game ? [game] : []
    })
  }

  async search(term: string, limit = 15): Promise<IgdbGameInfo[]> {
    const cleaned = term.trim().slice(0, 200)
    if (!cleaned) return []
    return this.parseGames(await this.query('games', `fields ${gameFields}; search "${escapeApicalypse(cleaned)}"; limit ${limit};`))
  }

  async getById(id: number): Promise<IgdbGameInfo | null> {
    if (!Number.isSafeInteger(id) || id < 1) return null
    return this.parseGames(await this.query('games', `fields ${gameFields}; where id = ${id}; limit 1;`))[0] ?? null
  }

  /** Les anciens et nouveaux schémas IGDB ne nomment pas la source de la même façon : on essaie les deux. */
  private async externalGames(condition: string): Promise<Array<{ uid: string; game: number }>> {
    for (const sourceFilter of ['external_game_source = 1', 'category = 1']) {
      try {
        const rows = await this.query('external_games', `fields uid,game; where ${condition} & ${sourceFilter}; limit 20;`)
        return rows.flatMap((row) => {
          const entry = asRecord(row)
          return entry && typeof entry.uid === 'string' && typeof entry.game === 'number'
            ? [{ uid: entry.uid, game: entry.game }]
            : []
        })
      } catch (error) {
        if (!(error instanceof IgdbHttpError) || error.status !== 400) throw error
      }
    }
    return []
  }

  async findBySteamAppId(appId: string): Promise<IgdbGameInfo | null> {
    if (!/^\d+$/.test(appId)) return null
    const [match] = await this.externalGames(`uid = "${appId}"`)
    return match ? this.getById(match.game) : null
  }

  async steamAppIdOf(igdbId: number): Promise<string | null> {
    if (!Number.isSafeInteger(igdbId) || igdbId < 1) return null
    const [match] = await this.externalGames(`game = ${igdbId}`)
    return match && /^\d+$/.test(match.uid) ? match.uid : null
  }
}
