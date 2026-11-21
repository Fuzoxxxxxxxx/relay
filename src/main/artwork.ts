import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtworkKind, ArtworkPlatform, CustomArtworkKind } from '../shared/types'
import { findEpicArtworkUrl } from '../platforms/epic/adapter'
import { findRiotArtworkUrl } from '../platforms/riot/adapter'
import { igdbImageUrl } from '../platforms/igdb/adapter'
import type { SteamGridDbClient } from '../platforms/steamgriddb/adapter'
import { canonicalTitle } from './metadata'
import type { GameMetadataService, ResolvedGame } from './metadata'
import { steamFallbackImages, steamLibraryImages } from './steamStore'

type ImageKind = 'cover' | 'hero'

const allowedKinds: ArtworkKind[] = ['cover', 'hero', 'icon']
const active = new Map<string, Promise<string | null>>()
const unavailableArtwork = new Map<string, number>()
let runningDownloads = 0
const downloadQueue: Array<() => void> = []
const maxConcurrentDownloads = 3
const maxImageBytes = 8 * 1024 * 1024
const unavailableArtworkCacheMs = 10 * 60 * 1000
/** Incrémenté quand la logique de correspondance change : les anciennes images (parfois erronées) sont ignorées. */
const fileRevision = 'v3'

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.byteLength - 2] === 0xff
    && bytes[bytes.byteLength - 1] === 0xd9
}

export function imageMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (isJpeg(bytes)) return 'image/jpeg'
  if (bytes.byteLength >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.byteLength >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

export async function withDownloadSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (runningDownloads >= maxConcurrentDownloads) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve))
  }
  runningDownloads += 1
  try {
    return await operation()
  } finally {
    runningDownloads -= 1
    downloadQueue.shift()?.()
  }
}

function igdbCandidates(resolved: ResolvedGame, kind: ImageKind): string[] {
  const images = resolved.igdbImages
  if (!images) return []
  if (kind === 'cover') {
    return images.cover ? [igdbImageUrl(images.cover, 'cover_big_2x'), igdbImageUrl(images.cover, 'cover_big')] : []
  }
  return [
    ...images.artworks.slice(0, 2).map((id) => igdbImageUrl(id, '1080p')),
    ...images.screenshots.slice(0, 2).map((id) => igdbImageUrl(id, '1080p')),
  ]
}

interface ArtworkDependencies {
  metadata: GameMetadataService
  steamGridDb?: SteamGridDbClient | null
}

export class GameArtworkService {
  private readonly cacheDirectory: () => Promise<string>
  private readonly metadata: GameMetadataService
  private readonly steamGridDb: SteamGridDbClient | null
  private legacyPurge: Promise<void> | null = null

  constructor(cacheDirectory: () => Promise<string>, dependencies: ArtworkDependencies) {
    this.cacheDirectory = cacheDirectory
    this.metadata = dependencies.metadata
    this.steamGridDb = dependencies.steamGridDb ?? null
  }

  private fileKind(kind: ArtworkKind): ImageKind {
    return kind === 'hero' ? 'hero' : 'cover'
  }

  private async artworkPath(platform: ArtworkPlatform, appId: string, kind: ArtworkKind): Promise<string> {
    return path.join(await this.cacheDirectory(), `${platform}-${appId}-${this.fileKind(kind)}-${fileRevision}.jpg`)
  }

  /** Supprime une seule fois les images des anciennes versions de Relay. */
  private purgeLegacyFiles(): Promise<void> {
    this.legacyPurge ??= (async () => {
      try {
        const directory = await this.cacheDirectory()
        const legacy = /^(?:steam|epic|riot|local)-[A-Za-z0-9._-]+-(?:cover|hero|icon)(?:-v2)?\.jpg$/
        for (const name of await readdir(directory)) {
          if (legacy.test(name)) await rm(path.join(directory, name), { force: true })
        }
      } catch {
        // Dossier absent ou inaccessible : rien à nettoyer.
      }
    })()
    return this.legacyPurge
  }

  private async localUrl(platform: ArtworkPlatform, appId: string, kind: ArtworkKind): Promise<string | null> {
    const filePath = await this.artworkPath(platform, appId, kind)
    const bytes = await readFile(filePath)
    const mimeType = imageMimeType(bytes)
    if (bytes.byteLength > maxImageBytes || !mimeType) {
      await rm(filePath, { force: true })
      return null
    }
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  }

