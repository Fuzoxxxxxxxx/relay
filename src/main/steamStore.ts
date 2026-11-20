/**
 * Accès à Steam Store (appdetails, recherche) et aux images du CDN Steam.
 * Ce sont les mêmes ressources que celles affichées par SteamDB, sans passer par son site
 * (SteamDB ne propose pas d'API publique).
 */
export interface StoreArtwork {
  header_image?: string
  capsule_image?: string
  capsule_imagev5?: string
  background?: string
  background_raw?: string
  screenshots?: string[]
}

export interface SteamMedia {
  screenshots: Array<{ thumb: string; full: string }>
  videos: Array<{ title: string; thumbnail: string | null; url: string }>
}

export interface SteamAppDetails {
  appId: string
  name: string
  type: string
  summary: string | null
  description: string | null
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate: string | null
  artwork: StoreArtwork
  media: SteamMedia
}

export interface SteamSearchItem {
  id: number
  name: string
  thumbnail: string | null
}

const cacheMs = 6 * 60 * 60 * 1000
const detailsCache = new Map<string, { expiresAt: number; result: Promise<SteamAppDetails | null> }>()
const searchCache = new Map<string, { expiresAt: number; result: Promise<SteamSearchItem[]> }>()

export function clearSteamStoreCache(appId?: string): void {
  if (appId) detailsCache.delete(appId)
  else {
    detailsCache.clear()
    searchCache.clear()
  }
}

export function isSteamImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'steamstatic.com' || url.hostname.endsWith('.steamstatic.com'))
  } catch {
    return false
  }
}

const cdnRoots = (appId: string) => [
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`,
  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`,
]

/** Visuels officiels « bibliothèque » (portrait 600x900 et bannière 1920x620). */
export function steamLibraryImages(appId: string, kind: 'cover' | 'hero'): string[] {
  const files = kind === 'cover' ? ['library_600x900_2x.jpg', 'library_600x900.jpg'] : ['library_hero.jpg']
  return cdnRoots(appId).flatMap((root) => files.map((file) => `${root}/${file}`))
}

/** Visuels de repli (paysage) lorsque les visuels « bibliothèque » n'existent pas. */
export function steamFallbackImages(appId: string, artwork: StoreArtwork | null, kind: 'cover' | 'hero'): string[] {
  const files = kind === 'cover' ? ['capsule_616x353.jpg', 'header.jpg', 'capsule_231x87.jpg'] : ['header.jpg', 'capsule_616x353.jpg']
  const store = kind === 'cover'
    ? [artwork?.capsule_image, artwork?.capsule_imagev5, artwork?.header_image, artwork?.background_raw]
    : [artwork?.background_raw, artwork?.background, artwork?.header_image, ...(artwork?.screenshots ?? [])]
  return [
    ...cdnRoots(appId).flatMap((root) => files.map((file) => `${root}/${file}`)),
    ...store.filter(isSteamImageUrl),
  ]
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d{1,6});/g, (_match, code: string) => {
      const value = Number(code)
      return value > 0 && value < 0x110000 ? String.fromCodePoint(value) : ''
    })
    .replace(/&amp;/g, '&')
}

/** Convertit le HTML des descriptions Steam en texte brut en conservant les paragraphes. */
export function htmlToText(html: string): string {
  const text = decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''))
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function limitText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const slice = text.slice(0, maxLength)
  const paragraph = slice.lastIndexOf('\n\n')
  if (paragraph > maxLength * 0.5) return `${slice.slice(0, paragraph).trim()}\n\n…`
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (sentence > maxLength * 0.5) return `${slice.slice(0, sentence + 1).trim()} …`
  return `${slice.trim()}…`
}

function stringList(value: unknown, key?: string): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = key
      ? (typeof item === 'object' && item !== null ? (item as Record<string, unknown>)[key] : undefined)
      : item
    return typeof text === 'string' && text.trim() ? [text.trim()] : []
  })
}

function httpsSteamUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const upgraded = value.replace(/^http:\/\//i, 'https://')
  return isSteamImageUrl(upgraded) ? upgraded : null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Captures d'écran et bandes-annonces du magasin Steam (liens hébergés sur le CDN Steam uniquement). */
function parseSteamMedia(data: Record<string, unknown>): SteamMedia {
  const screenshots = Array.isArray(data.screenshots)
    ? data.screenshots.flatMap((item) => {
      const record = asObject(item)
      const full = httpsSteamUrl(record?.path_full)
      const thumb = httpsSteamUrl(record?.path_thumbnail) ?? full
      return full && thumb ? [{ thumb, full }] : []
    })
    : []
  const videos = Array.isArray(data.movies)
    ? data.movies.flatMap((item) => {
      const record = asObject(item)
      const mp4 = asObject(record?.mp4)
      const webm = asObject(record?.webm)
      const url = httpsSteamUrl(mp4?.max) ?? httpsSteamUrl(mp4?.['480']) ?? httpsSteamUrl(webm?.max) ?? httpsSteamUrl(webm?.['480'])
      if (!url) return []
      const name = typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : 'Bande-annonce'
      return [{ title: name, thumbnail: httpsSteamUrl(record?.thumbnail), url }]
    })
    : []
  return { screenshots: screenshots.slice(0, 12), videos: videos.slice(0, 4) }
}

function parseDetails(appId: string, data: Record<string, unknown>): SteamAppDetails {
  const artwork = Object.fromEntries(
    ['header_image', 'capsule_image', 'capsule_imagev5', 'background', 'background_raw']
      .flatMap((key) => isSteamImageUrl(data[key]) ? [[key, data[key]]] : []),
  ) as Omit<StoreArtwork, 'screenshots'>
  const screenshots = Array.isArray(data.screenshots)
    ? data.screenshots.flatMap((item) => {
      const path = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).path_full : undefined
      return isSteamImageUrl(path) ? [path] : []
    })
    : []
  const about = typeof data.about_the_game === 'string' ? htmlToText(data.about_the_game) : ''
  const short = typeof data.short_description === 'string' ? htmlToText(data.short_description) : ''
  const release = typeof data.release_date === 'object' && data.release_date !== null
    ? (data.release_date as Record<string, unknown>).date
    : undefined
  return {
    appId,
    name: typeof data.name === 'string' ? data.name : '',
    type: typeof data.type === 'string' ? data.type : '',
    summary: short || null,
    description: about ? limitText(about, 2200) : null,
    genres: stringList(data.genres, 'description'),
    developers: stringList(data.developers),
    publishers: stringList(data.publishers),
    releaseDate: typeof release === 'string' && release.trim() ? release.trim() : null,
    artwork: { ...artwork, screenshots },
    media: parseSteamMedia(data),
  }
}

/** Détails Steam en français (repli automatique sur l'anglais côté Steam si la traduction n'existe pas). */
export function fetchSteamDetails(appId: string): Promise<SteamAppDetails | null> {
  if (!/^\d+$/.test(appId)) return Promise.resolve(null)
  const cached = detailsCache.get(appId)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const url = new URL('https://store.steampowered.com/api/appdetails/')
  url.searchParams.set('appids', appId)
  url.searchParams.set('cc', 'fr')
  url.searchParams.set('l', 'french')
  const result = fetch(url, { signal: AbortSignal.timeout(8_000) })
    .then(async (response) => {
      if (!response.ok) return null
      const payload: unknown = await response.json()
      if (typeof payload !== 'object' || payload === null) return null
      const app = (payload as Record<string, unknown>)[appId]
      if (typeof app !== 'object' || app === null || (app as Record<string, unknown>).success !== true) return null
      const data = (app as Record<string, unknown>).data
      return typeof data === 'object' && data !== null ? parseDetails(appId, data as Record<string, unknown>) : null
    })
    .catch(() => null)
  detailsCache.set(appId, { expiresAt: Date.now() + cacheMs, result })
  return result
}

export function searchSteamStore(term: string): Promise<SteamSearchItem[]> {
  const cleaned = term.trim().slice(0, 120)
  if (!cleaned) return Promise.resolve([])
  const key = cleaned.toLocaleLowerCase('en')
  const cached = searchCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', cleaned)
  url.searchParams.set('l', 'english')
  url.searchParams.set('cc', 'US')
  const result = fetch(url, { signal: AbortSignal.timeout(8_000) })
    .then(async (response) => {
      if (!response.ok) return []
      const payload: unknown = await response.json()
      const items = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).items : null
      if (!Array.isArray(items)) return []
      return items.slice(0, 12).flatMap((item): SteamSearchItem[] => {
        if (typeof item !== 'object' || item === null) return []
        const { id, name, tiny_image: tiny } = item as Record<string, unknown>
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || typeof name !== 'string') return []
        return [{ id, name, thumbnail: isSteamImageUrl(tiny) ? tiny : null }]
      })
    })
    .catch(() => [])
  searchCache.set(key, { expiresAt: Date.now() + cacheMs, result })
  return result
}
