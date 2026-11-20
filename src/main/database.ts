import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { app, safeStorage } from 'electron'
import type { AppSettings, Density, GameRecord, MotionMode, PlatformId, RecentGame, SortMode, ViewMode } from '../shared/types'
import type { IgdbCredentials } from '../platforms/igdb/adapter'
interface SteamCredentials {
  steamId: string
  apiKey: string
}

let database: Database | null = null
let sqlModule: SqlJsStatic | null = null
let databasePath = ''
let databasePromise: Promise<Database> | null = null
let persistenceQueue: Promise<void> = Promise.resolve()
const credentialPath = () => path.join(app.getPath('userData'), 'steam-credentials.json')
const igdbCredentialPath = () => path.join(app.getPath('userData'), 'igdb-credentials.json')
const steamGridDbKeyPath = () => path.join(app.getPath('userData'), 'steamgriddb-key.json')
const deepLKeyPath = () => path.join(app.getPath('userData'), 'deepl-key.json')

async function getDatabase(): Promise<Database> {
  if (database) return database
  if (!databasePromise) databasePromise = initializeDatabase()
  try {
    return await databasePromise
  } catch (error) {
    database = null
    databasePromise = null
    throw error
  }
}

async function initializeDatabase(): Promise<Database> {
  await mkdir(app.getPath('userData'), { recursive: true })
  databasePath = path.join(app.getPath('userData'), 'nexora.sqlite')
  sqlModule ??= await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  })
  try {
    const bytes = await readFile(databasePath)
    database = new sqlModule.Database(bytes)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    database = new sqlModule.Database()
  }

  database.run('PRAGMA foreign_keys = ON')
  const currentSchema = readRows<{ user_version: number }>(database, 'PRAGMA user_version')[0]?.user_version ?? 0
  if (currentSchema > 3) throw new Error(`La base Nexora utilise une version de schéma non prise en charge (${currentSchema}).`)
  if (currentSchema < 1) {
    database.run(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        last_played_at TEXT,
        developer TEXT,
        publisher TEXT
      );
      CREATE TABLE IF NOT EXISTS platform_games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        installed INTEGER NOT NULL DEFAULT 0,
        install_path TEXT,
        launch_path TEXT,
        UNIQUE(platform, external_id)
      );
      CREATE TABLE IF NOT EXISTS launch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        launched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_games_title ON games(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_platform_games_platform ON platform_games(platform, installed);
      CREATE INDEX IF NOT EXISTS idx_launch_history_recent ON launch_history(launched_at DESC);
      PRAGMA user_version = 2;
    `)
  }
  if (currentSchema === 1) {
    database.run('ALTER TABLE platform_games ADD COLUMN launch_path TEXT; PRAGMA user_version = 2')
  }
  if (currentSchema < 3) {
    database.run(`
      ALTER TABLE games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE games ADD COLUMN custom_title TEXT;
      PRAGMA user_version = 3;
    `)
  }
  await persist()
  return database
}

async function persist(): Promise<void> {
  if (!database || !databasePath) return
  const snapshot = database.export()
  const write = persistenceQueue.then(() => writeFile(databasePath, snapshot))
  persistenceQueue = write.catch(() => undefined)
  await write
}

function readRows<T>(db: Database, sql: string, values: unknown[] = []): T[] {
  const statement = db.prepare(sql)
  try {
    statement.bind(values as (string | number | null | Uint8Array)[])
    const rows: T[] = []
    while (statement.step()) rows.push(statement.getAsObject() as T)
    return rows
  } finally {
    statement.free()
  }
}

const platformLabels: Record<PlatformId, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  xbox: 'Xbox',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  gog: 'GOG Galaxy',
  battlenet: 'Battle.net',
  riot: 'Riot Games',
  local: 'Jeux locaux',
}

const gameColumns = `
  g.id, COALESCE(NULLIF(TRIM(g.custom_title), ''), g.title) AS title, g.title AS originalTitle,
  pg.platform, pg.external_id AS externalId,
  pg.installed, pg.install_path AS installPath, pg.launch_path AS launchPath, g.favorite,
  g.added_at AS addedAt, g.last_played_at AS lastPlayedAt,
  g.developer, g.publisher, g.hidden,
  (SELECT COUNT(*) FROM launch_history lh WHERE lh.game_id = g.id) AS launchCount
`

const gameSelect = `
  SELECT ${gameColumns}
  FROM games g
  JOIN platform_games pg ON pg.game_id = g.id
  WHERE NOT (pg.platform = 'steam' AND pg.external_id = '228980')
`

function mapGame(row: Record<string, unknown>): GameRecord {
  const platform = row.platform as PlatformId
  return {
    id: String(row.id),
    title: String(row.title),
    originalTitle: typeof row.originalTitle === 'string' ? row.originalTitle : String(row.title),
    platform,
    platformLabel: platformLabels[platform] ?? platform,
    externalId: String(row.externalId),
    installed: Number(row.installed) === 1,
    installPath: typeof row.installPath === 'string' ? row.installPath : null,
    launchPath: typeof row.launchPath === 'string' ? row.launchPath : null,
    favorite: Number(row.favorite) === 1,
    addedAt: String(row.addedAt),
    lastPlayedAt: typeof row.lastPlayedAt === 'string' ? row.lastPlayedAt : null,
    developer: typeof row.developer === 'string' ? row.developer : null,
    publisher: typeof row.publisher === 'string' ? row.publisher : null,
    hidden: Number(row.hidden) === 1,
    launchCount: Number(row.launchCount) || 0,
  }
}

export async function listGames(): Promise<GameRecord[]> {
  const db = await getDatabase()
  return readRows<Record<string, unknown>>(db, `${gameSelect} ORDER BY g.title COLLATE NOCASE`).map(mapGame)
}

export async function listRecentGames(limit = 8): Promise<RecentGame[]> {
  const db = await getDatabase()
  return readRows<Record<string, unknown>>(db, `
    SELECT ${gameColumns}, recent.launched_at
    FROM games g
    JOIN platform_games pg ON pg.game_id = g.id
    JOIN (
      SELECT game_id, MAX(launched_at) AS launched_at
      FROM launch_history
      GROUP BY game_id
    ) recent ON recent.game_id = g.id
    WHERE NOT (pg.platform = 'steam' AND pg.external_id = '228980') AND g.hidden = 0
    ORDER BY recent.launched_at DESC
    LIMIT ?
  `, [limit]).map((row) => ({ ...mapGame(row), launchedAt: String(row.launched_at) }))
}

export async function toggleFavorite(gameId: string): Promise<GameRecord> {
  const db = await getDatabase()
  db.run('UPDATE games SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', [gameId])
  if (db.getRowsModified() !== 1) throw new Error('Jeu introuvable dans la bibliothèque.')
  await persist()
  const row = readRows<Record<string, unknown>>(db, `${gameSelect} AND g.id = ?`, [gameId])[0]
  if (!row) throw new Error('Jeu introuvable après la mise à jour du favori.')
  return mapGame(row)
}

async function updateGameRow(gameId: string, sql: string, values: Array<string | number | null>): Promise<GameRecord> {
  const db = await getDatabase()
  db.run(sql, [...values, gameId])
  if (db.getRowsModified() !== 1) throw new Error('Jeu introuvable dans la bibliothèque.')
  await persist()
  const row = readRows<Record<string, unknown>>(db, `${gameSelect} AND g.id = ?`, [gameId])[0]
  if (!row) throw new Error('Jeu introuvable après la mise à jour.')
  return mapGame(row)
}

export async function setGameHidden(gameId: string, hidden: boolean): Promise<GameRecord> {
  return updateGameRow(gameId, 'UPDATE games SET hidden = ? WHERE id = ?', [hidden ? 1 : 0])
}

/** `null` rétablit le nom d'origine. */
export async function renameGame(gameId: string, title: string | null): Promise<GameRecord> {
  const cleaned = title === null ? null : title.trim()
  if (cleaned !== null && (cleaned.length === 0 || cleaned.length > 200)) {
    throw new Error('Le nom du jeu doit contenir entre 1 et 200 caractères.')
  }
  return updateGameRow(gameId, 'UPDATE games SET custom_title = ? WHERE id = ?', [cleaned])
}

export async function removeLocalGame(gameId: string): Promise<void> {
  const db = await getDatabase()
  db.run('BEGIN TRANSACTION')
  try {
    db.run("DELETE FROM games WHERE id = ? AND id IN (SELECT game_id FROM platform_games WHERE platform = 'local')", [gameId])
    if (db.getRowsModified() !== 1) throw new Error('Jeu local introuvable dans la bibliothèque.')
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  await persist()
}

export interface PlatformSyncInput {
  installedGames: Array<{ appId: string; title: string; installPath: string; launchPath?: string }>
  ownedGames: Array<{ appId: string; title: string }>
  resetInstalledStatus: boolean
}

export async function syncPlatformGames(
  platform: Extract<PlatformId, 'steam' | 'epic' | 'riot' | 'local'>,
  input: PlatformSyncInput,
): Promise<{ added: number; updated: number }> {
  const db = await getDatabase()
  let added = 0
  let updated = 0
  db.run('BEGIN TRANSACTION')
  try {
    if (input.resetInstalledStatus) {
      db.run('UPDATE platform_games SET installed = 0, install_path = NULL, launch_path = NULL WHERE platform = ?', [platform])
    }

    const games = new Map<string, { title: string; installPath: string | null; launchPath: string | null; installed: boolean }>()
    for (const game of input.ownedGames) games.set(game.appId, { title: game.title, installPath: null, launchPath: null, installed: false })
    for (const game of input.installedGames) {
      games.set(game.appId, {
        title: game.title,
        installPath: game.installPath,
        launchPath: game.launchPath ?? null,
        installed: true,
      })
    }

    for (const [appId, game] of games) {
      const internalId = `${platform}:${appId}`
      const exists = readRows<{ id: string }>(db, 'SELECT id FROM games WHERE id = ?', [internalId]).length > 0
      const timestamp = new Date().toISOString()
      db.run(`
        INSERT INTO games (id, title, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title
      `, [internalId, game.title, timestamp])
      db.run(`
        INSERT INTO platform_games (game_id, platform, external_id, installed, install_path, launch_path)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, external_id) DO UPDATE SET
          installed = CASE WHEN excluded.installed = 1 THEN 1 ELSE platform_games.installed END,
          install_path = CASE WHEN excluded.install_path IS NOT NULL THEN excluded.install_path ELSE platform_games.install_path END,
          launch_path = CASE WHEN excluded.launch_path IS NOT NULL THEN excluded.launch_path ELSE platform_games.launch_path END
      `, [internalId, platform, appId, game.installed ? 1 : 0, game.installPath, game.launchPath])
      if (exists) updated += 1
      else added += 1
    }

    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  await persist()
  return { added, updated }
}

export async function recordLaunch(gameId: string): Promise<void> {
  const db = await getDatabase()
  const timestamp = new Date().toISOString()
  db.run('BEGIN TRANSACTION')
  try {
    db.run('UPDATE games SET last_played_at = ? WHERE id = ?', [timestamp, gameId])
    if (db.getRowsModified() !== 1) throw new Error('Jeu introuvable dans la bibliothèque.')
    db.run('INSERT INTO launch_history (game_id, launched_at) VALUES (?, ?)', [gameId, timestamp])
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  await persist()
}

const defaultSettings = {
  viewMode: 'grid' as ViewMode,
  cardSize: 168,
  sortMode: 'lastPlayed' as SortMode,
  launchAtStartup: false,
  density: 'comfortable' as Density,
  motion: 'system' as MotionMode,
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDatabase()
  const stored = readRows<{ key: string; value: string }>(db, 'SELECT key, value FROM preferences')
  const values = Object.fromEntries(stored.map(({ key, value }) => [key, value]))
  const credentials = await readSteamCredentials()
  const igdbCredentials = await readIgdbCredentials()
  const steamGridDbKey = await readSteamGridDbKey()
  const deepLKey = await readDeepLKey()
  return {
    viewMode: values.viewMode === 'list' ? 'list' : defaultSettings.viewMode,
    cardSize: Math.min(256, Math.max(120, Number(values.cardSize) || defaultSettings.cardSize)),
    sortMode: values.sortMode === 'title' || values.sortMode === 'added' || values.sortMode === 'playCount' ? values.sortMode : defaultSettings.sortMode,
    launchAtStartup: values.launchAtStartup === 'true',
    density: values.density === 'compact' || values.density === 'spacious' ? values.density : defaultSettings.density,
    motion: values.motion === 'full' || values.motion === 'reduced' ? values.motion : defaultSettings.motion,
    steamId: credentials?.steamId ?? '',
    hasSteamApiKey: Boolean(credentials?.apiKey),
    hasIgdbCredentials: Boolean(igdbCredentials),
    hasSteamGridDbKey: Boolean(steamGridDbKey),
    hasDeepLKey: Boolean(deepLKey),
    cacheDirectory: await getCacheDirectory(),
  }
}

export async function getCacheDirectory(): Promise<string> {
  const db = await getDatabase()
  const value = readRows<{ value: string }>(db, "SELECT value FROM preferences WHERE key = 'cacheDirectory'")[0]?.value
  return value && path.isAbsolute(value) ? value : path.join(app.getPath('userData'), 'artwork')
}

export async function setCacheDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || directory.length > 1024) {
    throw new Error('Le dossier de cache doit être un chemin absolu valide.')
  }
  await mkdir(directory, { recursive: true })
  const db = await getDatabase()
  db.run("INSERT INTO preferences (key, value) VALUES ('cacheDirectory', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [directory])
  await persist()
}

export async function updateSettings(value: Partial<Pick<AppSettings, 'viewMode' | 'cardSize' | 'sortMode' | 'launchAtStartup' | 'density' | 'motion'>>): Promise<AppSettings> {
  const db = await getDatabase()
  const allowedKeys = new Set(['viewMode', 'cardSize', 'sortMode', 'launchAtStartup', 'density', 'motion'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('Paramètre non autorisé.')
  if (value.viewMode !== undefined && value.viewMode !== 'grid' && value.viewMode !== 'list') {
    throw new Error('Mode d’affichage invalide.')
  }
  if (value.sortMode !== undefined && !['lastPlayed', 'title', 'added', 'playCount'].includes(value.sortMode)) {
    throw new Error('Mode de tri invalide.')
  }
  if (value.cardSize !== undefined && (!Number.isFinite(value.cardSize) || value.cardSize < 120 || value.cardSize > 256)) {
    throw new Error('La taille des cartes doit être comprise entre 120 et 256 pixels.')
  }
  if (value.launchAtStartup !== undefined && typeof value.launchAtStartup !== 'boolean') {
    throw new Error('Valeur de démarrage invalide.')
  }
  if (value.density !== undefined && !['compact', 'comfortable', 'spacious'].includes(value.density)) {
    throw new Error('Densité d’affichage invalide.')
  }
  if (value.motion !== undefined && !['system', 'full', 'reduced'].includes(value.motion)) {
    throw new Error('Réglage des animations invalide.')
  }

  for (const [key, setting] of Object.entries(value)) {
    if (setting !== undefined) {
      db.run('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        String(setting),
      ])
    }
  }
  await persist()
  return getSettings()
}

export async function readSteamCredentials(): Promise<SteamCredentials | null> {
  try {
    const json = JSON.parse(await readFile(credentialPath(), 'utf8')) as { steamId?: unknown; encryptedKey?: unknown }
    if (typeof json.steamId !== 'string' || typeof json.encryptedKey !== 'string') return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const apiKey = safeStorage.decryptString(Buffer.from(json.encryptedKey, 'base64'))
    return apiKey ? { steamId: json.steamId, apiKey } : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Impossible de lire les identifiants Steam chiffrés.', { cause: error })
  }
}

export async function readIgdbCredentials(): Promise<IgdbCredentials | null> {
  try {
    const json = JSON.parse(await readFile(igdbCredentialPath(), 'utf8')) as {
      encryptedClientId?: unknown
      encryptedClientSecret?: unknown
    }
    if (typeof json.encryptedClientId !== 'string' || typeof json.encryptedClientSecret !== 'string') return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const clientId = safeStorage.decryptString(Buffer.from(json.encryptedClientId, 'base64'))
    const clientSecret = safeStorage.decryptString(Buffer.from(json.encryptedClientSecret, 'base64'))
    return clientId && clientSecret ? { clientId, clientSecret } : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Impossible de lire les identifiants IGDB chiffrés.', { cause: error })
  }
}

export async function saveIgdbCredentials(clientId: string, clientSecret: string): Promise<void> {
  if (!/^[A-Za-z0-9]{10,128}$/.test(clientId)) throw new Error('Le Client ID Twitch/IGDB est invalide.')
  if (clientSecret.length < 16 || clientSecret.length > 128 || !/^[\x21-\x7e]+$/.test(clientSecret)) {
    throw new Error('Le Client Secret Twitch/IGDB est invalide.')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Le chiffrement sécurisé du système est indisponible. Les identifiants IGDB n’ont pas été enregistrés.')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const encryptedClientId = safeStorage.encryptString(clientId).toString('base64')
  const encryptedClientSecret = safeStorage.encryptString(clientSecret).toString('base64')
  await writeFile(igdbCredentialPath(), JSON.stringify({ encryptedClientId, encryptedClientSecret }), { mode: 0o600 })
}

export async function clearIgdbCredentials(): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  try {
    await unlink(igdbCredentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function readSteamGridDbKey(): Promise<string | null> {
  try {
    const json = JSON.parse(await readFile(steamGridDbKeyPath(), 'utf8')) as { encryptedKey?: unknown }
    if (typeof json.encryptedKey !== 'string') return null
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(json.encryptedKey, 'base64')) || null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Impossible de lire la clé SteamGridDB chiffrée.', { cause: error })
  }
}

export async function saveSteamGridDbKey(apiKey: string): Promise<void> {
  if (!/^[A-Za-z0-9]{16,64}$/.test(apiKey)) throw new Error('La clé d’API SteamGridDB est invalide.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Le chiffrement sécurisé du système est indisponible. La clé SteamGridDB n’a pas été enregistrée.')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
  await writeFile(steamGridDbKeyPath(), JSON.stringify({ encryptedKey }), { mode: 0o600 })
}

export async function clearSteamGridDbKey(): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  try {
    await unlink(steamGridDbKeyPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function readDeepLKey(): Promise<string | null> {
  try {
    const json = JSON.parse(await readFile(deepLKeyPath(), 'utf8')) as { encryptedKey?: unknown }
    if (typeof json.encryptedKey !== 'string') return null
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(json.encryptedKey, 'base64')) || null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Impossible de lire la clé DeepL chiffrée.', { cause: error })
  }
}

export async function saveDeepLKey(apiKey: string): Promise<void> {
  if (!/^[A-Za-z0-9-]{20,64}(?::fx)?$/.test(apiKey)) throw new Error('La clé d’API DeepL est invalide.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Le chiffrement sécurisé du système est indisponible. La clé DeepL n’a pas été enregistrée.')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
  await writeFile(deepLKeyPath(), JSON.stringify({ encryptedKey }), { mode: 0o600 })
}

export async function clearDeepLKey(): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  try {
    await unlink(deepLKeyPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function saveSteamCredentials(steamId: string, apiKey: string): Promise<void> {
  if (!/^\d{17}$/.test(steamId)) throw new Error('L’identifiant Steam doit contenir 17 chiffres.')
  if (!/^[A-Fa-f0-9]{32}$/.test(apiKey)) throw new Error('La clé Steam Web API doit contenir 32 caractères hexadécimaux.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Le chiffrement sécurisé du système est indisponible. Les identifiants n’ont pas été enregistrés.')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
  await writeFile(credentialPath(), JSON.stringify({ steamId, encryptedKey }), { mode: 0o600 })
}

export async function clearSteamCredentials(): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  try {
    await unlink(credentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
