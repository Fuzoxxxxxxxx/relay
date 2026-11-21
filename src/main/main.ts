import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  clearSteamCredentials,
  clearIgdbCredentials,
  clearSteamGridDbKey,
  clearDeepLKey,
  getCacheDirectory,
  getSettings,
  listGames,
  listRecentGames,
  removeLocalGame,
  renameGame,
  readSteamCredentials,
  readIgdbCredentials,
  readSteamGridDbKey,
  readDeepLKey,
  recordLaunch,
  saveSteamCredentials,
  saveIgdbCredentials,
  saveSteamGridDbKey,
  saveDeepLKey,
  setCacheDirectory,
  setGameHidden,
  syncPlatformGames,
  toggleFavorite,
  updateSettings,
} from './database'
import { GameArtworkService } from './artwork'
import { GameMetadataService } from './metadata'
import type { ManualMatch } from './metadata'
import { FrenchTranslator } from './translate'
import { GameMediaService } from './media'
import { InstallSizeService } from './diskUsage'
import { UpdateService } from './updater'
import {
  findSteamRoot,
  getOwnedSteamGames,
  scanSteamLibraries,
  steamPlatformStatus,
} from '../platforms/steam/adapter'
import { readEpicNamespace, scanEpicGames } from '../platforms/epic/adapter'
import type { EpicScanResult } from '../platforms/epic/adapter'
import { scanRiotGames } from '../platforms/riot/adapter'
import { inspectGameExecutable, localGameId, validateGameExecutable } from '../platforms/local/adapter'
import { IgdbClient } from '../platforms/igdb/adapter'
import { SteamGridDbClient } from '../platforms/steamgriddb/adapter'
import { EgDataClient } from '../platforms/egdata/adapter'
import type { ArtworkKind, ArtworkPlatform, CustomArtworkKind, LocalImportResult, PlatformId } from '../shared/types'

// Keep existing local libraries and settings after the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'nexora'))

const igdbClient = new IgdbClient(readIgdbCredentials)
const steamGridDbClient = new SteamGridDbClient(readSteamGridDbKey)
const translator = new FrenchTranslator(readDeepLKey, getCacheDirectory)
const metadataService = new GameMetadataService(getCacheDirectory, {
  igdb: igdbClient,
  egdata: new EgDataClient(),
  epicNamespace: readEpicNamespace,
  translate: (text) => translator.toFrench(text),
})
const mediaService = new GameMediaService(getCacheDirectory, metadataService)
const installSizeService = new InstallSizeService()
const updateService = new UpdateService()
const artworkService = new GameArtworkService(getCacheDirectory, {
  metadata: metadataService,
  steamGridDb: steamGridDbClient,
})
let mainWindow: BrowserWindow | null = null

const platformFallbacks: Array<{ id: PlatformId; label: string; note: string }> = [
  { id: 'xbox', label: 'Xbox', note: 'Import local non disponible pour le moment.' },
  { id: 'ubisoft', label: 'Ubisoft Connect', note: 'Import local non disponible pour le moment.' },
  { id: 'ea', label: 'EA app', note: 'Import local non disponible pour le moment.' },
  { id: 'gog', label: 'GOG Galaxy', note: 'Import local non disponible pour le moment.' },
  { id: 'battlenet', label: 'Battle.net', note: 'Import local non disponible pour le moment.' },
]

function trustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? ''
  const isDev = isSameOrigin(senderUrl, process.env.VITE_DEV_SERVER_URL)
  let isPackaged = false
  try {
    const packagedEntry = path.resolve(__dirname, '..', '..', 'dist', 'index.html')
    isPackaged = senderUrl.startsWith('file://')
      && path.resolve(fileURLToPath(senderUrl)).toLowerCase() === packagedEntry.toLowerCase()
  } catch {
    isPackaged = false
  }
  if (!isDev && !isPackaged) throw new Error('Origine IPC non autorisée.')
}

function isSameOrigin(first: string, second: string | undefined): boolean {
  if (!second) return false
  try {
    return new URL(first).origin === new URL(second).origin
  } catch {
    return false
  }
}

