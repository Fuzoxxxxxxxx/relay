import type { ArtworkKind, ArtworkPlatform } from '../shared/types'

/**
 * Cache mémoire côté interface : une même image (carte, bandeau, fiche) n'est demandée
 * qu'une seule fois au processus principal. Les échecs ne sont jamais mémorisés ici.
 */
const maxEntries = 160
const cache = new Map<string, Promise<string | null>>()

export function loadArtwork(
  platform: ArtworkPlatform,
  appId: string,
  title: string,
  kind: ArtworkKind,
): Promise<string | null> {
  const key = `${platform}:${appId}:${kind}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const pending = window.nexora.artwork.load(platform, appId, title, kind).then(
    (url) => {
      if (!url) cache.delete(key)
      return url
    },
    (error: unknown) => {
      cache.delete(key)
      throw error
    },
  )
  cache.set(key, pending)
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return pending
}

export function invalidateArtwork(platform: ArtworkPlatform, appId: string): void {
  const prefix = `${platform}:${appId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function clearArtworkCache(): void {
  cache.clear()
}
