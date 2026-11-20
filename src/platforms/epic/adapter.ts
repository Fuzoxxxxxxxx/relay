import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export interface EpicInstalledGame {
  appId: string
  title: string
  installPath: string
  launchExecutable: string | null
}

export interface EpicScanResult {
  detected: boolean
  complete: boolean
  games: EpicInstalledGame[]
  errors: string[]
}

export type EpicArtworkKind = 'cover' | 'hero' | 'icon'

interface EpicCatalogImage {
  type?: unknown
  url?: unknown
}

interface EpicCatalogRelease {
  appId?: unknown
}

interface EpicCatalogProduct {
  title?: unknown
  releaseInfo?: unknown
  keyImages?: unknown
}

interface EpicManifest {
  AppName?: unknown
  DisplayName?: unknown
  InstallLocation?: unknown
  LaunchExecutable?: unknown
  bIsIncompleteInstall?: unknown
  bIsApplication?: unknown
  bIsExecutable?: unknown
  TechnicalType?: unknown
  AppCategories?: unknown
}

let catalogCache: { modifiedAt: number; products: EpicCatalogProduct[] } | null = null

function normalizeTitle(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function readEpicCatalog(): Promise<EpicCatalogProduct[]> {
  const filePath = path.join(
    process.env.ProgramData ?? 'C:\\ProgramData',
    'Epic',
    'EpicGamesLauncher',
    'Data',
    'Catalog',
    'catcache.bin',
  )
  let fileInfo
  try {
    fileInfo = await stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (!fileInfo.isFile() || fileInfo.size > 8 * 1024 * 1024) return []
  if (catalogCache?.modifiedAt === fileInfo.mtimeMs) return catalogCache.products

  const encoded = await readFile(filePath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf8'))
  } catch (error) {
    console.error('Impossible de lire le cache de catalogue Epic.', error)
    return []
  }
  if (!Array.isArray(parsed)) return []
  const products = parsed.filter((item): item is EpicCatalogProduct =>
    typeof item === 'object' && item !== null && !Array.isArray(item),
  )
  catalogCache = { modifiedAt: fileInfo.mtimeMs, products }
  return products
}

export async function findEpicArtworkUrl(
  appId: string,
  title: string,
  kind: EpicArtworkKind,
): Promise<string | null> {
  const products = await readEpicCatalog()
  const normalizedTitle = normalizeTitle(title)
  const product = products.find((item) => {
    const releases = Array.isArray(item.releaseInfo) ? item.releaseInfo as EpicCatalogRelease[] : []
    const matchesAppId = releases.some((release) => release.appId === appId)
    return matchesAppId || (typeof item.title === 'string' && normalizeTitle(item.title) === normalizedTitle)
  })
  if (!product || !Array.isArray(product.keyImages)) return null

  const images = product.keyImages.filter((image): image is EpicCatalogImage =>
    typeof image === 'object' && image !== null && !Array.isArray(image),
  )
  const preferredTypes = kind === 'cover'
    ? ['DieselGameBoxTall', 'OfferImageTall', 'Thumbnail', 'Featured']
    : kind === 'hero'
      ? ['DieselGameBox', 'OfferImageWide', 'featuredMedia', 'Featured']
      : ['AndroidIcon', 'Thumbnail', 'DieselGameBoxTall', 'Featured']
  for (const preferredType of preferredTypes) {
    const candidate = images.find((image) => image.type === preferredType && typeof image.url === 'string')
    if (typeof candidate?.url !== 'string') continue
    try {
      const url = new URL(candidate.url)
      if (url.protocol === 'https:' && url.hostname === 'cdn1.epicgames.com') return url.href
    } catch {
      continue
    }
  }
  return null
}

export function parseEpicManifest(contents: string): EpicInstalledGame | null {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const manifest = value as EpicManifest
  const appId = manifest.AppName
  const title = manifest.DisplayName
  const installPath = manifest.InstallLocation
  const launchExecutable = manifest.LaunchExecutable
  if (manifest.bIsIncompleteInstall === true) return null
  if (typeof appId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(appId)) return null
  if (typeof title !== 'string' || !title.trim() || title.length > 200) return null
  if (typeof installPath !== 'string' || !path.isAbsolute(installPath)) return null
  if (typeof launchExecutable !== 'string') return null
  if (!manifest.bIsApplication && !manifest.bIsExecutable
    && !String(manifest.TechnicalType ?? '').toLowerCase().includes('games')
    && !(Array.isArray(manifest.AppCategories) && manifest.AppCategories.includes('games'))) return null

  const resolvedInstallPath = path.resolve(installPath)
  let resolvedExecutable: string | null = null
  if (launchExecutable.trim()) {
    if (path.isAbsolute(launchExecutable)) return null
    resolvedExecutable = path.resolve(resolvedInstallPath, launchExecutable)
    if (!resolvedExecutable.toLowerCase().startsWith(`${resolvedInstallPath.toLowerCase()}${path.sep.toLowerCase()}`)) return null
  }

  return {
    appId,
    title: title.trim(),
    installPath: resolvedInstallPath,
    launchExecutable: resolvedExecutable,
  }
}

async function manifestDirectory(): Promise<string | null> {
  const candidates = [
    path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'EpicGamesLauncher', 'Data', 'Manifests')
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return null
}

/** Namespace du catalogue Epic (CatalogNamespace) d'un jeu installé, lu dans son manifeste local. */
export async function readEpicNamespace(appId: string): Promise<string | null> {
  const directory = await manifestDirectory()
  if (!directory) return null
  let files: string[]
  try {
    files = await readdir(directory)
  } catch {
    return null
  }
  for (const file of files.filter((name) => /\.item$/i.test(name))) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as Record<string, unknown>
      const namespace = manifest.CatalogNamespace
      if (manifest.AppName === appId && typeof namespace === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(namespace)) {
        return namespace
      }
    } catch {
      continue
    }
  }
  return null
}

export async function scanEpicGames(): Promise<EpicScanResult> {
  const directory = await manifestDirectory()
  if (!directory) return { detected: false, complete: false, games: [], errors: [] }

  let files: string[]
  try {
    files = await readdir(directory)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Accès au dossier refusé.'
    return {
      detected: true,
      complete: false,
      games: [],
      errors: [`Les manifestes Epic sont illisibles : ${reason}`],
    }
  }

  const games: EpicInstalledGame[] = []
  const errors: string[] = []
  let complete = true
  for (const file of files.filter((name) => /\.item$/i.test(name))) {
    let contents: string
    try {
      contents = await readFile(path.join(directory, file), 'utf8')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Lecture impossible.'
      errors.push(`Manifeste Epic illisible (${file}) : ${reason}`)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      complete = false
      errors.push(`Manifeste Epic invalide (${file}) : le JSON est mal formé.`)
      continue
    }
    if (typeof parsed === 'object' && parsed !== null && 'bIsIncompleteInstall' in parsed
      && parsed.bIsIncompleteInstall === true) {
      complete = false
      continue
    }
    const game = parseEpicManifest(contents)
    if (!game) continue
    try {
      const [installInfo, executableInfo] = await Promise.all([
        stat(game.installPath),
        game.launchExecutable
          ? access(game.launchExecutable).then(() => true, (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
          })
          : Promise.resolve(true),
      ])
      if (installInfo.isDirectory() && executableInfo) games.push(game)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : 'Vérification impossible.'
        errors.push(`Installation Epic non vérifiable (${game.title}) : ${reason}`)
      }
    }
  }

  return { detected: true, complete: complete && errors.length === 0, games, errors }
}
