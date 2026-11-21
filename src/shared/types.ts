export type PlatformId =
  | 'steam'
  | 'epic'
  | 'xbox'
  | 'ubisoft'
  | 'ea'
  | 'gog'
  | 'battlenet'
  | 'riot'
  | 'local'

export type ArtworkKind = 'cover' | 'hero' | 'icon'
export type CustomArtworkKind = 'cover' | 'hero'
export type ArtworkPlatform = 'steam' | 'epic' | 'riot' | 'local'
export type LibraryFilter = 'all' | 'recent' | 'installed' | 'not-installed' | 'favorites' | 'hidden'
export type ViewMode = 'grid' | 'list'
export type SortMode = 'lastPlayed' | 'title' | 'added' | 'playCount'
export type Density = 'compact' | 'comfortable' | 'spacious'
/** system : suit la préférence de Windows « réduire les animations ». */
export type MotionMode = 'system' | 'full' | 'reduced'

export interface GameRecord {
  id: string
  /** Nom affiché (nom personnalisé s'il existe, sinon nom d'origine). */
  title: string
  originalTitle: string
  platform: PlatformId
  platformLabel: string
  externalId: string
  installed: boolean
  installPath: string | null
  launchPath: string | null
  favorite: boolean
  addedAt: string
  lastPlayedAt: string | null
  developer: string | null
  publisher: string | null
  hidden: boolean
  launchCount: number
}

export interface RecentGame extends GameRecord {
  launchedAt: string
}

export interface PlatformStatus {
  id: PlatformId
  label: string
  detected: boolean
  installedGames: number
  note: string
}

export interface SyncResult {
  added: number
  updated: number
  installed: number
  ownedImported: number
  platforms: PlatformStatus[]
  errors: string[]
}

export interface GameMatch {
  /** confirmed : identifiant certain (Steam) ou choisi par l'utilisateur · matched : trouvé automatiquement par nom exact · none : aucune correspondance fiable. */
  status: 'confirmed' | 'matched' | 'none'
  source: 'steam' | 'igdb' | 'epic' | 'manual' | null
  name: string | null
  steamAppId: string | null
  igdbId: number | null
}

export interface GameDetails {
  summary: string | null
  description: string | null
  descriptionSource: 'steam' | 'igdb' | 'epic' | null
  /** Une description existe mais n'a pas pu être traduite en français (clé DeepL absente, refus ou quota atteint). */
  translationUnavailable?: boolean
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate: string | null
  match: GameMatch
}

export type MediaSourceId = 'steam' | 'igdb' | 'egdata'

/** Captures d'écran et bandes-annonces d'un jeu (les images se chargent à part, par identifiant). */
export interface GameMedia {
  screenshots: Array<{ id: string; source: MediaSourceId }>
  videos: Array<{ id: string; source: MediaSourceId; title: string }>
}

export interface MatchCandidate {
  source: 'steam' | 'igdb' | 'egdata'
  id: number | string
  name: string
  year: number | null
  thumbnail: string | null
}

export interface SyncProgress {
  stage: string
  completed: number
  total: number
}

export interface AppSettings {
  viewMode: ViewMode
  cardSize: number
  sortMode: SortMode
  launchAtStartup: boolean
  density: Density
  motion: MotionMode
  steamId: string
  hasSteamApiKey: boolean
  hasIgdbCredentials: boolean
  hasSteamGridDbKey: boolean
  hasDeepLKey: boolean
  cacheDirectory: string
}

export type UpdatableSettings = Pick<AppSettings, 'viewMode' | 'cardSize' | 'sortMode' | 'launchAtStartup' | 'density' | 'motion'>

export interface LocalImportResult {
  /** Jeux importés (nouveaux ou déjà présents). */
  games: GameRecord[]
  /** Nombre de jeux réellement nouveaux dans la bibliothèque. */
  created: number
  /** Un message par fichier refusé (les autres sont importés normalement). */
  errors: string[]
}

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

export interface UpdateState {
  /** disabled : application non installée (mode développement), aucune mise à jour automatique. */
  status: UpdateStatus
  currentVersion: string
  /** Version en cours de téléchargement ou prête à être installée. */
  version: string | null
  /** Progression du téléchargement, de 0 à 100. */
  percent: number
  error: string | null
  /** Date ISO de la dernière vérification terminée. */
  checkedAt: string | null
}

export interface RelayApi {
  library: {
    list: () => Promise<GameRecord[]>
    recents: () => Promise<RecentGame[]>
    sync: () => Promise<SyncResult>
    importLocalExecutables: (executablePaths?: string[]) => Promise<LocalImportResult>
    /** Taille du dossier d'installation en octets (null si inconnue). */
    installSize: (gameId: string) => Promise<number | null>
    getDroppedFilePath: (file: File) => string | null
    removeLocalGame: (gameId: string) => Promise<boolean>
    onSyncProgress: (listener: (progress: SyncProgress) => void) => () => void
    toggleFavorite: (gameId: string) => Promise<GameRecord>
    launch: (gameId: string) => Promise<void>
    setHidden: (gameId: string, hidden: boolean) => Promise<GameRecord>
    rename: (gameId: string, title: string | null) => Promise<GameRecord>
    openFolder: (gameId: string) => Promise<void>
    uninstall: (gameId: string) => Promise<void>
    openSteamDb: (gameId: string) => Promise<void>
  }
  metadata: {
    get: (gameId: string) => Promise<GameDetails>
    refresh: (gameId: string) => Promise<GameDetails>
    searchMatches: (gameId: string, query: string) => Promise<MatchCandidate[]>
    setMatch: (gameId: string, source: 'steam' | 'igdb' | 'egdata', id: number | string, name?: string) => Promise<GameDetails>
    clearMatch: (gameId: string) => Promise<GameDetails>
  }
  media: {
    list: (gameId: string) => Promise<GameMedia>
    image: (gameId: string, id: string, size: 'thumb' | 'full') => Promise<string | null>
    openVideo: (gameId: string, id: string) => Promise<void>
  }
  artwork: {
    load: (platform: ArtworkPlatform, externalId: string, title: string, kind: ArtworkKind) => Promise<string | null>
    refresh: (platform: ArtworkPlatform, externalId: string, title: string) => Promise<void>
    refreshAll: () => Promise<number>
    chooseCustom: (platform: ArtworkPlatform, externalId: string, kind: CustomArtworkKind) => Promise<boolean>
    clearCustom: (platform: ArtworkPlatform, externalId: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (value: Partial<UpdatableSettings>) => Promise<AppSettings>
    chooseCacheDirectory: () => Promise<AppSettings>
    saveSteamCredentials: (steamId: string, apiKey: string) => Promise<AppSettings>
    clearSteamCredentials: () => Promise<AppSettings>
    saveIgdbCredentials: (clientId: string, clientSecret: string) => Promise<AppSettings>
    clearIgdbCredentials: () => Promise<AppSettings>
    saveSteamGridDbKey: (apiKey: string) => Promise<AppSettings>
    clearSteamGridDbKey: () => Promise<AppSettings>
    saveDeepLKey: (apiKey: string) => Promise<AppSettings>
    clearDeepLKey: () => Promise<AppSettings>
  }
  update: {
    getState: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    /** Redémarre Relay et installe la mise à jour déjà téléchargée. */
    install: () => Promise<void>
    onState: (listener: (state: UpdateState) => void) => () => void
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
}
