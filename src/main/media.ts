import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtworkPlatform, GameMedia } from '../shared/types'
import { imageMimeType, withDownloadSlot } from './artwork'
import type { GameMetadataService, ResolvedMedia } from './metadata'

/**
 * Captures d'écran et bandes-annonces d'un jeu. La CSP de l'interface interdit les images distantes : le processus
 * principal télécharge les images (miniature ou taille réelle), les garde sur disque et renvoie des data URL.
 * Les vidéos s'ouvrent dans le navigateur par défaut, uniquement vers des hôtes connus.
 */

const maxThumbBytes = 3 * 1024 * 1024
const maxFullBytes = 12 * 1024 * 1024
const imageHosts = ['steamstatic.com', 'igdb.com', 'youtube.com', 'ytimg.com', 'epicgames.com', 'unrealengine.com']
const videoHosts = ['youtube.com', 'youtu.be', 'steamstatic.com', 'epicgames.com', 'unrealengine.com']

function hostAllowed(value: string, hosts: string[]): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

function idOf(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16)
}

export type MediaImageSize = 'thumb' | 'full'

export class GameMediaService {
  private readonly cacheDirectory: () => Promise<string>
  private readonly metadata: GameMetadataService

  constructor(cacheDirectory: () => Promise<string>, metadata: GameMetadataService) {
    this.cacheDirectory = cacheDirectory
    this.metadata = metadata
  }

  private async media(platform: ArtworkPlatform, appId: string, title: string): Promise<ResolvedMedia> {
    return (await this.metadata.resolve(platform, appId, title)).media ?? { screenshots: [], videos: [] }
  }

  async list(platform: ArtworkPlatform, appId: string, title: string): Promise<GameMedia> {
    const media = await this.media(platform, appId, title)
    return {
      screenshots: media.screenshots.map((shot) => ({ id: idOf(shot.full), source: shot.source })),
      videos: media.videos.map((video) => ({ id: idOf(video.url), source: video.source, title: video.title })),
    }
  }

  /** Image (capture ou miniature de vidéo) sous forme de data URL, téléchargée une seule fois puis lue depuis le disque. */
  async image(platform: ArtworkPlatform, appId: string, title: string, id: string, size: MediaImageSize): Promise<string | null> {
    if (!/^[a-f0-9]{16}$/.test(id) || !/^[A-Za-z0-9._-]{1,128}$/.test(appId)) return null
    const media = await this.media(platform, appId, title)
    const shot = media.screenshots.find((entry) => idOf(entry.full) === id)
    const video = shot ? undefined : media.videos.find((entry) => idOf(entry.url) === id)
    const url = shot ? (size === 'thumb' ? shot.thumb : shot.full) : video?.thumbnail ?? null
    if (!url || !hostAllowed(url, imageHosts)) return null

    const file = path.join(await this.cacheDirectory(), 'media', `${platform}-${appId}-${id}-${size}.bin`)
    try {
      const cached = new Uint8Array(await readFile(file))
      const mime = imageMimeType(cached)
      if (mime) return `data:${mime};base64,${Buffer.from(cached).toString('base64')}`
    } catch {
      // pas encore en cache
    }

    const limit = size === 'thumb' ? maxThumbBytes : maxFullBytes
    const bytes = await withDownloadSlot(async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
        if (!response.ok) return null
        const data = new Uint8Array(await response.arrayBuffer())
        return data.byteLength > 0 && data.byteLength <= limit ? data : null
      } catch {
        return null
      }
    })
    if (!bytes) return null
    const mime = imageMimeType(bytes)
    if (!mime) return null
    try {
      await mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, bytes)
      await rename(temporary, file)
    } catch {
      // le cache disque est facultatif
    }
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  }

  /** Lien de la vidéo à ouvrir dans le navigateur (hôte vérifié), ou null si elle est introuvable. */
  async videoUrl(platform: ArtworkPlatform, appId: string, title: string, id: string): Promise<string | null> {
    if (!/^[a-f0-9]{16}$/.test(id)) return null
    const media = await this.media(platform, appId, title)
    const video = media.videos.find((entry) => idOf(entry.url) === id)
    return video && hostAllowed(video.url, videoHosts) ? video.url : null
  }
}
