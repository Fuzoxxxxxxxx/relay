/**
 * Client de l'API publique egdata (https://api.egdata.app) : catalogue de l'Epic Games Store.
 * Sert aux jeux Epic (correspondance exacte par « sandbox »/namespace) et, par titre exact, aux autres jeux.
 */
const baseUrl = 'https://api.egdata.app'
const cacheDurationMs = 6 * 60 * 60 * 1000

export interface EgDataOffer {
  id: string
  namespace: string
  title: string
  description: string | null
  offerType: string | null
  developer: string | null
  publisher: string | null
  releaseDate: string | null
  images: Array<{ type: string; url: string }>
}

type ImageKind = 'cover' | 'hero'

const imageTypes: Record<ImageKind, string[]> = {
  cover: ['DieselGameBoxTall', 'OfferImageTall', 'DieselStoreFrontTall', 'Thumbnail'],
  hero: ['DieselGameBox', 'DieselStoreFrontWide', 'OfferImageWide', 'featuredMedia'],
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isEpicImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && ['epicgames.com', 'unrealengine.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseEgDataOffer(entry: unknown): EgDataOffer | null {
  const offer = asRecord(entry)
  if (!offer || typeof offer.id !== 'string' || typeof offer.namespace !== 'string' || typeof offer.title !== 'string') return null
  const images = Array.isArray(offer.keyImages)
    ? offer.keyImages.flatMap((image) => {
      const record = asRecord(image)
      return record && typeof record.type === 'string' && isEpicImageUrl(record.url)
        ? [{ type: record.type, url: record.url }]
        : []
    })
    : []
  return {
    id: offer.id,
    namespace: offer.namespace,
    title: offer.title,
    description: text(offer.description),
    offerType: text(offer.offerType),
    developer: text(offer.developerDisplayName),
    publisher: text(offer.publisherDisplayName) ?? text(asRecord(offer.seller)?.name),
    releaseDate: text(offer.releaseDate),
    images,
  }
}

/** URLs d'images de l'offre, de la plus pertinente à la moins pertinente. */
export function egDataImages(offer: EgDataOffer, kind: ImageKind): string[] {
  return imageTypes[kind].flatMap((type) => offer.images.filter((image) => image.type === type).map((image) => image.url))
}

export interface EgDataMedia {
  images: string[]
  videos: Array<{ url: string; thumbnail: string | null; title: string }>
}

/** Captures d'écran déclarées dans les images clés de l'offre (type contenant « screenshot »). */
export function egDataScreenshots(offer: EgDataOffer): string[] {
  return offer.images.filter((image) => /screenshot/i.test(image.type)).map((image) => image.url)
}

function isTrustedVideoUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && ['epicgames.com', 'unrealengine.com', 'youtube.com', 'youtu.be'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export class EgDataClient {
  private readonly cache = new Map<string, { expiresAt: number; result: Promise<EgDataOffer[]> }>()

  clearCache(): void {
    this.cache.clear()
  }

  private list(pathAndQuery: string): Promise<EgDataOffer[]> {
    const cached = this.cache.get(pathAndQuery)
    if (cached && cached.expiresAt > Date.now()) return cached.result
    const result = (async () => {
      const response = await fetch(`${baseUrl}${pathAndQuery}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Nexora (bibliothèque de jeux locale)' },
        signal: AbortSignal.timeout(8_000),
      })
      if (response.status === 404 || response.status === 204) return []
      if (!response.ok) throw new Error(`egdata : requête impossible (HTTP ${response.status}).`)
      const payload = asRecord(await response.json())
      const elements = Array.isArray(payload?.elements) ? payload.elements : []
      return elements.flatMap((element) => {
        const offer = parseEgDataOffer(element)
        return offer ? [offer] : []
      })
    })()
    this.cache.set(pathAndQuery, { expiresAt: Date.now() + cacheDurationMs, result })
    result.catch(() => this.cache.delete(pathAndQuery))
    return result
  }

  /** Offres de jeu de base dont le titre correspond à la recherche (correction manuelle de la correspondance). */
  async search(query: string, limit = 8): Promise<EgDataOffer[]> {
    const cleaned = query.trim().slice(0, 120)
    if (!cleaned) return []
    const offers = await this.list(`/autocomplete?query=${encodeURIComponent(cleaned)}&limit=10`)
    return offers.filter((offer) => offer.offerType === 'BASE_GAME').slice(0, limit)
  }

  /** Offre choisie par l'utilisateur : lecture directe, sinon repli par recherche sur le titre mémorisé. */
  async getById(id: string, titleHint: string): Promise<EgDataOffer | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null
    try {
      const response = await fetch(`${baseUrl}/offers/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Nexora (bibliothèque de jeux locale)' },
        signal: AbortSignal.timeout(8_000),
      })
      if (response.ok) {
        const offer = parseEgDataOffer(await response.json())
        if (offer?.id === id) return offer
      }
    } catch {
      // repli par recherche ci-dessous
    }
    const cleaned = titleHint.trim().slice(0, 120)
    if (!cleaned) return null
    const offers = await this.list(`/autocomplete?query=${encodeURIComponent(cleaned)}&limit=10`)
    return offers.find((offer) => offer.id === id) ?? null
  }

  /**
   * Médias d'une offre (captures et vidéos). Lecture tolérante : le format exact de ce point d'accès n'est pas garanti,
   * toute entrée inattendue ou hébergée hors Epic / YouTube est ignorée.
   */
  async media(offerId: string): Promise<EgDataMedia> {
    const empty: EgDataMedia = { images: [], videos: [] }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(offerId)) return empty
    const response = await fetch(`${baseUrl}/offers/${encodeURIComponent(offerId)}/media`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Nexora (bibliothèque de jeux locale)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 404 || response.status === 204 || !response.ok) return empty
    const payload = asRecord(await response.json())
    const images = (Array.isArray(payload?.images) ? payload.images : []).flatMap((entry) => {
      const record = asRecord(entry)
      const url = typeof entry === 'string' ? entry : record?.src ?? record?.url
      return isEpicImageUrl(url) ? [url] : []
    })
    const videos = (Array.isArray(payload?.videos) ? payload.videos : []).flatMap((entry) => {
      const record = asRecord(entry)
      if (!record) return []
      const outputs = Array.isArray(record.outputs) ? record.outputs.map((output) => asRecord(output)?.url) : []
      const url = [record.url, record.src, record.video, ...outputs].find(isTrustedVideoUrl)
      if (!url) return []
      const thumbnail = [record.thumbnail, record.poster, record.image].find(isEpicImageUrl) ?? null
      return [{ url, thumbnail, title: text(record.title) ?? text(record.name) ?? 'Bande-annonce' }]
    })
    return { images: images.slice(0, 12), videos: videos.slice(0, 3) }
  }

  /** Jeu de base d'un namespace Epic (CatalogNamespace du manifeste local) : correspondance exacte. */
  async findBySandbox(namespace: string, title: string, sameTitle: (first: string, second: string) => boolean): Promise<EgDataOffer | null> {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(namespace)) return null
    const offers = await this.list(`/sandboxes/${encodeURIComponent(namespace)}/offers?limit=20&offerType=BASE_GAME`)
    const bases = offers.filter((offer) => offer.offerType === null || offer.offerType === 'BASE_GAME')
    return bases.find((offer) => sameTitle(offer.title, title)) ?? (bases.length === 1 ? bases[0] : null)
  }

  /** Offre de jeu de base dont le titre est identique (au sens de `sameTitle`) à celui recherché. */
  async findByTitle(title: string, sameTitle: (first: string, second: string) => boolean): Promise<EgDataOffer | null> {
    const cleaned = title.trim().slice(0, 120)
    if (!cleaned) return null
    const offers = await this.list(`/autocomplete?query=${encodeURIComponent(cleaned)}&limit=10`)
    return offers.find((offer) => offer.offerType === 'BASE_GAME' && sameTitle(offer.title, cleaned)) ?? null
  }
}
