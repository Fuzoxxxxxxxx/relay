import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findEpicArtworkUrl, parseEpicManifest } from './adapter'

let temporaryDirectory = ''

afterEach(async () => {
  vi.unstubAllEnvs()
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = ''
  }
})

describe('Epic Games manifest parser', () => {
  it('parses a complete installed game manifest', () => {
    expect(parseEpicManifest(JSON.stringify({
      AppName: '963137e4c29d4c79a81323b8fab03a40',
      DisplayName: 'Among Us',
      InstallLocation: 'C:\\Program Files\\Epic Games\\AmongUs',
      LaunchExecutable: 'Among Us.exe',
      bIsIncompleteInstall: false,
      bIsApplication: true,
    }))).toEqual({
      appId: '963137e4c29d4c79a81323b8fab03a40',
      title: 'Among Us',
      installPath: 'C:\\Program Files\\Epic Games\\AmongUs',
      launchExecutable: 'C:\\Program Files\\Epic Games\\AmongUs\\Among Us.exe',
    })
  })

  it('ignores malformed, incomplete, non-game, and path-traversal manifests', () => {
    expect(parseEpicManifest('{invalid')).toBeNull()
    const base = {
      AppName: 'sample',
      DisplayName: 'Sample Game',
      InstallLocation: 'C:\\Games\\Sample',
      LaunchExecutable: 'Game.exe',
      bIsApplication: true,
    }
    expect(parseEpicManifest(JSON.stringify({ ...base, bIsIncompleteInstall: true }))).toBeNull()
    expect(parseEpicManifest(JSON.stringify({ ...base, bIsApplication: false }))).toBeNull()
    expect(parseEpicManifest(JSON.stringify({ ...base, LaunchExecutable: '..\\outside.exe' }))).toBeNull()
  })

  it('reads official cover and hero art from the Epic launcher catalog cache', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'relay-epic-catalog-'))
    const cacheDirectory = path.join(temporaryDirectory, 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog')
    await mkdir(cacheDirectory, { recursive: true })
    const products = [
      {
        title: 'Fortnite',
        releaseInfo: [{ appId: 'Fortnite' }],
        keyImages: [
          { type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/item/fn/fortnite-cover' },
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/item/fn/fortnite-hero' },
        ],
      },
      {
        title: 'Rocket League®',
        releaseInfo: [{ appId: 'Sugar' }],
        keyImages: [
          { type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/item/rocket/cover' },
          { type: 'DieselGameBox', url: 'https://cdn1.epicgames.com/item/rocket/hero' },
        ],
      },
    ]
    await writeFile(
      path.join(cacheDirectory, 'catcache.bin'),
      Buffer.from(JSON.stringify(products)).toString('base64'),
    )
    vi.stubEnv('ProgramData', temporaryDirectory)

    await expect(findEpicArtworkUrl('Fortnite', 'Fortnite', 'cover'))
      .resolves.toBe('https://cdn1.epicgames.com/item/fn/fortnite-cover')
    await expect(findEpicArtworkUrl('Sugar', 'Rocket League®', 'cover'))
      .resolves.toBe('https://cdn1.epicgames.com/item/rocket/cover')
    await expect(findEpicArtworkUrl('Sugar', 'Rocket League®', 'hero'))
      .resolves.toBe('https://cdn1.epicgames.com/item/rocket/hero')
  })
})
