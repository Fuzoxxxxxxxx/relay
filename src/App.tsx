import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowDownUp,
  Check,
  CircleHelp,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Grid2X2,
  Info,
  List,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Upload,
  X,
} from 'lucide-react'
import './App.css'
import { Artwork } from './components/Artwork'
import { ContextMenu } from './components/ContextMenu'
import type { MenuItem } from './components/ContextMenu'
import { GameCard } from './components/GameCard'
import { GamePage } from './components/GamePage'
import { SettingsPage } from './components/SettingsPage'
import { Shelf } from './components/Shelf'
import { Sidebar } from './components/Sidebar'
import type { AppView } from './components/Sidebar'
import { Titlebar } from './components/Titlebar'
import { UpdateBanner } from './components/UpdateBanner'
import { clearArtworkCache, invalidateArtwork } from './lib/artworkCache'
import { formatRelative, plural } from './lib/format'
import { isLaunchable, platformLabel, platformLogos, platforms, toArtworkPlatform } from './lib/platforms'
import type {
  AppSettings,
  CustomArtworkKind,
  GameDetails,
  GameRecord,
  LibraryFilter,
  PlatformId,
  PlatformStatus,
  RecentGame,
  SortMode,
  SyncProgress,
  SyncResult,
  UpdatableSettings,
} from './shared/types'

const pageStep = 60

const initialSettings: AppSettings = {
  viewMode: 'grid',
  cardSize: 176,
  sortMode: 'lastPlayed',
  launchAtStartup: false,
  density: 'comfortable',
  motion: 'system',
  steamId: '',
  hasSteamApiKey: false,
  hasIgdbCredentials: false,
  hasSteamGridDbKey: false,
  hasDeepLKey: false,
  cacheDirectory: '',
}

const filterTitles: Record<LibraryFilter, string> = {
  all: 'Tous les jeux',
  favorites: 'Favoris',
  recent: 'Récemment joués',
  installed: 'Installés',
  'not-installed': 'Non installés',
  hidden: 'Masqués',
}

