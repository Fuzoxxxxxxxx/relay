import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface RiotInstalledGame {
  appId: string
  title: string
  installPath: string
}

export interface RiotScanResult {
  detected: boolean
  complete: boolean
  games: RiotInstalledGame[]
  errors: string[]
}

interface RiotGameDefinition {
  title: string
  executable: string
}

const riotGames: Record<string, RiotGameDefinition> = {
  league_of_legends: { title: 'League of Legends', executable: 'LeagueClient.exe' },
  valorant: { title: 'VALORANT', executable: 'VALORANT.exe' },
  pft: { title: '2XKO', executable: '2XKO.exe' },
}

const riotArtwork: Record<string, string> = {
  league_of_legends: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/565197caf987af4e4da307df6e2b235a28714736-837x469.jpg?accountingTag=LoL&w=1200&h=630&fm=jpg&fit=crop&crop=center',
  pft: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/0d8da14d9cc0c69376e8fb42cc6344276bf937ad-1200x600.jpg?accountingTag=2XKO&w=1200&h=630&fm=jpg&fit=crop&crop=center',
}

export function findRiotArtworkUrl(appId: string): string | null {
  return riotArtwork[appId] ?? null
}

export function parseRiotInstallations(contents: string): RiotInstalledGame[] | null {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const associatedClients = 'associated_clients' in value
    ? value.associated_clients
    : 'associated_client' in value
      ? value.associated_client
      : undefined
  if (typeof associatedClients !== 'object' || associatedClients === null || Array.isArray(associatedClients)) return null

  if ('associated_client' in value && !('associated_clients' in value)) {
    return Object.entries(associatedClients).flatMap(([installPath, clientPath]) => {
      if (typeof clientPath !== 'string' || !path.isAbsolute(installPath) || !path.isAbsolute(clientPath)) return []
      if (path.basename(clientPath).toLocaleLowerCase('en') !== 'riotclientservices.exe') return []
      const pathSegments = path.resolve(installPath).split(path.sep).map((segment) => segment.toLocaleLowerCase('en'))
      const appId = Object.entries(riotGames).find(([id]) => {
        if (id === 'valorant') return pathSegments.includes('valorant')
        if (id === 'league_of_legends') return pathSegments.includes('league of legends')
        return pathSegments.includes('pft') || pathSegments.includes('2xko')
      })?.[0]
      if (!appId) return []
      return [{ appId, title: riotGames[appId].title, installPath: path.resolve(installPath) }]
    })
  }

  return Object.entries(riotGames).flatMap(([appId, definition]) => {
    const executable = (associatedClients as Record<string, unknown>)[appId]
    if (typeof executable !== 'string' || !path.isAbsolute(executable)) return []
    if (path.basename(executable).toLocaleLowerCase('en') !== definition.executable.toLocaleLowerCase('en')) return []
    return [{ appId, title: definition.title, installPath: path.dirname(path.resolve(executable)) }]
  })
}

function manifestPaths(): string[] {
  const candidates = [
    process.env.ProgramData
      ? path.join(process.env.ProgramData, 'Riot Games', 'RiotClientInstalls.json')
      : 'C:\\ProgramData\\Riot Games\\RiotClientInstalls.json',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Riot Games', 'Riot Client', 'Config', 'RiotClientInstalls.json')
      : null,
  ]
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))]
}

export async function scanRiotGames(): Promise<RiotScanResult> {
  let contents: string | null = null
  let manifestPath = ''
  for (const candidate of manifestPaths()) {
    try {
      await access(candidate)
      contents = await readFile(candidate, 'utf8')
      manifestPath = candidate
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      const reason = error instanceof Error ? error.message : 'Lecture impossible.'
      return {
        detected: true,
        complete: false,
        games: [],
        errors: [`Le manifeste Riot est illisible (${candidate}) : ${reason}`],
      }
    }
  }
  if (contents === null) return { detected: false, complete: false, games: [], errors: [] }

  const parsed = parseRiotInstallations(contents)
  if (!parsed) {
    return {
      detected: true,
      complete: false,
      games: [],
      errors: [`Le manifeste Riot est invalide (${manifestPath}) : format inattendu.`],
    }
  }

  const games: RiotInstalledGame[] = []
  for (const game of parsed) {
    const definition = riotGames[game.appId]
    const executablePath = path.join(game.installPath, definition.executable)
    try {
      await access(executablePath)
      games.push(game)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : 'Vérification impossible.'
        return {
          detected: true,
          complete: false,
          games,
          errors: [`Impossible de vérifier ${game.title} (${executablePath}) : ${reason}`],
        }
      }
    }
  }
  return { detected: true, complete: true, games, errors: [] }
}