function requireString(value: unknown, label: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} invalide.`)
  }
  return value
}

function isArtworkPlatform(value: unknown): value is ArtworkPlatform {
  return value === 'steam' || value === 'epic' || value === 'riot' || value === 'local'
}

async function requireGame(gameId: unknown) {
  const id = requireString(gameId, 'Identifiant du jeu')
  const game = (await listGames()).find((item) => item.id === id)
  if (!game) throw new Error('Jeu introuvable dans la bibliothèque.')
  if (!isArtworkPlatform(game.platform)) throw new Error('Plateforme non prise en charge pour les métadonnées.')
  return { ...game, platform: game.platform }
}

/** Oublie images automatiques et correspondances de tous les jeux (les choix manuels sont conservés). */
async function refreshAllArtwork(): Promise<number> {
  artworkService.resetLookupCache('steam', 'epic', 'riot', 'local')
  let refreshed = 0
  for (const game of await listGames()) {
    if (!isArtworkPlatform(game.platform)) continue
    await artworkService.refresh(game.platform, game.externalId, game.title)
    refreshed += 1
  }
  return refreshed
}

async function registerIpcHandlers(): Promise<void> {
  ipcMain.handle('library:list', async (event) => {
    trustedSender(event)
    return listGames()
  })
  ipcMain.handle('library:recents', async (event) => {
    trustedSender(event)
    return listRecentGames()
  })
  ipcMain.handle('library:sync', async (event) => {
    trustedSender(event)
    const sendProgress = (stage: string, completed: number, total: number) => {
      event.sender.send('library:sync-progress', { stage, completed, total })
    }
    const errors: string[] = []
    const total = 5
    sendProgress('Recherche de Steam, Epic Games et Riot Games', 0, total)
    const steamRoot = await findSteamRoot()
    sendProgress('Lecture des bibliothèques Steam', 1, total)
    let steamGames: Array<{ appId: string; title: string; installPath: string }> = []
    let resetSteamInstallStatus = false
    let ownedGames: Array<{ appId: string; title: string }> = []
    let steamNote = steamRoot ? 'Le launcher est détecté, mais ses bibliothèques n’ont pas pu être lues.' : 'Steam n’a pas été détecté sur cet ordinateur.'
    const steamDetected = Boolean(steamRoot)
    if (steamRoot) {
      try {
        const libraries = await scanSteamLibraries()
        steamGames = libraries.flatMap((library) => library.games)
        errors.push(...libraries.flatMap((library) => library.error ? [library.error] : []))
        resetSteamInstallStatus = libraries.length > 0 && libraries.every((library) => library.complete)
        steamNote = 'Jeux installés importés depuis les bibliothèques Steam locales.'
      } catch (error) {
        errors.push(`Steam : ${error instanceof Error ? error.message : 'Erreur de lecture inconnue.'}`)
      }
    }
    let credentials: Awaited<ReturnType<typeof readSteamCredentials>> = null
    if (steamDetected) {
      try {
        credentials = await readSteamCredentials()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Les identifiants Steam n’ont pas pu être lus.')
      }
    }
    if (credentials) {
      try {
        ownedGames = await getOwnedSteamGames(credentials.apiKey, credentials.steamId)
        steamNote = 'Bibliothèque locale et jeux possédés synchronisés.'
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'La bibliothèque Steam possédée n’a pas pu être importée.')
      }
    } else if (steamDetected) {
      steamNote = 'Jeux installés importés. Configurez Steam Web API pour importer les jeux possédés.'
    }
    sendProgress('Lecture des manifestes Epic Games', 2, total)
    let epicScan: EpicScanResult = { detected: false, complete: false, games: [], errors: [] }
    try {
      epicScan = await scanEpicGames()
      errors.push(...epicScan.errors)
    } catch (error) {
      errors.push(`Epic Games : ${error instanceof Error ? error.message : 'Erreur de lecture inconnue.'}`)
    }

    sendProgress('Lecture des installations Riot Games', 3, total)
    let riotScan: Awaited<ReturnType<typeof scanRiotGames>> = {
      detected: false,
      complete: false,
      games: [],
      errors: [],
    }
    try {
      riotScan = await scanRiotGames()
      errors.push(...riotScan.errors)
    } catch (error) {
      errors.push(`Riot Games : ${error instanceof Error ? error.message : 'Erreur de lecture inconnue.'}`)
    }

    sendProgress('Enregistrement des jeux détectés', 4, total)
    const steamResult = steamDetected
      ? await syncPlatformGames('steam', {
        installedGames: steamGames,
        ownedGames,
        resetInstalledStatus: resetSteamInstallStatus,
      })
      : { added: 0, updated: 0 }
    const epicResult = epicScan.detected && epicScan.complete
      ? await syncPlatformGames('epic', {
        installedGames: epicScan.games,
        ownedGames: [],
        resetInstalledStatus: true,
      })
      : epicScan.detected
        ? await syncPlatformGames('epic', {
          installedGames: epicScan.games,
          ownedGames: [],
          resetInstalledStatus: false,
        })
        : { added: 0, updated: 0 }
    const riotResult = riotScan.detected && riotScan.complete
      ? await syncPlatformGames('riot', {
        installedGames: riotScan.games,
        ownedGames: [],
        resetInstalledStatus: true,
      })
      : riotScan.detected
        ? await syncPlatformGames('riot', {
          installedGames: riotScan.games,
          ownedGames: [],
          resetInstalledStatus: false,
        })
        : { added: 0, updated: 0 }

    const allGames = await listGames()
    const localGames = allGames.filter((game) => game.platform === 'local')
    sendProgress('Synchronisation terminée', total, total)
    return {
      added: steamResult.added + epicResult.added + riotResult.added,
      updated: steamResult.updated + epicResult.updated + riotResult.updated,
      installed: steamGames.length + epicScan.games.length + riotScan.games.length + localGames.length,
      ownedImported: ownedGames.length,
      platforms: [
        steamPlatformStatus(steamDetected, steamGames.length, steamNote),
        {
          id: 'epic',
          label: 'Epic Games',
          detected: epicScan.detected,
          installedGames: epicScan.games.length,
          note: epicScan.detected
            ? 'Jeux installés importés depuis les manifestes locaux du launcher.'
            : 'Epic Games Launcher ou ses manifestes locaux n’ont pas été détectés.',
        },
        {
          id: 'riot',
          label: 'Riot Games',
          detected: riotScan.detected,
          installedGames: riotScan.games.length,
          note: riotScan.detected
            ? `${riotScan.games.length} jeu(x) installé(s) trouvé(s) via le manifeste du client.`
            : 'Riot Client ou son manifeste local n’a pas été détecté.',
        },
        {
          id: 'local',
          label: 'Jeux locaux',
          detected: localGames.length > 0,
          installedGames: localGames.length,
          note: localGames.length
            ? `${localGames.length} jeu(x) ajouté(s) manuellement depuis un fichier .exe.`
            : 'Déposez le fichier .exe du jeu dans cette section pour l’ajouter.',
        },
        ...platformFallbacks.map((platform) => ({ ...platform, detected: false, installedGames: 0 })),
      ],
      errors,
    }
  })
  ipcMain.handle('library:toggle-favorite', async (event, gameId: unknown) => {
    trustedSender(event)
    return toggleFavorite(requireString(gameId, 'Identifiant du jeu'))
  })
  ipcMain.handle('library:import-local-executables', async (event, executablePaths: unknown): Promise<LocalImportResult> => {
    trustedSender(event)
    let selectedExecutables: string[]
    if (executablePaths === undefined) {
      if (!mainWindow) throw new Error('La fenêtre Relay n’est pas disponible.')
      const executableDialog = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir les programmes .exe des jeux',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Programmes Windows', extensions: ['exe'] }],
      })
      if (executableDialog.canceled || executableDialog.filePaths.length === 0) return { games: [], created: 0, errors: [] }
      selectedExecutables = executableDialog.filePaths
    } else {
      if (!Array.isArray(executablePaths) || executablePaths.length === 0 || executablePaths.length > 200) {
        throw new Error('Liste de fichiers invalide.')
      }
      selectedExecutables = executablePaths.map((item) => requireString(item, 'Fichier du jeu', 1024))
    }

    // Chaque fichier est vérifié séparément : un fichier refusé n'empêche pas l'import des autres.
    const errors: string[] = []
    const importable = new Map<string, { appId: string; title: string; installPath: string; launchPath: string }>()
    for (const selectedExecutable of selectedExecutables) {
      try {
        const game = await inspectGameExecutable(selectedExecutable)
        const validatedExecutable = await validateGameExecutable(game.folderPath, game.executablePath)
        const externalId = localGameId(validatedExecutable)
        importable.set(externalId, { appId: externalId, title: game.title, installPath: game.folderPath, launchPath: validatedExecutable })
      } catch (error) {
        errors.push(`${path.basename(selectedExecutable)} : ${error instanceof Error ? error.message : 'import impossible.'}`)
      }
    }
    if (importable.size === 0) return { games: [], created: 0, errors }

    const alreadyKnown = new Set((await listGames()).filter((game) => game.platform === 'local').map((game) => game.externalId))
    await syncPlatformGames('local', {
      installedGames: [...importable.values()],
      ownedGames: [],
      resetInstalledStatus: false,
    })
    const games = (await listGames()).filter((game) => game.platform === 'local' && importable.has(game.externalId))
    return { games, created: games.filter((game) => !alreadyKnown.has(game.externalId)).length, errors }
  })
  ipcMain.handle('library:install-size', async (event, gameId: unknown) => {
    trustedSender(event)
    const id = requireString(gameId, 'Identifiant du jeu')
    const game = (await listGames()).find((item) => item.id === id)
    if (!game) throw new Error('Jeu introuvable dans la bibliothèque.')
    if (!game.installed || !game.installPath) return null
    return installSizeService.size(game.installPath)
  })
  ipcMain.handle('library:remove-local-game', async (event, gameId: unknown) => {
    trustedSender(event)
    const id = requireString(gameId, 'Identifiant du jeu')
    const game = (await listGames()).find((item) => item.id === id)
    if (!game || game.platform !== 'local') throw new Error('Jeu local introuvable dans la bibliothèque.')
    await removeLocalGame(id)
    return true
  })
  ipcMain.handle('library:launch', async (event, gameId: unknown) => {
    trustedSender(event)
    const id = requireString(gameId, 'Identifiant du jeu')
    const game = (await listGames()).find((item) => item.id === id)
    if (!game) throw new Error('Jeu introuvable dans la bibliothèque.')
    if (game.platform === 'steam') {
      if (!/^\d+$/.test(game.externalId)) throw new Error('Identifiant Steam invalide.')
      if (!await findSteamRoot()) throw new Error('Steam n’est pas détecté. Installez Steam pour lancer ce jeu.')
      const protocolUrl = game.installed
        ? `steam://run/${game.externalId}`
        : `steam://install/${game.externalId}`
      await shell.openExternal(protocolUrl)
      if (game.installed) await recordLaunch(id)
      return
    }
    if (game.platform === 'epic') {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(game.externalId)) throw new Error('Identifiant Epic Games invalide.')
      await shell.openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(game.externalId)}?action=launch&silent=true`)
      if (game.installed) await recordLaunch(id)
      return
    }
    if (game.platform === 'riot') {
      if (!['league_of_legends', 'valorant', 'pft'].includes(game.externalId)) {
        throw new Error('Identifiant de jeu Riot Games non pris en charge.')
      }
      if (!game.installed) throw new Error('Ce jeu Riot Games n’est pas installé.')
      await shell.openExternal(`riotclient://launch-product=${game.externalId}&launch-patchline=live`)
      await recordLaunch(id)
      return
    }
    if (game.platform === 'local') {
      if (!game.installed || !game.installPath || !game.launchPath) {
        throw new Error('Le jeu local n’a pas de programme de lancement enregistré.')
      }
      const executable = await validateGameExecutable(game.installPath, game.launchPath)
      const launchError = await shell.openPath(executable)
      if (launchError) throw new Error(`Impossible de lancer ${game.title} : ${launchError}`)
      await recordLaunch(id)
      return
    }
    throw new Error('Aucune méthode de lancement vérifiée n’est disponible pour ce jeu.')
  })
  ipcMain.handle('library:set-hidden', async (event, gameId: unknown, hidden: unknown) => {
    trustedSender(event)
    if (typeof hidden !== 'boolean') throw new Error('Valeur de masquage invalide.')
    return setGameHidden(requireString(gameId, 'Identifiant du jeu'), hidden)
  })
  ipcMain.handle('library:rename', async (event, gameId: unknown, title: unknown) => {
    trustedSender(event)
    if (title !== null && typeof title !== 'string') throw new Error('Nom du jeu invalide.')
    const updated = await renameGame(requireString(gameId, 'Identifiant du jeu'), title)
    // Epic et les jeux locaux retrouvent leurs images à partir du nom : on relance la recherche.
    if (updated.platform === 'local' || updated.platform === 'epic') {
      await artworkService.refresh(updated.platform, updated.externalId, updated.title)
    }
    return updated
  })
  ipcMain.handle('library:open-folder', async (event, gameId: unknown) => {
    trustedSender(event)
    const id = requireString(gameId, 'Identifiant du jeu')
    const game = (await listGames()).find((item) => item.id === id)
    if (!game) throw new Error('Jeu introuvable dans la bibliothèque.')
    if (!game.installed || !game.installPath) throw new Error('Ce jeu n’a pas de dossier d’installation connu.')
    const folder = await stat(game.installPath).catch(() => null)
    if (!folder?.isDirectory()) throw new Error('Le dossier d’installation est introuvable sur ce disque.')
    const failure = await shell.openPath(game.installPath)
    if (failure) throw new Error(`Impossible d’ouvrir le dossier : ${failure}`)
  })
  ipcMain.handle('library:uninstall', async (event, gameId: unknown) => {
    trustedSender(event)
    const id = requireString(gameId, 'Identifiant du jeu')
    const game = (await listGames()).find((item) => item.id === id)
    if (!game) throw new Error('Jeu introuvable dans la bibliothèque.')
    if (game.platform !== 'steam' || !game.installed || !/^\d+$/.test(game.externalId)) {
      throw new Error('La désinstallation n’est proposée que pour les jeux Steam installés.')
    }
    if (!await findSteamRoot()) throw new Error('Steam n’est pas détecté.')
    // Steam affiche lui-même sa confirmation : Relay ne supprime aucun fichier.
    await shell.openExternal(`steam://uninstall/${game.externalId}`)
  })
  ipcMain.handle('library:open-steamdb', async (event, gameId: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    const { match } = await metadataService.details(game.platform, game.externalId, game.title)
    if (!match.steamAppId || !/^\d+$/.test(match.steamAppId)) throw new Error('Ce jeu n’a pas de page SteamDB connue.')
    await shell.openExternal(`https://steamdb.info/app/${match.steamAppId}/`)
  })
  ipcMain.handle('metadata:get', async (event, gameId: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    return metadataService.details(game.platform, game.externalId, game.title)
  })
  ipcMain.handle('metadata:refresh', async (event, gameId: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    await artworkService.refresh(game.platform, game.externalId, game.title)
    return metadataService.details(game.platform, game.externalId, game.title)
  })
  ipcMain.handle('metadata:search-matches', async (event, gameId: unknown, query: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    return metadataService.searchCandidates(requireString(query, 'Recherche', 120), game.platform)
  })
  ipcMain.handle('metadata:set-match', async (event, gameId: unknown, source: unknown, id: unknown, name: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    let override: ManualMatch
    if (source === 'steam' || source === 'igdb') {
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error('Identifiant de correspondance invalide.')
      override = { source, id }
    } else if (source === 'egdata') {
      if (game.platform !== 'epic' && game.platform !== 'riot') throw new Error('egdata n’est disponible que pour les jeux Epic et Riot.')
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error('Identifiant de correspondance invalide.')
      override = { source, id, title: requireString(name, 'Nom du jeu', 200) }
    } else {
      throw new Error('Source de correspondance invalide.')
    }
    await metadataService.setOverride(game.platform, game.externalId, override)
    await artworkService.refresh(game.platform, game.externalId, game.title, true)
    return metadataService.details(game.platform, game.externalId, game.title)
  })
  ipcMain.handle('metadata:clear-match', async (event, gameId: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    await metadataService.setOverride(game.platform, game.externalId, null)
    await artworkService.refresh(game.platform, game.externalId, game.title, true)
    return metadataService.details(game.platform, game.externalId, game.title)
  })
  ipcMain.handle('artwork:choose-custom', async (event, platform: unknown, appId: unknown, kind: unknown) => {
    trustedSender(event)
    if (!isArtworkPlatform(platform)) throw new Error('Plateforme d’illustration invalide.')
    if (kind !== 'cover' && kind !== 'hero') throw new Error('Type d’illustration invalide.')
    if (!mainWindow) throw new Error('La fenêtre Relay n’est pas disponible.')
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'cover' ? 'Choisir une jaquette' : 'Choisir une bannière',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return false
    await artworkService.setCustom(platform, requireString(appId, 'Identifiant du jeu', 128), kind as CustomArtworkKind, selection.filePaths[0])
    return true
  })
  ipcMain.handle('artwork:clear-custom', async (event, platform: unknown, appId: unknown) => {
    trustedSender(event)
    if (!isArtworkPlatform(platform)) throw new Error('Plateforme d’illustration invalide.')
    await artworkService.clearCustom(platform, requireString(appId, 'Identifiant du jeu', 128))
  })
  ipcMain.handle('artwork:refresh-all', async (event) => {
    trustedSender(event)
    return refreshAllArtwork()
  })
  ipcMain.handle('artwork:load', async (event, platform: unknown, appId: unknown, title: unknown, kind: unknown) => {
    trustedSender(event)
    if (platform !== 'steam' && platform !== 'epic' && platform !== 'riot' && platform !== 'local') throw new Error('Plateforme d’illustration invalide.')
    const id = requireString(appId, 'Identifiant du jeu', 128)
    const gameTitle = requireString(title, 'Titre du jeu', 200)
    if (typeof kind !== 'string' || !['cover', 'hero', 'icon'].includes(kind)) {
      throw new Error('Type d’illustration invalide.')
    }
    const artwork = await artworkService.get(platform, id, gameTitle, kind as ArtworkKind)
    if (artwork || platform !== 'local') return artwork
    const localGame = (await listGames()).find((game) => game.platform === 'local' && game.externalId === id)
    if (!localGame?.launchPath) return null
    const executableIcon = await app.getFileIcon(localGame.launchPath, { size: 'large' })
    return executableIcon.isEmpty() ? null : executableIcon.toDataURL()
  })
  ipcMain.handle('artwork:refresh', async (event, platform: unknown, appId: unknown, title: unknown) => {
    trustedSender(event)
    if (platform !== 'steam' && platform !== 'epic' && platform !== 'riot' && platform !== 'local') throw new Error('Plateforme d’illustration invalide.')
    return artworkService.refresh(platform, requireString(appId, 'Identifiant du jeu', 128), requireString(title, 'Titre du jeu', 200))
  })
  ipcMain.handle('settings:get', async (event) => {
    trustedSender(event)
    return getSettings()
  })
  ipcMain.handle('settings:update', async (event, value: unknown) => {
    trustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Paramètres invalides.')
    const updated = value as Parameters<typeof updateSettings>[0]
    const settings = await updateSettings(updated)
    if (updated.launchAtStartup !== undefined) {
      app.setLoginItemSettings({ openAtLogin: updated.launchAtStartup })
    }
    return settings
  })
  ipcMain.handle('settings:choose-cache-directory', async (event) => {
    trustedSender(event)
    if (!mainWindow) throw new Error('La fenêtre Relay n’est pas disponible.')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choisir le dossier de cache des illustrations',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return getSettings()
    await setCacheDirectory(result.filePaths[0])
    return getSettings()
  })
  ipcMain.handle('settings:save-steam-credentials', async (event, steamId: unknown, apiKey: unknown) => {
    trustedSender(event)
    await saveSteamCredentials(
      requireString(steamId, 'Identifiant Steam', 17),
      requireString(apiKey, 'Clé Steam Web API', 32),
    )
    return getSettings()
  })
  ipcMain.handle('settings:clear-steam-credentials', async (event) => {
    trustedSender(event)
    await clearSteamCredentials()
    return getSettings()
  })
  ipcMain.handle('settings:save-igdb-credentials', async (event, clientId: unknown, clientSecret: unknown) => {
    trustedSender(event)
    const credentials = {
      clientId: requireString(clientId, 'Client ID Twitch/IGDB', 128),
      clientSecret: requireString(clientSecret, 'Client Secret Twitch/IGDB', 128),
    }
    await igdbClient.validateCredentials(credentials)
    await saveIgdbCredentials(credentials.clientId, credentials.clientSecret)
    await refreshAllArtwork()
    return getSettings()
  })
  ipcMain.handle('settings:clear-igdb-credentials', async (event) => {
    trustedSender(event)
    await clearIgdbCredentials()
    igdbClient.clearCache()
    await refreshAllArtwork()
    return getSettings()
  })
  ipcMain.handle('settings:save-steamgriddb-key', async (event, apiKey: unknown) => {
    trustedSender(event)
    const key = requireString(apiKey, 'Clé SteamGridDB', 64)
    await steamGridDbClient.validateKey(key)
    await saveSteamGridDbKey(key)
    await refreshAllArtwork()
    return getSettings()
  })
  ipcMain.handle('settings:clear-steamgriddb-key', async (event) => {
    trustedSender(event)
    await clearSteamGridDbKey()
    steamGridDbClient.clearCache()
    await refreshAllArtwork()
    return getSettings()
  })
  ipcMain.handle('media:list', async (event, gameId: unknown) => {
    trustedSender(event)
    const game = await requireGame(gameId)
    return mediaService.list(game.platform, game.externalId, game.title)
  })
  ipcMain.handle('media:image', async (event, gameId: unknown, id: unknown, size: unknown) => {
    trustedSender(event)
    if (typeof id !== 'string' || (size !== 'thumb' && size !== 'full')) throw new Error('Demande d’image invalide.')
    const game = await requireGame(gameId)
    return mediaService.image(game.platform, game.externalId, game.title, id, size)
  })
  ipcMain.handle('media:open-video', async (event, gameId: unknown, id: unknown) => {
    trustedSender(event)
    if (typeof id !== 'string') throw new Error('Demande de vidéo invalide.')
    const game = await requireGame(gameId)
    const url = await mediaService.videoUrl(game.platform, game.externalId, game.title, id)
    if (!url) throw new Error('Vidéo introuvable.')
    await shell.openExternal(url)
  })
  ipcMain.handle('settings:save-deepl-key', async (event, apiKey: unknown) => {
    trustedSender(event)
    const key = requireString(apiKey, 'Clé DeepL', 80)
    await translator.validateKey(key)
    await saveDeepLKey(key)
    // Les descriptions restées sans traduction (faute de clé) sont recalculées au prochain affichage.
    await metadataService.expireDegraded()
    return getSettings()
  })
  ipcMain.handle('settings:clear-deepl-key', async (event) => {
    trustedSender(event)
    await clearDeepLKey()
    return getSettings()
  })

  ipcMain.handle('update:get-state', async (event) => {
    trustedSender(event)
    return updateService.getState()
  })
  ipcMain.handle('update:check', async (event) => {
    trustedSender(event)
    return updateService.check()
  })
  ipcMain.handle('update:install', async (event) => {
    trustedSender(event)
    updateService.install()
  })

  ipcMain.on('window:minimize', (event) => {
    if (event.senderFrame?.url && mainWindow?.webContents.mainFrame.url === event.senderFrame.url) mainWindow.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    if (event.senderFrame?.url && mainWindow?.webContents.mainFrame.url === event.senderFrame.url) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    }
  })
  ipcMain.on('window:close', (event) => {
    if (event.senderFrame?.url && mainWindow?.webContents.mainFrame.url === event.senderFrame.url) mainWindow.close()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0b0f',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const devOrigin = process.env.VITE_DEV_SERVER_URL
    if (isSameOrigin(targetUrl, devOrigin)) return
    const packagedEntry = pathToFileURL(path.resolve(__dirname, '..', '..', 'dist', 'index.html')).href
    if (!devOrigin && targetUrl === packagedEntry) return
    event.preventDefault()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch((error: unknown) => {
      console.error('Impossible de charger l’interface de développement :', error)
    })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html')).catch((error: unknown) => {
      console.error('Impossible de charger l’interface Relay :', error)
    })
  }
}

// Une seule instance : indispensable pour que l'installeur puisse remplacer les fichiers lors d'une mise à jour.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
} else {
  app.quit()
}

void (async () => {
  if (!hasSingleInstanceLock) return
  try {
    await app.whenReady()
    await registerIpcHandlers()
    createWindow()
    updateService.onChange((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', state)
    })
    updateService.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (error) {
    console.error('Relay — erreur de démarrage :', error)
    app.quit()
  }
})()

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