const filterPills: LibraryFilter[] = ['all', 'installed', 'not-installed', 'favorites', 'recent', 'hidden']

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function excerpt(text: string | null | undefined, maxLength: number): string {
  if (!text) return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength).replace(/\s+\S*$/, '')}…`
}

export default function App() {
  const [games, setGames] = useState<GameRecord[]>([])
  const [recents, setRecents] = useState<RecentGame[]>([])
  const [settings, setSettings] = useState<AppSettings>(initialSettings)
  const [view, setView] = useState<AppView>('home')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [platform, setPlatform] = useState<PlatformId | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(pageStep)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [syncSummary, setSyncSummary] = useState<SyncResult | null>(null)
  const [platformStatuses, setPlatformStatuses] = useState<PlatformStatus[]>([])
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [menu, setMenu] = useState<{ game: GameRecord; x: number; y: number } | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    danger: boolean
    onConfirm: () => Promise<boolean>
  } | null>(null)
  const [artVersions, setArtVersions] = useState<Record<string, number>>({})
  const [globalArtVersion, setGlobalArtVersion] = useState(0)
  const [featuredDetails, setFeaturedDetails] = useState<GameDetails | null>(null)

  const searchInput = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  /* ---------- Chargement initial ---------- */

  useEffect(() => {
    let active = true
    const unsubscribe = window.relay.library.onSyncProgress((progress) => {
      if (active) setSyncProgress(progress)
    })
    Promise.all([window.relay.library.list(), window.relay.library.recents(), window.relay.settings.get()])
      .then(([loadedGames, loadedRecents, loadedSettings]) => {
        if (!active) return
        setGames(loadedGames)
        setRecents(loadedRecents)
        setSettings(loadedSettings)
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageOf(loadError, 'Les données locales n’ont pas pu être chargées.'))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  /* Densité et animations : appliquées sur <html>, le CSS fait le reste. */
  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = settings.density
    const systemQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyMotion = (): void => {
      const reduced = settings.motion === 'reduced' || (settings.motion === 'system' && systemQuery.matches)
      root.dataset.motion = reduced ? 'reduced' : 'full'
    }
    applyMotion()
    systemQuery.addEventListener('change', applyMotion)
    return () => systemQuery.removeEventListener('change', applyMotion)
  }, [settings.density, settings.motion])

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [selectedId, view])

  /* ---------- Données dérivées ---------- */

  const gameMap = useMemo(() => new Map(games.map((game) => [game.id, game])), [games])
  const selectedGame = selectedId ? gameMap.get(selectedId) ?? null : null

  const counts = useMemo<Record<LibraryFilter, number>>(() => {
    const visible = games.filter((game) => !game.hidden)
    return {
      all: visible.length,
      favorites: visible.filter((game) => game.favorite).length,
      recent: visible.filter((game) => game.lastPlayedAt).length,
      installed: visible.filter((game) => game.installed).length,
      'not-installed': visible.filter((game) => !game.installed).length,
      hidden: games.length - visible.length,
    }
  }, [games])

  const platformCounts = useMemo(() => {
    const result = new Map<PlatformId, number>()
    for (const game of games) {
      if (!game.hidden) result.set(game.platform, (result.get(game.platform) ?? 0) + 1)
    }
    return result
  }, [games])

  const visibleGames = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr')
    const sortMode: SortMode = filter === 'recent' ? 'lastPlayed' : settings.sortMode
    const filtered = games.filter((game) => {
      if (filter === 'hidden' ? !game.hidden : game.hidden) return false
      if (platform && game.platform !== platform) return false
      if (filter === 'favorites' && !game.favorite) return false
      if (filter === 'recent' && !game.lastPlayedAt) return false
      if (filter === 'installed' && !game.installed) return false
      if (filter === 'not-installed' && game.installed) return false
      if (query) {
        const haystack = `${game.title} ${game.originalTitle} ${game.platformLabel} ${game.developer ?? ''}`.toLocaleLowerCase('fr')
        if (!haystack.includes(query)) return false
      }
      return true
    })
    return filtered.sort((first, second) => {
      const byTitle = first.title.localeCompare(second.title, 'fr')
      if (sortMode === 'title') return byTitle
      if (sortMode === 'added') return second.addedAt.localeCompare(first.addedAt) || byTitle
      if (sortMode === 'playCount') return second.launchCount - first.launchCount || byTitle
      return (second.lastPlayedAt ?? '').localeCompare(first.lastPlayedAt ?? '') || byTitle
    })
  }, [filter, games, platform, search, settings.sortMode])

  const currentGames = visibleGames.slice(0, visibleCount)

  const recentEntries = useMemo(() => recents.flatMap((entry) => {
    const game = gameMap.get(entry.id)
    return game && !game.hidden ? [{ game, launchedAt: entry.launchedAt }] : []
  }), [recents, gameMap])

  const shelves = useMemo(() => {
    const visible = games.filter((game) => !game.hidden)
    return {
      favorites: visible.filter((game) => game.favorite).slice(0, 24),
      added: [...visible].sort((first, second) => second.addedAt.localeCompare(first.addedAt)).slice(0, 24),
      mostPlayed: visible.filter((game) => game.launchCount > 0).sort((first, second) => second.launchCount - first.launchCount).slice(0, 24),
    }
  }, [games])

  const featured = recentEntries[0]?.game ?? games.find((game) => !game.hidden && game.installed) ?? games.find((game) => !game.hidden) ?? null
  const ambientGame = selectedGame ?? (view === 'home' ? featured : null)
  const statusOf = (id: PlatformId) => platformStatuses.find((status) => status.id === id)
  const versionOf = (game: GameRecord) => globalArtVersion * 1000 + (artVersions[game.id] ?? 0)
  const featuredId = featured?.id ?? null
  const featuredVersion = featured ? versionOf(featured) : 0
  const emptyLibrary = games.length === 0

  useEffect(() => {
    if (!featuredId) {
      setFeaturedDetails(null)
      return
    }
    let cancelled = false
    window.relay.metadata.get(featuredId)
      .then((details) => {
        if (!cancelled) setFeaturedDetails(details)
      })
      .catch(() => {
        if (!cancelled) setFeaturedDetails(null)
      })
    return () => {
      cancelled = true
    }
  }, [featuredId, featuredVersion])

  /* ---------- Défilement infini ---------- */

  useEffect(() => {
    const element = sentinel.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => count + pageStep)
    }, { rootMargin: '700px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visibleGames.length, visibleCount, view, selectedId])

  /* ---------- Mises à jour locales ---------- */

  function replaceGame(updated: GameRecord): void {
    setGames((current) => current.map((game) => game.id === updated.id ? updated : game))
  }

  async function reloadLibrary(): Promise<void> {
    const [loadedGames, loadedRecents] = await Promise.all([
      window.relay.library.list(),
      window.relay.library.recents(),
    ])
    setGames(loadedGames)
    setRecents(loadedRecents)
  }

  function bumpArtwork(ids: string[]): void {
    setArtVersions((current) => {
      const next = { ...current }
      for (const id of ids) next[id] = (next[id] ?? 0) + 1
      return next
    })
  }

  function resetAllArtwork(): void {
    clearArtworkCache()
    setGlobalArtVersion((version) => version + 1)
  }

  function artworkChanged(game: GameRecord): void {
    const artworkPlatform = toArtworkPlatform(game.platform)
    if (artworkPlatform) invalidateArtwork(artworkPlatform, game.externalId)
    bumpArtwork([game.id])
  }

  async function runAction(action: () => Promise<void>, fallbackError: string): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (actionError) {
      setError(messageOf(actionError, fallbackError))
      return false
    } finally {
      setBusy(false)
    }
  }

  /* ---------- Actions sur la bibliothèque ---------- */

  async function syncLibrary(): Promise<void> {
    setSyncing(true)
    setError('')
    setSyncSummary(null)
    setSyncProgress({ stage: 'Préparation de la synchronisation', completed: 0, total: 5 })
    try {
      const result = await window.relay.library.sync()
      await reloadLibrary()
      setSyncSummary(result)
      setPlatformStatuses(result.platforms)
      if (result.errors.length > 0) setError(result.errors.join(' '))
      else if (!result.platforms.find((item) => item.id === 'steam')?.detected) setToast('Steam n’a pas été détecté')
      else setToast(`${result.added} ajouté(s) · ${result.updated} actualisé(s)`)
    } catch (syncError) {
      setError(messageOf(syncError, 'La synchronisation a échoué.'))
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  async function toggleFavorite(game: GameRecord): Promise<void> {
    try {
      replaceGame(await window.relay.library.toggleFavorite(game.id))
    } catch (favoriteError) {
      setError(messageOf(favoriteError, 'Le favori n’a pas pu être enregistré.'))
    }
  }

  async function launch(game: GameRecord): Promise<void> {
    if (!isLaunchable(game.platform)) return
    setLaunchingId(game.id)
    setError('')
    try {
      await window.relay.library.launch(game.id)
      await reloadLibrary()
      setToast(game.installed
        ? `Lancement de ${game.title} transmis à ${game.platformLabel}`
        : `Ouverture de l’installation de ${game.title} via ${game.platformLabel}`)
    } catch (launchError) {
      setError(messageOf(launchError, 'Le jeu n’a pas pu être lancé.'))
    } finally {
      setLaunchingId(null)
    }
  }

  function toggleHidden(game: GameRecord): Promise<boolean> {
    return runAction(async () => {
      const updated = await window.relay.library.setHidden(game.id, !game.hidden)
      replaceGame(updated)
      setToast(updated.hidden ? `${updated.title} est masqué (filtre « Masqués »)` : `${updated.title} est de nouveau visible`)
    }, 'Le jeu n’a pas pu être masqué.')
  }

  function renameGame(game: GameRecord, title: string | null): Promise<boolean> {
    return runAction(async () => {
      const updated = await window.relay.library.rename(game.id, title)
      artworkChanged(updated)
      replaceGame(updated)
      setToast(title === null ? 'Nom d’origine rétabli' : `Jeu renommé en « ${updated.title} »`)
    }, 'Le jeu n’a pas pu être renommé.')
  }

  function openFolder(game: GameRecord): Promise<boolean> {
    return runAction(() => window.relay.library.openFolder(game.id), 'Le dossier n’a pas pu être ouvert.')
  }

  function uninstall(game: GameRecord): Promise<boolean> {
    return runAction(async () => {
      await window.relay.library.uninstall(game.id)
      setToast('Désinstallation proposée dans Steam')
    }, 'La désinstallation n’a pas pu être demandée.')
  }

  function confirmUninstall(game: GameRecord): void {
    setConfirmation({
      title: 'Désinstaller ce jeu ?',
      message: `Steam ouvrira sa confirmation de désinstallation pour « ${game.title} ». Les fichiers seront supprimés uniquement si vous confirmez dans Steam.`,
      confirmLabel: 'Continuer',
      cancelLabel: 'Annuler',
      danger: true,
      onConfirm: () => uninstall(game),
    })
  }

  function removeLocal(game: GameRecord): Promise<boolean> {
    return runAction(async () => {
      const removed = await window.relay.library.removeLocalGame(game.id)
      if (!removed) return
      await reloadLibrary()
      setSelectedId(null)
      setToast(`${game.title} retiré de Relay`)
    }, 'Le jeu local n’a pas pu être retiré de la bibliothèque.')
  }

  function confirmRemoveLocal(game: GameRecord): void {
    setConfirmation({
      title: 'Retirer ce jeu de Relay ?',
      message: `« ${game.title} » sera retiré de votre bibliothèque locale. Ses fichiers sur l’ordinateur ne seront pas supprimés.`,
      confirmLabel: 'Retirer',
      cancelLabel: 'Annuler',
      danger: true,
      onConfirm: () => removeLocal(game),
    })
  }

  function chooseArtwork(game: GameRecord, kind: CustomArtworkKind): Promise<boolean> {
    return runAction(async () => {
      const artworkPlatform = toArtworkPlatform(game.platform)
      if (!artworkPlatform) return
      const chosen = await window.relay.artwork.chooseCustom(artworkPlatform, game.externalId, kind)
      if (!chosen) return
      artworkChanged(game)
      setToast(kind === 'cover' ? 'Jaquette personnalisée enregistrée' : 'Bannière personnalisée enregistrée')
    }, 'L’image n’a pas pu être enregistrée.')
  }

  function clearArtwork(game: GameRecord): Promise<boolean> {
    return runAction(async () => {
      const artworkPlatform = toArtworkPlatform(game.platform)
      if (!artworkPlatform) return
      await window.relay.artwork.clearCustom(artworkPlatform, game.externalId)
      artworkChanged(game)
      setToast('Images personnalisées retirées')
    }, 'Les images personnalisées n’ont pas pu être retirées.')
  }

  function refreshArtwork(game: GameRecord): Promise<boolean> {
    return runAction(async () => {
      const artworkPlatform = toArtworkPlatform(game.platform)
      if (!artworkPlatform) return
      await window.relay.artwork.refresh(artworkPlatform, game.externalId, game.title)
      artworkChanged(game)
      setToast('Recherche d’images relancée')
    }, 'Actualisation impossible.')
  }

  /* ---------- Ajout de jeux locaux ---------- */

  async function importLocalGames(paths?: string[]): Promise<void> {
    if (importing) return
    setImporting(true)
    setError('')
    try {
      const { games: imported, created, errors } = await window.relay.library.importLocalExecutables(paths)
      if (imported.length > 0) {
        await reloadLibrary()
        setView('library')
        setPlatform('local')
        setFilter('all')
        setSearch('')
        setVisibleCount(pageStep)
        setSelectedId(imported.length === 1 ? imported[0].id : null)
        if (created === 0) setToast(imported.length === 1 ? `${imported[0].title} est déjà dans vos jeux locaux` : 'Ces jeux sont déjà dans vos jeux locaux')
        else setToast(imported.length === 1 ? `${imported[0].title} ajouté aux jeux locaux` : `${created} jeux ajoutés aux jeux locaux`)
      }
      if (errors.length > 0) setError(errors.join(' '))
    } catch (importError) {
      setError(messageOf(importError, 'Le jeu local n’a pas pu être ajouté.'))
    } finally {
      setImporting(false)
    }
  }

  function handleDroppedFiles(files: FileList): void {
    const executables: string[] = []
    for (const file of Array.from(files)) {
      if (!file.name.toLocaleLowerCase('fr').endsWith('.exe')) continue
      const filePath = window.relay.library.getDroppedFilePath(file)
      if (filePath) executables.push(filePath)
    }
    if (executables.length === 0) {
      setError('Déposez un ou plusieurs fichiers .exe (le programme qui lance le jeu).')
      return
    }
    void importLocalGames(executables)
  }

  const dropHandler = useRef(handleDroppedFiles)
  useEffect(() => {
    dropHandler.current = handleDroppedFiles
  })

  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth += 1
      setDragActive(true)
    }
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragActive(false)
      if (event.dataTransfer?.files.length) dropHandler.current(event.dataTransfer.files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  /* ---------- Raccourcis et navigation ---------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      } else if (event.key === 'Escape' && confirmation) {
        event.preventDefault()
        setConfirmation(null)
      } else if (event.key === 'Escape' && selectedId) {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmation, selectedId])

  async function updateSetting<K extends keyof UpdatableSettings>(key: K, value: UpdatableSettings[K]): Promise<void> {
    try {
      setSettings(await window.relay.settings.update({ [key]: value }))
    } catch (settingsError) {
      setError(messageOf(settingsError, 'Le paramètre n’a pas pu être enregistré.'))
    }
  }

  function goHome(): void {
    setSelectedId(null)
    setSearch('')
    setView('home')
  }

  function goLibrary(next: LibraryFilter): void {
    setSelectedId(null)
    setPlatform(null)
    setFilter(next)
    setView('library')
    setVisibleCount(pageStep)
  }

  function choosePlatform(next: PlatformId | null): void {
    setPlatform(next)
    setVisibleCount(pageStep)
  }

  function changeSearch(value: string): void {
    setSearch(value)
    setVisibleCount(pageStep)
    if (value.trim()) {
      setSelectedId(null)
      setView('library')
    }
  }

  const closeMenu = useCallback(() => setMenu(null), [])

  function menuItems(game: GameRecord): MenuItem[] {
    const items: MenuItem[] = []
    if (isLaunchable(game.platform)) {
      items.push({ id: 'launch', label: game.installed ? 'Jouer' : 'Installer', icon: game.installed ? Play : Download, onSelect: () => void launch(game) })
    }
    items.push({ id: 'favorite', label: game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: Star, onSelect: () => void toggleFavorite(game) })
    items.push({ id: 'details', label: 'Ouvrir la fiche', icon: Info, onSelect: () => setSelectedId(game.id) })
    items.push({ id: 'hide', label: game.hidden ? 'Afficher dans la bibliothèque' : 'Masquer de la bibliothèque', icon: game.hidden ? Eye : EyeOff, dividerBefore: true, onSelect: () => void toggleHidden(game) })
    if (game.installed && game.installPath) {
      items.push({ id: 'folder', label: 'Ouvrir le dossier', icon: FolderOpen, onSelect: () => void openFolder(game) })
    }
    if (toArtworkPlatform(game.platform)) {
      items.push({ id: 'art', label: 'Actualiser images et infos', icon: RefreshCw, onSelect: () => void refreshArtwork(game) })
    }
    return items
  }

  const poster = (game: GameRecord, variant: 'poster' | 'wide' = 'poster') => (
    <GameCard
      key={`${variant}-${game.id}`}
      game={game}
      view="grid"
      variant={variant}
      version={versionOf(game)}
      launching={launchingId === game.id}
      onOpen={(opened) => setSelectedId(opened.id)}
      onFavorite={(target) => void toggleFavorite(target)}
      onLaunch={(target) => void launch(target)}
      onMenu={(target, x, y) => setMenu({ game: target, x, y })}
    />
  )

  const featuredText = excerpt(featuredDetails?.summary ?? featuredDetails?.description, 260)
  const pageTitle = platform ? platformLabel(platform) : filterTitles[filter]

  /* ---------- Rendu ---------- */

  return (
    <div className="app">
      <Titlebar search={search} searchRef={searchInput} onSearch={changeSearch} />

      <div className="body">
        <Sidebar
          view={view}
          filter={filter}
          adding={importing}
          onHome={goHome}
          onLibrary={goLibrary}
          onAdd={() => void importLocalGames()}
          onSettings={() => { setSelectedId(null); setView('settings') }}
        />

        <main className="main">
          {ambientGame && (
            <div className="ambient" aria-hidden="true">
              <Artwork key={ambientGame.id} game={ambientGame} kind="hero" alt="" version={versionOf(ambientGame)} />
            </div>
          )}

          <div className="scroll" ref={scroller}>
            <UpdateBanner onError={setError} />
            {syncProgress && (
              <div className="banner banner-progress" role="status">
                <div><LoaderCircle size={15} className="spin" /><span>{syncProgress.stage}</span><strong>{syncProgress.completed}/{syncProgress.total}</strong></div>
                <div className="progress"><span style={{ width: `${Math.min(100, syncProgress.completed / syncProgress.total * 100)}%` }} /></div>
              </div>
            )}
            {error && (
              <div className="banner banner-error" role="alert">
                <CircleHelp size={16} /><span>{error}</span>
                <button aria-label="Fermer le message" onClick={() => setError('')}><X size={15} /></button>
              </div>
            )}
            {syncSummary && !error && (
              <div className="banner banner-ok">
                <Check size={16} /><span>Synchronisation terminée : {syncSummary.added} ajouté(s), {syncSummary.updated} actualisé(s), {syncSummary.installed} installé(s).</span>
                <button aria-label="Fermer le message" onClick={() => setSyncSummary(null)}><X size={15} /></button>
              </div>
            )}

            {selectedGame ? (
              <GamePage
                key={selectedGame.id}
                game={selectedGame}
                version={versionOf(selectedGame)}
                launching={launchingId === selectedGame.id}
                busy={busy}
                onBack={() => setSelectedId(null)}
                onLaunch={() => void launch(selectedGame)}
                onFavorite={() => void toggleFavorite(selectedGame)}
                onToggleHidden={() => void toggleHidden(selectedGame)}
                onRename={(title) => renameGame(selectedGame, title)}
                onOpenFolder={() => void openFolder(selectedGame)}
                onUninstall={() => confirmUninstall(selectedGame)}
                onRemove={() => confirmRemoveLocal(selectedGame)}
                onChooseArtwork={(kind) => void chooseArtwork(selectedGame, kind)}
                onClearArtwork={() => void clearArtwork(selectedGame)}
                onArtworkChanged={() => artworkChanged(selectedGame)}
                onToast={setToast}
                onError={setError}
              />
            ) : view === 'settings' ? (
              <SettingsPage
                settings={settings}
                onSettingsChange={setSettings}
                onUpdateSetting={updateSetting}
                onToast={setToast}
                onError={setError}
                onArtworkReset={resetAllArtwork}
              />
            ) : view === 'home' ? (
              <section className="page home">
                {emptyLibrary ? (
                  <section className="welcome">
                    <div className="welcome-copy">
                      <span className="eyebrow">Bienvenue sur Relay</span>
                      <h1>Tous vos jeux, au même endroit.</h1>
                      <p>Importez les jeux installés depuis Steam, Epic Games et Riot Games, ou ajoutez n’importe quel programme .exe. Chaque jeu reçoit sa vraie description et ses bonnes images, sans rien deviner.</p>
                      <div className="welcome-actions">
                        <button className="btn btn-primary btn-lg" disabled={syncing} onClick={() => void syncLibrary()}>
                          {syncing ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={16} />}Détecter mes jeux
                        </button>
                        <button className="btn btn-lg" disabled={importing} onClick={() => void importLocalGames()}><Plus size={16} />Ajouter des .exe</button>
                      </div>
                      <p className="welcome-note"><ShieldCheck size={14} />Lecture locale uniquement · aucun mot de passe requis</p>
                    </div>
                    <div className="welcome-status">
                      {(['steam', 'epic', 'riot'] as const).map((id) => {
                        const status = statusOf(id)
                        return (
                          <div key={id}>
                            <span className="nav-logo"><img src={platformLogos[id]} alt="" /></span>
                            <span><strong>{platformLabel(id)}</strong><small>{status?.note ?? 'À détecter lors de la synchronisation'}</small></span>
                            <span className={`dot${status?.detected ? ' is-on' : ''}`} />
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ) : (
                  <>
                    {featured && (
                      <section className="hero">
                        <Artwork game={featured} kind="hero" alt="" className="hero-art" version={featuredVersion} />
                        <div className="hero-shade" />
                        <div className="hero-content">
                          <span className="hero-kicker">{recentEntries.length > 0 ? 'Reprendre' : 'À la une'} · {featured.platformLabel}</span>
                          <h1>{featured.title}</h1>
                          {featuredDetails?.genres.length ? <p className="hero-genres">{featuredDetails.genres.slice(0, 4).join(' · ')}</p> : null}
                          {featuredText && <p className="hero-text">{featuredText}</p>}
                          <div className="hero-actions">
                            {isLaunchable(featured.platform) && (
                              <button className="btn btn-primary btn-lg" disabled={launchingId === featured.id} onClick={() => void launch(featured)}>
                                {launchingId === featured.id ? <LoaderCircle size={17} className="spin" /> : featured.installed ? <Play size={17} fill="currentColor" /> : <Download size={17} />}
                                {featured.installed ? 'Jouer' : 'Installer'}
                              </button>
                            )}
                            <button className="btn btn-lg btn-glass" onClick={() => setSelectedId(featured.id)}><Info size={16} />Voir la fiche</button>
                          </div>
                          {featured.lastPlayedAt && <span className="hero-foot">Dernier lancement : {formatRelative(featured.lastPlayedAt).toLocaleLowerCase('fr')}</span>}
                        </div>
                      </section>
                    )}

                    {recentEntries.length > 0 && (
                      <Shelf title="Reprendre" subtitle="Vos derniers lancements" onSeeAll={() => goLibrary('recent')}>
                        {recentEntries.slice(0, 14).map(({ game }) => poster(game, 'wide'))}
                      </Shelf>
                    )}
                    {shelves.favorites.length > 0 && (
                      <Shelf title="Favoris" onSeeAll={() => goLibrary('favorites')}>{shelves.favorites.map((game) => poster(game))}</Shelf>
                    )}
                    {shelves.mostPlayed.length > 0 && (
                      <Shelf title="Les plus lancés">{shelves.mostPlayed.map((game) => poster(game))}</Shelf>
                    )}
                    <Shelf title="Ajoutés récemment" onSeeAll={() => goLibrary('all')}>{shelves.added.map((game) => poster(game))}</Shelf>
                  </>
                )}
              </section>
            ) : (
              <section className="page">
                <header className="page-head">
                  <div>
                    <p className="eyebrow">{search.trim() ? 'Recherche' : platform ? 'Plateforme' : 'Bibliothèque'}</p>
                    <h1>{search.trim() ? `« ${search.trim()} »` : pageTitle}</h1>
                    <p className="page-sub">{plural(visibleGames.length, 'jeu', 'jeux')}{platform || filter !== 'all' ? ` · ${plural(counts.all, 'jeu', 'jeux')} au total` : ''}</p>
                  </div>
                  <button className="btn btn-primary" disabled={syncing} onClick={() => void syncLibrary()}>
                    {syncing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{syncing ? 'Synchronisation…' : 'Synchroniser'}
                  </button>
                </header>

                <div className="filters">
                  <div className="pills" role="group" aria-label="Filtrer par état">
                    {filterPills.map((id) => (
                      <button key={id} className={`pill${filter === id ? ' is-on' : ''}`} aria-pressed={filter === id} onClick={() => { setFilter(id); setVisibleCount(pageStep) }}>
                        {filterTitles[id]}<span>{counts[id]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="pills" role="group" aria-label="Filtrer par plateforme">
                    <button className={`pill${platform === null ? ' is-on' : ''}`} aria-pressed={platform === null} onClick={() => choosePlatform(null)}>Toutes</button>
                    {platforms.filter((item) => item.supported).map(({ id, label }) => (
                      <button key={id} className={`pill${platform === id ? ' is-on' : ''}`} aria-pressed={platform === id} onClick={() => choosePlatform(platform === id ? null : id)}>
                        <img src={platformLogos[id]} alt="" />{label}<span>{platformCounts.get(id) ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {platform === 'local' && (
                  <section className="dropzone">
                    <span className="dropzone-icon"><Upload size={22} /></span>
                    <div>
                      <strong>Ajoutez vos jeux locaux</strong>
                      <span>Glissez un ou plusieurs fichiers .exe n’importe où dans la fenêtre. Relay cherche le jeu par nom exact ; vous pourrez corriger la correspondance depuis sa fiche.</span>
                    </div>
                    <button className="btn" disabled={importing} onClick={() => void importLocalGames()}>
                      {importing ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}Choisir des .exe
                    </button>
                  </section>
                )}

                {!emptyLibrary && (
                  <div className="toolbar">
                    <span className="count">{visibleGames.length} résultat{visibleGames.length > 1 ? 's' : ''}</span>
                    <div className="toolbar-tools">
                      <label className="select-wrap">
                        <ArrowDownUp size={14} />
                        <select
                          value={filter === 'recent' ? 'lastPlayed' : settings.sortMode}
                          disabled={filter === 'recent'}
                          aria-label="Trier les jeux"
                          onChange={(event) => void updateSetting('sortMode', event.target.value as SortMode)}
                        >
                          <option value="lastPlayed">Dernière utilisation</option>
                          <option value="playCount">Plus lancés</option>
                          <option value="title">Nom du jeu</option>
                          <option value="added">Date d’ajout</option>
                        </select>
                      </label>
                      <div className="segmented" role="group" aria-label="Mode d’affichage">
                        <button aria-label="Vue en grille" aria-pressed={settings.viewMode === 'grid'} className={settings.viewMode === 'grid' ? 'is-on' : ''} onClick={() => void updateSetting('viewMode', 'grid')}><Grid2X2 size={16} /></button>
                        <button aria-label="Vue en liste" aria-pressed={settings.viewMode === 'list'} className={settings.viewMode === 'list' ? 'is-on' : ''} onClick={() => void updateSetting('viewMode', 'list')}><List size={17} /></button>
                      </div>
                      {settings.viewMode === 'grid' && (
                        <input className="size-slider" type="range" min="120" max="256" step="8" value={settings.cardSize} aria-label="Taille des jaquettes" onChange={(event) => void updateSetting('cardSize', Number(event.target.value))} />
                      )}
                    </div>
                  </div>
                )}

                {currentGames.length > 0 ? (
                  <>
                    {settings.viewMode === 'list' && (
                      <div className="list-head" aria-hidden="true">
                        <span>Jeu</span><span>Plateforme</span><span>État</span><span>Dernier lancement</span><span>Lancements</span><span />
                      </div>
                    )}
                    <div className={`games ${settings.viewMode === 'list' ? 'games-list' : 'games-grid'}`} style={{ '--card-size': `${settings.cardSize}px` } as CSSProperties}>
                      {currentGames.map((game) => (
                        <GameCard
                          key={game.id}
                          game={game}
                          view={settings.viewMode}
                          version={versionOf(game)}
                          launching={launchingId === game.id}
                          onOpen={(opened) => setSelectedId(opened.id)}
                          onFavorite={(target) => void toggleFavorite(target)}
                          onLaunch={(target) => void launch(target)}
                          onMenu={(target, x, y) => setMenu({ game: target, x, y })}
                        />
                      ))}
                    </div>
                    {visibleGames.length > visibleCount && <div ref={sentinel} className="sentinel"><LoaderCircle size={16} className="spin" /></div>}
                  </>
                ) : (
                  <div className="empty">
                    <span className="empty-icon">{search.trim() ? <Search size={22} /> : filter === 'favorites' ? <Star size={22} /> : filter === 'hidden' ? <EyeOff size={22} /> : <Gamepad2 size={22} />}</span>
                    <h3>{search.trim() ? 'Aucun résultat' : filter === 'hidden' ? 'Aucun jeu masqué' : filter === 'favorites' ? 'Aucun favori' : 'Cette vue est vide'}</h3>
                    <p>
                      {search.trim()
                        ? `Aucun jeu ne correspond à « ${search.trim()} ».`
                        : filter === 'hidden'
                          ? 'Les jeux que vous masquez depuis leur fiche apparaissent ici.'
                          : filter === 'favorites'
                            ? 'Cliquez sur l’étoile d’un jeu pour le retrouver ici.'
                            : emptyLibrary
                              ? 'Synchronisez vos launchers ou ajoutez un .exe depuis l’accueil.'
                              : 'Essayez un autre filtre ou une autre plateforme.'}
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.game)} onClose={closeMenu} />}

      {dragActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div><Upload size={30} /><strong>Déposez le .exe du jeu pour l’ajouter</strong><span>Plusieurs fichiers possibles</span></div>
        </div>
      )}

      {confirmation && (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={() => setConfirmation(null)}
        >
          <section
            className="modal confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-message"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2 id="confirmation-title">{confirmation.title}</h2>
                <p id="confirmation-message">{confirmation.message}</p>
              </div>
            </div>
            <div className="confirmation-actions">
              <button className="btn" disabled={busy} onClick={() => setConfirmation(null)}>
                {confirmation.cancelLabel}
              </button>
              <button
                className={`btn${confirmation.danger ? ' btn-danger' : ' btn-primary'}`}
                disabled={busy}
                onClick={() => {
                  void confirmation.onConfirm().then((success) => {
                    if (success) setConfirmation(null)
                  })
                }}
              >
                {busy ? <LoaderCircle size={15} className="spin" /> : null}
                {confirmation.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </div>
  )
}
