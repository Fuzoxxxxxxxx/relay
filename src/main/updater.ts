import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'

const FIRST_CHECK_DELAY_MS = 20_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type Listener = (state: UpdateState) => void

function friendlyError(error: Error): string {
  const text = `${(error as NodeJS.ErrnoException).code ?? ''} ${error.message}`
  if (/ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|net::/i.test(text)) {
    return 'Impossible de joindre le serveur de mises à jour. Vérifiez votre connexion.'
  }
  if (/404|Cannot find latest|No published versions/i.test(text)) {
    return 'Aucune version publiée n’a été trouvée.'
  }
  return 'La recherche de mise à jour a échoué.'
}

/**
 * Mises à jour automatiques (installeur NSIS + GitHub Releases).
 * Vérifie au démarrage puis toutes les 4 h, télécharge en arrière-plan et installe
 * à la fermeture de l'application (ou immédiatement sur demande de l'utilisateur).
 * Inactif tant que l'application n'est pas installée (mode développement).
 */
export class UpdateService {
  private state: UpdateState
  private readonly listeners = new Set<Listener>()
  private started = false

  constructor() {
    this.state = {
      status: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      version: null,
      percent: 0,
      error: null,
      checkedAt: null,
    }
    if (!app.isPackaged) return

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false

    autoUpdater.on('checking-for-update', () => {
      if (this.state.status !== 'downloaded') this.set({ status: 'checking', error: null })
    })
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.set({ status: 'downloading', version: info.version, percent: 0, error: null })
    })
    autoUpdater.on('update-not-available', () => {
      this.set({ status: 'up-to-date', version: null, percent: 0, checkedAt: new Date().toISOString() })
    })
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.set({ status: 'downloading', percent: Math.min(100, Math.round(progress.percent)) })
    })
    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.set({ status: 'downloaded', version: event.version, percent: 100, error: null, checkedAt: new Date().toISOString() })
    })
    autoUpdater.on('error', (error: Error) => {
      console.error('Relay — erreur de mise à jour :', error)
      // Une mise à jour déjà téléchargée reste installable malgré une erreur réseau ultérieure.
      if (this.state.status === 'downloaded') return
      this.set({ status: 'error', error: friendlyError(error) })
    })
  }

  getState(): UpdateState {
    return this.state
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Première vérification peu après le démarrage, puis une toutes les 4 h. */
  start(): void {
    if (this.started || this.state.status === 'disabled') return
    this.started = true
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS).unref()
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref()
  }

  async check(): Promise<UpdateState> {
    const busy = this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'downloaded'
    if (this.state.status === 'disabled' || busy) return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // L'événement « error » a déjà mis l'état à jour.
    }
    return this.state
  }

  install(): void {
    if (this.state.status !== 'downloaded') throw new Error('Aucune mise à jour prête à être installée.')
    // setImmediate laisse partir la réponse IPC avant la fermeture des fenêtres.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
}
