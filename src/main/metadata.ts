import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtworkPlatform, GameDetails, GameMatch, MatchCandidate } from '../shared/types'
import { igdbImageUrl } from '../platforms/igdb/adapter'
import type { IgdbClient, IgdbGameInfo } from '../platforms/igdb/adapter'
import { egDataImages, egDataScreenshots } from '../platforms/egdata/adapter'
import type { EgDataClient, EgDataMedia, EgDataOffer } from '../platforms/egdata/adapter'
import { clearSteamStoreCache, fetchSteamDetails, limitText, searchSteamStore } from './steamStore'
import type { SteamAppDetails, StoreArtwork } from './steamStore'

export type ManualMatch =
  | { source: 'steam' | 'igdb'; id: number }
  | { source: 'egdata'; id: string; title: string }

export interface IgdbImages {
  cover: string | null
  artworks: string[]
  screenshots: string[]
}

export type MediaSource = 'steam' | 'igdb' | 'egdata'

/** Captures et bandes-annonces de toutes les sources, déjà dédoublonnées (liens distants : téléchargés uniquement par le processus principal). */
export interface ResolvedMedia {
  screenshots: Array<{ source: MediaSource; thumb: string; full: string }>
  videos: Array<{ source: MediaSource; title: string; thumbnail: string | null; url: string }>
}

function buildMedia(steam: SteamAppDetails | null, igdb: IgdbGameInfo | null, egOffer: EgDataOffer | null, egMedia: EgDataMedia | null): ResolvedMedia {
  const screenshots: ResolvedMedia['screenshots'] = []
  const videos: ResolvedMedia['videos'] = []
  const seenImages = new Set<string>()
  const seenVideos = new Set<string>()
  const addImage = (source: MediaSource, thumb: string, full: string): void => {
    if (seenImages.has(full)) return
    seenImages.add(full)
    screenshots.push({ source, thumb, full })
  }
  const addVideo = (source: MediaSource, title: string, thumbnail: string | null, url: string): void => {
    if (seenVideos.has(url)) return
    seenVideos.add(url)
    videos.push({ source, title, thumbnail, url })
  }
  for (const shot of steam?.media?.screenshots ?? []) addImage('steam', shot.thumb, shot.full)
  for (const id of (igdb?.screenshotIds ?? []).slice(0, 8)) addImage('igdb', igdbImageUrl(id, 'screenshot_med'), igdbImageUrl(id, '1080p'))
  for (const url of [...(egOffer ? egDataScreenshots(egOffer) : []), ...(egMedia?.images ?? [])]) addImage('egdata', url, url)
  for (const video of steam?.media?.videos ?? []) addVideo('steam', video.title, video.thumbnail, video.url)
  for (const video of (igdb?.videos ?? []).slice(0, 3)) {
    addVideo('igdb', video.name, `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`, `https://www.youtube.com/watch?v=${video.videoId}`)
  }
  for (const video of egMedia?.videos ?? []) addVideo('egdata', video.title, video.thumbnail, video.url)
  return { screenshots: screenshots.slice(0, 20), videos: videos.slice(0, 6) }
}

export interface ResolvedGame {
  details: GameDetails
  igdbImages: IgdbImages | null
  egdataImages: { cover: string[]; hero: string[] } | null
  store: StoreArtwork | null
  media?: ResolvedMedia
  /** Source du choix manuel de l'utilisateur (la jaquette vue dans la liste de choix doit alors s'afficher en premier). */
  manualSource?: 'steam' | 'igdb' | 'egdata' | null
}

export interface MetadataDependencies {
  igdb: IgdbClient
  egdata: EgDataClient
  /** Lit le namespace Epic d'un jeu installé (manifeste local) ; absent hors Windows/Epic. */
  epicNamespace?: (appId: string) => Promise<string | null>
  /** Traduit un texte en français (renvoie le texte tel quel s'il l'est déjà, null si la traduction est impossible). */
  translate?: (text: string) => Promise<string | null>
}

function sameTitle(first: string, second: string): boolean {
  return canonicalTitle(first) === canonicalTitle(second)
}