  async get(platform: ArtworkPlatform, appId: string, title: string, kind: ArtworkKind): Promise<string | null> {
    this.validate(platform, appId, title, kind)
    await this.purgeLegacyFiles()
    const custom = await this.readCustom(platform, appId, kind)
    if (custom) return custom
    const filePath = await this.artworkPath(platform, appId, kind)
    try {
      await stat(filePath)
      const cachedUrl = await this.localUrl(platform, appId, kind)
      if (cachedUrl) return cachedUrl
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const imageKind = this.fileKind(kind)
    const key = `${platform}:${appId}:${imageKind}`
    const unavailableUntil = unavailableArtwork.get(key)
    if (unavailableUntil && unavailableUntil > Date.now()) return null
    unavailableArtwork.delete(key)
    const existing = active.get(key)
    if (existing) return existing.then((result) => result ? this.localUrl(platform, appId, kind) : null)
    const pending = this.download(platform, appId, title, imageKind, filePath)
    active.set(key, pending)
    try {
      const downloaded = await pending
      if (downloaded) {
        await rm(`${filePath}.stale`, { force: true })
        return this.localUrl(platform, appId, kind)
      }
      // Aucune source n'a répondu : on rétablit l'image précédente (mise de côté par refresh) plutôt que de n'en afficher aucune.
      const restored = await rename(`${filePath}.stale`, filePath).then(() => true, () => false)
      if (restored) return this.localUrl(platform, appId, kind)
      unavailableArtwork.set(key, Date.now() + unavailableArtworkCacheMs)
      return null
    } finally {
      active.delete(key)
    }
  }

  /**
   * Oublie le résultat de correspondance et force un nouveau téléchargement des images automatiques d'un jeu
   * (un choix manuel est conservé). L'ancienne image n'est supprimée qu'une fois la nouvelle téléchargée.
   */
  async refresh(platform: ArtworkPlatform, appId: string, title: string, discardPrevious = false): Promise<void> {
    this.validate(platform, appId, title, 'cover')
    await Promise.all((['cover', 'hero'] as const).map(async (kind) => {
      const filePath = await this.artworkPath(platform, appId, kind)
      await rm(`${filePath}.stale`, { force: true })
      // Changement de correspondance : l'ancienne image appartient à un autre jeu, elle n'est jamais rétablie.
      if (discardPrevious) await rm(filePath, { force: true })
      else await rename(filePath, `${filePath}.stale`).catch(() => undefined)
    }))
    await this.metadata.invalidate(platform, appId)
    // Sans cela, les caches mémoire d'egdata et d'IGDB (6 h) renverraient les mêmes URL, donc l'ancienne image.
    this.metadata.resetLookups()
    this.steamGridDb?.clearCache()
    for (const kind of ['cover', 'hero'] as const) unavailableArtwork.delete(`${platform}:${appId}:${kind}`)
  }

  resetLookupCache(...platforms: ArtworkPlatform[]): void {
    for (const platform of platforms) {
      for (const key of unavailableArtwork.keys()) {
        if (key.startsWith(`${platform}:`)) unavailableArtwork.delete(key)
      }
    }
    this.metadata.resetLookups()
    this.steamGridDb?.clearCache()
  }

  private async customPath(platform: ArtworkPlatform, appId: string, kind: CustomArtworkKind): Promise<string> {
    return path.join(await this.cacheDirectory(), `${platform}-${appId}-${kind}-custom.jpg`)
  }

  /** Les images choisies par l'utilisateur priment sur toute source automatique ; l'icône réutilise la jaquette. */
  private async readCustom(platform: ArtworkPlatform, appId: string, kind: ArtworkKind): Promise<string | null> {
    const filePath = await this.customPath(platform, appId, this.fileKind(kind))
    let bytes: Buffer
    try {
      bytes = await readFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const mimeType = imageMimeType(bytes)
    if (bytes.byteLength > maxImageBytes || !mimeType) {
      await rm(filePath, { force: true })
      return null
    }
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  }

  async setCustom(platform: ArtworkPlatform, appId: string, kind: CustomArtworkKind, sourcePath: string): Promise<void> {
    this.validate(platform, appId, 'Illustration personnalisée', kind)
    const info = await stat(sourcePath)
    if (!info.isFile() || info.size > maxImageBytes) throw new Error('L’image doit être un fichier de 8 Mo maximum.')
    const bytes = await readFile(sourcePath)
    if (!imageMimeType(bytes)) throw new Error('Format d’image non pris en charge (JPEG, PNG ou WebP).')
    const target = await this.customPath(platform, appId, kind)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  async clearCustom(platform: ArtworkPlatform, appId: string): Promise<void> {
    this.validate(platform, appId, 'Illustration personnalisée', 'cover')
    await Promise.all((['cover', 'hero'] as const).map(async (kind) =>
      rm(await this.customPath(platform, appId, kind), { force: true })))
  }

  private validate(platform: ArtworkPlatform, appId: string, title: string, kind: ArtworkKind): void {
    if (platform === 'steam' && !/^\d+$/.test(appId)) throw new Error('Identifiant Steam invalide.')
    if (platform === 'epic' && !/^[A-Za-z0-9._-]{1,128}$/.test(appId)) throw new Error('Identifiant Epic invalide.')
    if (platform === 'riot' && !['league_of_legends', 'valorant', 'pft'].includes(appId)) throw new Error('Identifiant Riot invalide.')
    if (platform === 'local' && !/^[a-f0-9]{64}$/.test(appId)) throw new Error('Identifiant de jeu local invalide.')
    if (!title.trim() || title.length > 200) throw new Error('Titre de jeu invalide.')
    if (!allowedKinds.includes(kind)) throw new Error('Type d’illustration non autorisé.')
  }

  private async downloadCandidates(candidates: string[], filePath: string): Promise<string | null> {
    return withDownloadSlot(async () => {
      await mkdir(path.dirname(filePath), { recursive: true })
      for (const candidate of new Set(candidates)) {
        try {
          const response = await fetch(candidate, { signal: AbortSignal.timeout(8_000) })
          if (!response.ok) continue
          const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
          const contentLength = Number(response.headers.get('content-length') ?? 0)
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || contentLength > maxImageBytes) continue
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength > maxImageBytes || imageMimeType(bytes) !== contentType) continue
          const temporaryPath = `${filePath}.${process.pid}.tmp`
          await writeFile(temporaryPath, bytes)
          await rename(temporaryPath, filePath)
          return filePath
        } catch {
          continue
        }
      }
      return null
    })
  }

  /** Images SteamGridDB (clé requise) : uniquement si le jeu est identifié avec certitude. */
  private async steamGridDbImages(resolved: ResolvedGame, title: string, kind: ImageKind): Promise<string[]> {
    const client = this.steamGridDb
    if (!client || !(await client.isConfigured())) return []
    const { steamAppId, name } = resolved.details.match
    let game = steamAppId ? await client.findBySteamAppId(steamAppId) : null
    if (!game) {
      const wanted = canonicalTitle(name ?? title)
      const matches = (await client.search(name ?? title)).filter((candidate) => canonicalTitle(candidate.name) === wanted)
      game = matches.find((candidate) => candidate.verified) ?? matches[0] ?? null
    }
    return game ? client.listImages(game.id, kind) : []
  }

  /**
   * Chaque plateforme a ses propres sources, essayées dans l'ordre (la suivante n'est interrogée que si la
   * précédente ne donne aucune image) :
   * - Epic : egdata uniquement (+ catalogue Epic local), les autres catalogues seulement après un choix manuel ;
   * - Riot : visuel officiel du launcher, puis egdata, puis Steam / SteamGridDB / IGDB ;
   * - Steam et jeux locaux : visuels Steam, SteamGridDB, IGDB, repli Steam (jamais egdata).
   */
  private async download(
    platform: ArtworkPlatform,
    appId: string,
    title: string,
    kind: ImageKind,
    filePath: string,
  ): Promise<string | null> {
    let pendingResolution: Promise<ResolvedGame> | null = null
    const resolved = () => (pendingResolution ??= this.metadata.resolve(platform, appId, title))
    const steamId = async () => platform === 'steam' ? appId : (await resolved()).details.match.steamAppId

    const sources: Array<() => Promise<string[]>> = []
    // Un choix manuel de correspondance prime sur les sources propres à la plateforme (visuel Riot, egdata, catalogue Epic) :
    // sinon elles renverraient toujours l'image du jeu d'origine.
    const isManual = async () => (await resolved()).details.match.source === 'manual'
    const native = async (lookup: () => Promise<string[]>): Promise<string[]> => (await isManual()) ? [] : lookup()
    // Choix manuel (IGDB ou egdata) : l'image vue dans la liste de choix s'affiche en premier.
    // (Une correspondance Steam n'est pas corrigeable à la main : aucune résolution inutile pour ces jeux.)
    if (platform !== 'steam') {
      sources.push(async () => {
        const game = await resolved()
        if (game.manualSource === 'igdb') return igdbCandidates(game, kind)
        if (game.manualSource === 'egdata') return game.egdataImages?.[kind] ?? []
        return []
      })
    }
    if (platform === 'riot') {
      sources.push(() => native(async () => {
        const url = findRiotArtworkUrl(appId)
        return url ? [url] : []
      }))
    }
    const egdata = async () => (await resolved()).egdataImages?.[kind] ?? []
    if (platform === 'epic') {
      sources.push(() => native(egdata))
      sources.push(() => native(async () => {
        const url = await findEpicArtworkUrl(appId, title, kind)
        return url ? [url] : []
      }))
    } else if (platform === 'riot') {
      sources.push(() => native(egdata))
    }
    // Pour Epic, les autres catalogues ne servent qu'après un choix manuel de l'utilisateur.
    const catalog = async (lookup: () => Promise<string[]>): Promise<string[]> =>
      platform === 'epic' && !(await isManual()) ? [] : lookup()
    sources.push(() => catalog(async () => {
      const id = await steamId()
      return id ? steamLibraryImages(id, kind) : []
    }))
    sources.push(() => catalog(async () => this.steamGridDbImages(await resolved(), title, kind)))
    sources.push(() => catalog(async () => igdbCandidates(await resolved(), kind)))
    sources.push(() => catalog(async () => {
      const id = await steamId()
      return id ? steamFallbackImages(id, (await resolved()).store, kind) : []
    }))

    for (const source of sources) {
      let urls: string[] = []
      try {
        urls = await source()
      } catch {
        urls = []
      }
      if (urls.length === 0) continue
      const downloaded = await this.downloadCandidates(urls, filePath)
      if (downloaded) return downloaded
    }
    return null
  }
}
