import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findRiotArtworkUrl, parseRiotInstallations, scanRiotGames } from './adapter'

let temporaryDirectory = ''

afterEach(() => {
  vi.unstubAllEnvs()
  if (temporaryDirectory) {
    return rm(temporaryDirectory, { recursive: true, force: true }).then(() => {
      temporaryDirectory = ''
    })
  }
  return undefined
})

describe('Riot installation manifest', () => {
  it('returns Riot-hosted artwork for games that use remote covers', () => {
    for (const appId of ['league_of_legends', 'pft']) {
      expect(findRiotArtworkUrl(appId)).toMatch(/^https:\/\/cmsassets\.rgpub\.io\//)
    }
    expect(findRiotArtworkUrl('valorant')).toBeNull()
    expect(findRiotArtworkUrl('unknown')).toBeNull()
  })

  it('parses supported game IDs and ignores unrelated or unexpected executable paths', () => {
    expect(parseRiotInstallations(JSON.stringify({
      associated_clients: {
        league_of_legends: 'C:\\Riot Games\\League of Legends\\LeagueClient.exe',
        valorant: 'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe',
        pft: 'C:\\Riot Games\\2XKO\\2XKO.exe',
        unknown_game: 'C:\\Games\\Unknown\\Unknown.exe',
        valorant_bad: 'C:\\Games\\VALORANT.exe',
      },
    }))).toEqual([
      {
        appId: 'league_of_legends',
        title: 'League of Legends',
        installPath: 'C:\\Riot Games\\League of Legends',
      },
      {
        appId: 'valorant',
        title: 'VALORANT',
        installPath: 'C:\\Riot Games\\VALORANT\\live',
      },
      {
        appId: 'pft',
        title: '2XKO',
        installPath: 'C:\\Riot Games\\2XKO',
      },
    ])
  })

  it('rejects malformed manifests', () => {
    expect(parseRiotInstallations('{invalid')).toBeNull()
    expect(parseRiotInstallations(JSON.stringify({ associated_clients: [] }))).toBeNull()
    expect(parseRiotInstallations(JSON.stringify({}))).toBeNull()
  })

  it('supports the Riot Client manifest format with install folders as keys', () => {
    expect(parseRiotInstallations(JSON.stringify({
      associated_client: {
        'C:/Riot Games/VALORANT/live/': 'C:/Riot Games/Riot Client/RiotClientServices.exe',
      },
    }))).toEqual([
      {
        appId: 'valorant',
        title: 'VALORANT',
        installPath: 'C:\\Riot Games\\VALORANT\\live',
      },
    ])
  })

  it('reports Riot as absent when no installation manifest exists', async () => {
    vi.stubEnv('ProgramData', 'Z:\\nexora-missing-riot')
    vi.stubEnv('LOCALAPPDATA', '')
    await expect(scanRiotGames()).resolves.toEqual({
      detected: false,
      complete: false,
      games: [],
      errors: [],
    })
  })

  it('imports only games whose declared executable is present', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'nexora-riot-install-'))
    const manifestDirectory = path.join(temporaryDirectory, 'Riot Games')
    const gameDirectory = path.join(temporaryDirectory, 'VALORANT', 'live')
    await mkdir(manifestDirectory, { recursive: true })
    await mkdir(gameDirectory, { recursive: true })
    await writeFile(path.join(gameDirectory, 'VALORANT.exe'), '')
    await writeFile(path.join(manifestDirectory, 'RiotClientInstalls.json'), JSON.stringify({
      associated_clients: {
        valorant: path.join(gameDirectory, 'VALORANT.exe'),
        league_of_legends: path.join(temporaryDirectory, 'missing', 'LeagueClient.exe'),
      },
    }))
    vi.stubEnv('ProgramData', temporaryDirectory)
    vi.stubEnv('LOCALAPPDATA', '')

    await expect(scanRiotGames()).resolves.toEqual({
      detected: true,
      complete: true,
      games: [{ appId: 'valorant', title: 'VALORANT', installPath: gameDirectory }],
      errors: [],
    })
  })
})
