import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppSettings, ArtworkKind, RelayApi, SyncProgress, UpdateState } from '../shared/types'

const api: RelayApi = {
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    recents: () => ipcRenderer.invoke('library:recents'),
    sync: () => ipcRenderer.invoke('library:sync'),
    importLocalExecutables: (executablePaths) => ipcRenderer.invoke('library:import-local-executables', executablePaths),
    installSize: (gameId) => ipcRenderer.invoke('library:install-size', gameId),
    getDroppedFilePath: (file) => {
      const filePath = webUtils.getPathForFile(file)
      return filePath.length > 0 ? filePath : null
    },
    onSyncProgress: (listener: (progress: SyncProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: SyncProgress) => listener(progress)
      ipcRenderer.on('library:sync-progress', handler)
      return () => ipcRenderer.removeListener('library:sync-progress', handler)
    },
    toggleFavorite: (gameId) => ipcRenderer.invoke('library:toggle-favorite', gameId),
    launch: (gameId) => ipcRenderer.invoke('library:launch', gameId),
    removeLocalGame: (gameId) => ipcRenderer.invoke('library:remove-local-game', gameId),
    setHidden: (gameId, hidden) => ipcRenderer.invoke('library:set-hidden', gameId, hidden),
    rename: (gameId, title) => ipcRenderer.invoke('library:rename', gameId, title),
    openFolder: (gameId) => ipcRenderer.invoke('library:open-folder', gameId),
    uninstall: (gameId) => ipcRenderer.invoke('library:uninstall', gameId),
    openSteamDb: (gameId) => ipcRenderer.invoke('library:open-steamdb', gameId),
  },
  metadata: {
    get: (gameId) => ipcRenderer.invoke('metadata:get', gameId),
    refresh: (gameId) => ipcRenderer.invoke('metadata:refresh', gameId),
    searchMatches: (gameId, query) => ipcRenderer.invoke('metadata:search-matches', gameId, query),
    setMatch: (gameId, source, id, name) => ipcRenderer.invoke('metadata:set-match', gameId, source, id, name),
    clearMatch: (gameId) => ipcRenderer.invoke('metadata:clear-match', gameId),
  },
  media: {
    list: (gameId) => ipcRenderer.invoke('media:list', gameId),
    image: (gameId, id, size) => ipcRenderer.invoke('media:image', gameId, id, size),
    openVideo: (gameId, id) => ipcRenderer.invoke('media:open-video', gameId, id),
  },
  artwork: {
    load: (platform, externalId, title, kind: ArtworkKind) =>
      ipcRenderer.invoke('artwork:load', platform, externalId, title, kind),
    refresh: (platform, externalId, title) =>
      ipcRenderer.invoke('artwork:refresh', platform, externalId, title),
    refreshAll: () => ipcRenderer.invoke('artwork:refresh-all'),
    chooseCustom: (platform, externalId, kind) =>
      ipcRenderer.invoke('artwork:choose-custom', platform, externalId, kind),
    clearCustom: (platform, externalId) =>
      ipcRenderer.invoke('artwork:clear-custom', platform, externalId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (value: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', value),
    chooseCacheDirectory: () => ipcRenderer.invoke('settings:choose-cache-directory'),
    saveSteamCredentials: (steamId, apiKey) =>
      ipcRenderer.invoke('settings:save-steam-credentials', steamId, apiKey),
    clearSteamCredentials: () => ipcRenderer.invoke('settings:clear-steam-credentials'),
    saveIgdbCredentials: (clientId, clientSecret) =>
      ipcRenderer.invoke('settings:save-igdb-credentials', clientId, clientSecret),
    clearIgdbCredentials: () => ipcRenderer.invoke('settings:clear-igdb-credentials'),
    saveSteamGridDbKey: (apiKey) => ipcRenderer.invoke('settings:save-steamgriddb-key', apiKey),
    clearSteamGridDbKey: () => ipcRenderer.invoke('settings:clear-steamgriddb-key'),
    saveDeepLKey: (apiKey) => ipcRenderer.invoke('settings:save-deepl-key', apiKey),
    clearDeepLKey: () => ipcRenderer.invoke('settings:clear-deepl-key'),
  },
  update: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (listener: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
}

contextBridge.exposeInMainWorld('relay', api)
