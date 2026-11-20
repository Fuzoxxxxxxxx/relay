import { execFile } from 'node:child_process'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { PlatformStatus } from '../../shared/types'
import { parseSteamLibraryFolders, parseSteamManifest } from './manifest'
import type { SteamInstalledGame } from './manifest'

export { parseSteamLibraryFolders, parseSteamManifest } from './manifest'
export type { SteamInstalledGame } from './manifest'

const execFileAsync = promisify(execFile)
const steamLabel = 'Steam'

export interface SteamLibrary {
  root: string
  games: SteamInstalledGame[]
  complete: boolean
  error?: string
}

async function registrySteamPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync('reg.exe', [
      'query',
      'HKCU\\Software\\Valve\\Steam',
      '/v',
      'SteamPath',
    ], { windowsHide: true, timeout: 2500 })
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
    return match?.[1]?.trim().replace(/\//g, path.sep) ?? null
  } catch {
    return null
  }
}

export async function findSteamRoot(): Promise<string | null> {
  const candidates = [
    await registrySteamPath(),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
    path.join(app.getPath('home'), 'Steam'),
    path.join(app.getPath('home'), '.steam', 'steam'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'steamapps', 'libraryfolders.vdf'))
      return path.resolve(candidate)
    } catch {
      continue
    }
  }
  return null
}

export async function scanSteamLibraries(): Promise<SteamLibrary[]> {
  const root = await findSteamRoot()
  if (!root) return []

  const foldersFile = path.join(root, 'steamapps', 'libraryfolders.vdf')
  const foldersContents = await readFile(foldersFile, 'utf8')
  const roots = parseSteamLibraryFolders(foldersContents, root)
  const libraries: SteamLibrary[] = []

  for (const libraryRoot of roots) {
    const steamApps = path.join(libraryRoot, 'steamapps')
    let files: string[]
    try {
      files = await readdir(steamApps)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Accès au dossier refusé.'
      libraries.push({
        root: libraryRoot,
        games: [],
        complete: false,
        error: `Bibliothèque Steam inaccessible (${libraryRoot}) : ${reason}`,
      })
      continue
    }

    const manifests = files.filter((file) => /^appmanifest_\d+\.acf$/i.test(file))
    const games: SteamInstalledGame[] = []
    for (const manifest of manifests) {
      const contents = await readFile(path.join(steamApps, manifest), 'utf8')
      const game = parseSteamManifest(contents, libraryRoot)
      if (game) {
        if (game.appId === '228980' || game.title.toLocaleLowerCase('en') === 'steamworks common redistributables') continue
        const installPathInfo = await stat(game.installPath).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (installPathInfo?.isDirectory()) games.push(game)
      }
    }
    libraries.push({ root: libraryRoot, games, complete: true })
  }

  return libraries
}

export async function getOwnedSteamGames(apiKey: string, steamId: string): Promise<Array<{ appId: string; title: string }>> {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('steamid', steamId)
  url.searchParams.set('include_appinfo', 'true')
  url.searchParams.set('include_played_free_games', 'true')
  url.searchParams.set('format', 'json')

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Steam Web API a répondu HTTP ${response.status}.`)
  const result: unknown = await response.json()
  const resultObject = typeof result === 'object' && result !== null ? result as Record<string, unknown> : undefined
  const responseValue = resultObject?.response
  const responseObject = typeof responseValue === 'object' && responseValue !== null
    ? responseValue as Record<string, unknown>
    : undefined
  const games = responseObject?.games
  if (!Array.isArray(games) && Number(responseObject?.game_count) > 0) {
    throw new Error('Steam n’a pas retourné la liste des jeux. Vérifiez la visibilité du profil et les identifiants API.')
  }

  return (Array.isArray(games) ? games : []).flatMap((item) => {
    const game = typeof item === 'object' && item !== null ? item as Record<string, unknown> : undefined
    const appId = game?.appid
    const title = game?.name
    return typeof appId === 'number' && typeof title === 'string' && title.trim()
      ? [{ appId: String(appId), title: title.trim() }]
      : []
  })
}

export function steamPlatformStatus(detected: boolean, installedGames: number, note: string): PlatformStatus {
  return { id: 'steam', label: steamLabel, detected, installedGames, note }
}