function firstList(...lists: Array<string[] | undefined>): string[] {
  return lists.find((list) => list !== undefined && list.length > 0) ?? []
}

interface StoredEntry {
  version: 1
  override: ManualMatch | null
  resolvedAt: number
  degraded: boolean
  /** Révision de la logique de résolution : un résultat plus ancien est recalculé (le choix manuel est conservé). */
  revision?: number
  resolved: ResolvedGame | null
}

const metadataRevision = 5
const okTtlMs = 14 * 24 * 60 * 60 * 1000
const noneTtlMs = 12 * 60 * 60 * 1000
const degradedTtlMs = 10 * 60 * 1000
const maxThumbnailBytes = 400 * 1024

export function normalizeTitle(title: string): string {
  return title.replace(/[®™©]/g, '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase('en')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const editionSuffix = / (?:(?:deluxe|standard|ultimate|complete|definitive|premium|gold|special|enhanced|anniversary|goty|game of the year)(?: edition)?)+$/

/** Forme comparable : sans accents, sans « The » initial ni suffixe d'édition (Deluxe Edition, GOTY…). */
export function canonicalTitle(title: string): string {
  return normalizeTitle(title).replace(/^the /, '').replace(editionSuffix, '').trim()
}

export function searchTerms(title: string): string[] {
  const terms = [title.trim()]
  let shortened = title.trim()
  const technicalSuffix = /(?:[-_. ]?(?:win64|win32|windowsnoeditor|shipping|client|launcher|binaries|game))+$/i
  while (technicalSuffix.test(shortened)) {
    const next = shortened.replace(technicalSuffix, '').trim()
    if (!next || next === shortened) break
    terms.push(next)
    shortened = next
  }
  return [...new Set(terms.map((term) => term.slice(0, 120)).filter((term) => normalizeTitle(term)))].slice(0, 3)
}

/** Choisit un jeu IGDB uniquement si son nom (ou un nom alternatif) est identique au titre recherché. */
export function pickIgdbMatch(games: IgdbGameInfo[], title: string): IgdbGameInfo | null {
  const wanted = canonicalTitle(title)
  if (!wanted) return null
  const exact = normalizeTitle(title)
  const scored = games.flatMap((game) => {
    const names = [game.name, ...game.altNames]
    if (!names.some((name) => canonicalTitle(name) === wanted)) return []
    const isExact = names.some((name) => normalizeTitle(name) === exact)
    const score = (isExact ? 100 : 80) - (game.isDlcOrEdition ? 25 : 0) + Math.min(15, Math.log10(1 + game.popularity) * 5)
    return [{ game, score }]
  })
  scored.sort((first, second) => second.score - first.score)
  return scored[0]?.game ?? null
}

function formatUnixDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function formatIsoDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

async function fetchThumbnail(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!response.ok) return null
    const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.byteLength > 0 && bytes.byteLength <= maxThumbnailBytes
      ? `data:${contentType};base64,${bytes.toString('base64')}`
      : null
  } catch {
    return null
  }
}

export class GameMetadataService {
  private readonly cacheDirectory: () => Promise<string>
  private readonly igdb: IgdbClient
  private readonly egdata: EgDataClient
  private readonly epicNamespace: ((appId: string) => Promise<string | null>) | null
  private readonly running = new Map<string, Promise<ResolvedGame>>()
  private readonly translate: ((text: string) => Promise<string | null>) | null

  constructor(cacheDirectory: () => Promise<string>, dependencies: MetadataDependencies) {
    this.cacheDirectory = cacheDirectory
    this.igdb = dependencies.igdb
    this.egdata = dependencies.egdata
    this.epicNamespace = dependencies.epicNamespace ?? null
    this.translate = dependencies.translate ?? null
  }

  private async entryPath(platform: ArtworkPlatform, appId: string): Promise<string> {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(appId)) throw new Error('Identifiant de jeu invalide.')
    return path.join(await this.cacheDirectory(), 'meta', `${platform}-${appId}.json`)
  }

  private async readEntry(platform: ArtworkPlatform, appId: string): Promise<StoredEntry | null> {
    try {
      const entry = JSON.parse(await readFile(await this.entryPath(platform, appId), 'utf8')) as Partial<StoredEntry>
      return entry.version === 1 ? entry as StoredEntry : null
    } catch {
      return null
    }
  }

  private async writeEntry(platform: ArtworkPlatform, appId: string, entry: StoredEntry): Promise<void> {
    const filePath = await this.entryPath(platform, appId)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(entry))
  }

  async details(platform: ArtworkPlatform, appId: string, title: string): Promise<GameDetails> {
    return (await this.resolve(platform, appId, title)).details
  }

  resolve(platform: ArtworkPlatform, appId: string, title: string): Promise<ResolvedGame> {
    const key = `${platform}:${appId}`
    const running = this.running.get(key)
    if (running) return running
    const pending = this.resolveStored(platform, appId, title).finally(() => this.running.delete(key))
    this.running.set(key, pending)
    return pending
  }

  private async resolveStored(platform: ArtworkPlatform, appId: string, title: string): Promise<ResolvedGame> {
    const entry = await this.readEntry(platform, appId)
    if (entry?.resolved && entry.revision === metadataRevision) {
      const ttl = entry.degraded ? degradedTtlMs : entry.resolved.details.match.status === 'none' ? noneTtlMs : okTtlMs
      if (Date.now() - entry.resolvedAt < ttl) return entry.resolved
    }
    const override = entry?.override ?? null
    const { resolved, degraded } = await this.compute(platform, appId, title, override)
    await this.writeEntry(platform, appId, { version: 1, override, resolvedAt: Date.now(), degraded, revision: metadataRevision, resolved })
    return resolved
  }

  private async findSteamByTitle(title: string): Promise<string | null> {
    for (const term of searchTerms(title)) {
      const wanted = canonicalTitle(term)
      const items = (await searchSteamStore(term)).filter((item) => canonicalTitle(item.name) === wanted)
      for (const item of items.slice(0, 3)) {
        const details = await fetchSteamDetails(String(item.id))
        if (details?.type === 'game') return String(item.id)
      }
    }
    return null
  }

  private async compute(
    platform: ArtworkPlatform,
    appId: string,
    title: string,
    override: ManualMatch | null,
  ): Promise<{ resolved: ResolvedGame; degraded: boolean }> {
    let degraded = false
    const guard = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await operation()
      } catch {
        degraded = true
        return fallback
      }
    }

    let steamAppId: string | null = null
    let igdb: IgdbGameInfo | null = null
    let egOffer: EgDataOffer | null = null
    let status: GameMatch['status'] = 'none'
    let source: GameMatch['source'] = null

    if (override) {
      status = 'confirmed'
      source = 'manual'
      if (override.source === 'steam') {
        steamAppId = String(override.id)
      } else if (override.source === 'egdata') {
        const offerId = override.id
        const offerTitle = override.title
        egOffer = await guard(() => this.egdata.getById(offerId, offerTitle), null)
      } else {
        const igdbOverrideId = override.id
        igdb = await guard(() => this.igdb.getById(igdbOverrideId), null)
        const igdbId = igdb?.id
        if (igdbId !== undefined) steamAppId = await guard(() => this.igdb.steamAppIdOf(igdbId), null)
      }
    } else if (platform === 'steam') {
      steamAppId = appId
      status = 'confirmed'
      source = 'steam'
    } else {
      let lookupTitle = title
      const readNamespace = this.epicNamespace
      if (platform === 'epic' && readNamespace) {
        const namespace = await guard(() => readNamespace(appId), null)
        if (namespace) {
          egOffer = await guard(() => this.egdata.findBySandbox(namespace, title, sameTitle), null)
          if (egOffer) status = 'confirmed'
        }
      }
      // egdata : jeux Epic et Riot uniquement (jamais Steam ni jeux locaux).
      if (!egOffer && (platform === 'epic' || platform === 'riot')) {
        egOffer = await guard(() => this.egdata.findByTitle(title, sameTitle), null)
        if (egOffer) status = 'matched'
      }
      if (egOffer) {
        source = 'epic'
        lookupTitle = egOffer.title
      }
      // Epic : egdata seul. Riot et jeux locaux : IGDB puis Steam, par nom exact.
      if (platform !== 'epic') {
        for (const term of searchTerms(lookupTitle)) {
          igdb = pickIgdbMatch(await guard(() => this.igdb.search(term), []), term)
          if (igdb) break
        }
      }
      if (platform === 'epic') {
        // aucune autre source que egdata
      } else if (igdb) {
        if (status === 'none') {
          status = 'matched'
          source = 'igdb'
        }
        const igdbId = igdb.id
        steamAppId = await guard(() => this.igdb.steamAppIdOf(igdbId), null)
      } else {
        steamAppId = await guard(() => this.findSteamByTitle(lookupTitle), null)
        if (steamAppId && status === 'none') {
          status = 'matched'
          source = 'steam'
        }
      }
    }

    if (steamAppId && !igdb) {
      const knownSteamId = steamAppId
      igdb = await guard(() => this.igdb.findBySteamAppId(knownSteamId), null)
    }
    const steam = steamAppId ? await fetchSteamDetails(steamAppId) : null

    const igdbText = igdb ? limitText([igdb.summary, igdb.storyline].filter(Boolean).join('\n\n'), 2200) : ''
    const steamText = steam?.description ?? steam?.summary ?? null
    const epicText = egOffer?.description ?? null
    // egdata d'abord (Epic, Riot), puis Steam, puis IGDB. Seul un texte français est affiché : les autres sont traduits.
    const candidates: Array<{ source: 'steam' | 'igdb' | 'epic'; text: string | null; summary: string | null }> = [
      { source: 'epic', text: epicText, summary: null },
      { source: 'steam', text: steamText, summary: steam?.description ? steam.summary : null },
      { source: 'igdb', text: igdbText || null, summary: igdb?.summary ? limitText(igdb.summary, 320) : null },
    ]
    let translationFailed = false
    const toFrench = async (text: string): Promise<string | null> => {
      const french = this.translate ? await this.translate(text) : null
      if (french === null) {
        degraded = true
        translationFailed = true
      }
      return french
    }
    let description: string | null = null
    let summary: string | null = null
    let descriptionSource: GameDetails['descriptionSource'] = null
    for (const candidate of candidates) {
      if (!candidate.text) continue
      const french = await toFrench(candidate.text)
      if (!french) continue
      description = french
      summary = candidate.summary ? await toFrench(candidate.summary) : null
      descriptionSource = candidate.source
      break
    }
    const details: GameDetails = {
      summary,
      description,
      descriptionSource,
      translationUnavailable: description === null && translationFailed,
      genres: firstList(steam?.genres, igdb?.genres),
      developers: firstList(steam?.developers, igdb?.developers, egOffer?.developer ? [egOffer.developer] : undefined),
      publishers: firstList(steam?.publishers, igdb?.publishers, egOffer?.publisher ? [egOffer.publisher] : undefined),
      releaseDate: steam?.releaseDate ?? (igdb?.firstRelease ? formatUnixDate(igdb.firstRelease) : formatIsoDate(egOffer?.releaseDate ?? null)),
      match: {
        status,
        source,
        name: steam?.name || igdb?.name || egOffer?.title || null,
        steamAppId,
        igdbId: igdb?.id ?? null,
      },
    }
    // Les médias egdata sont facultatifs : une erreur ici ne rend pas la fiche « dégradée ».
    const egOfferId = egOffer?.id
    const egMedia = egOfferId ? await this.egdata.media(egOfferId).catch(() => null) : null
    return {
      degraded,
      resolved: {
        details,
        igdbImages: igdb ? { cover: igdb.coverId, artworks: igdb.artworkIds, screenshots: igdb.screenshotIds } : null,
        egdataImages: egOffer ? { cover: egDataImages(egOffer, 'cover'), hero: egDataImages(egOffer, 'hero') } : null,
        store: steam?.artwork ?? null,
        manualSource: override?.source ?? null,
        media: buildMedia(steam, igdb, egOffer, egMedia),
      },
    }
  }

  /** Candidats pour la correction manuelle, avec miniatures déjà téléchargées (la CSP interdit les images distantes). */
  async searchCandidates(query: string, platform: ArtworkPlatform): Promise<MatchCandidate[]> {
    const cleaned = query.trim().slice(0, 120)
    if (!cleaned) return []
    // egdata n'est proposé que pour les jeux Epic et Riot.
    const withEgData = platform === 'epic' || platform === 'riot'
    const [igdbResult, steamResult, egResult] = await Promise.allSettled([
      this.igdb.search(cleaned, 8),
      searchSteamStore(cleaned),
      withEgData ? this.egdata.search(cleaned) : Promise.resolve([] as EgDataOffer[]),
    ])
    if (igdbResult.status === 'rejected' && steamResult.status === 'rejected' && egResult.status === 'rejected') throw igdbResult.reason
    const raw: Array<{ candidate: MatchCandidate; thumbnailUrl: string | null }> = []
    if (egResult.status === 'fulfilled') {
      for (const offer of egResult.value) {
        const released = offer.releaseDate ? new Date(offer.releaseDate).getUTCFullYear() : null
        raw.push({
          candidate: {
            source: 'egdata',
            id: offer.id,
            name: offer.title,
            year: released !== null && Number.isFinite(released) ? released : null,
            thumbnail: null,
          },
          thumbnailUrl: egDataImages(offer, 'cover')[0] ?? null,
        })
      }
    }
    if (igdbResult.status === 'fulfilled') {
      for (const game of igdbResult.value.slice(0, 8)) {
        raw.push({
          candidate: {
            source: 'igdb',
            id: game.id,
            name: game.name,
            year: game.firstRelease ? new Date(game.firstRelease * 1000).getUTCFullYear() : null,
            thumbnail: null,
          },
          thumbnailUrl: game.coverId ? igdbImageUrl(game.coverId, 'cover_small') : null,
        })
      }
    }
    if (steamResult.status === 'fulfilled') {
      for (const item of steamResult.value.slice(0, 8)) {
        raw.push({
          candidate: { source: 'steam', id: item.id, name: item.name, year: null, thumbnail: null },
          thumbnailUrl: item.thumbnail ?? `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/capsule_sm_120.jpg`,
        })
      }
    }
    const thumbnails = await Promise.all(raw.map((entry) => fetchThumbnail(entry.thumbnailUrl)))
    return raw.map((entry, index) => ({ ...entry.candidate, thumbnail: thumbnails[index] }))
  }

  /** Mémorise le choix de l'utilisateur (`null` pour revenir à la détection automatique). */
  async setOverride(platform: ArtworkPlatform, appId: string, override: ManualMatch | null): Promise<void> {
    await this.writeEntry(platform, appId, {
      version: 1,
      override,
      resolvedAt: 0,
      degraded: false,
      resolved: null,
    })
  }

  /** Oublie le résultat calculé, mais conserve un éventuel choix manuel. */
  async invalidate(platform: ArtworkPlatform, appId: string): Promise<void> {
    const entry = await this.readEntry(platform, appId)
    if (entry?.override) {
      await this.setOverride(platform, appId, entry.override)
    } else {
      await rm(await this.entryPath(platform, appId), { force: true })
    }
    clearSteamStoreCache(appId)
  }

  /** Rend immédiatement recalculables les entrées dégradées (ex. description non traduite faute de clé DeepL). */
  async expireDegraded(): Promise<void> {
    const directory = path.join(await this.cacheDirectory(), 'meta')
    let names: string[]
    try {
      names = await readdir(directory)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const file = path.join(directory, name)
        const entry = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredEntry>
        if (entry.version === 1 && entry.degraded) await writeFile(file, JSON.stringify({ ...entry, resolvedAt: 0 }))
      } catch {
        // entrée illisible : ignorée
      }
    }
  }

  resetLookups(): void {
    this.igdb.clearCache()
    this.egdata.clearCache()
    clearSteamStoreCache()
  }
}
