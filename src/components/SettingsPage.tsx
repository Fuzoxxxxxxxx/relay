import { useEffect, useState } from 'react'
import { Check, FolderOpen, Image as ImageIcon, KeyRound, LoaderCircle, Monitor, RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { AppSettings, Density, MotionMode, SortMode, UpdatableSettings, ViewMode } from '../shared/types'
import { UpdatePanel } from './UpdatePanel'

interface SettingsPageProps {
  settings: AppSettings
  onSettingsChange: (next: AppSettings) => void
  onUpdateSetting: <K extends keyof UpdatableSettings>(key: K, value: UpdatableSettings[K]) => Promise<void>
  onToast: (message: string) => void
  onError: (message: string) => void
  /** Vide le cache d'images de l'interface et force leur rechargement. */
  onArtworkReset: () => void
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function SettingsPage({ settings, onSettingsChange, onUpdateSetting, onToast, onError, onArtworkReset }: SettingsPageProps) {
  const [steamId, setSteamId] = useState(settings.steamId)
  const [apiKey, setApiKey] = useState('')
  const [igdbClientId, setIgdbClientId] = useState('')
  const [igdbSecret, setIgdbSecret] = useState('')
  const [savingSteam, setSavingSteam] = useState(false)
  const [savingIgdb, setSavingIgdb] = useState(false)
  const [sgdbKey, setSgdbKey] = useState('')
  const [savingSgdb, setSavingSgdb] = useState(false)
  const [deepLKey, setDeepLKey] = useState('')
  const [savingDeepL, setSavingDeepL] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setSteamId(settings.steamId)
  }, [settings.steamId])

  async function saveSteam(): Promise<void> {
    setSavingSteam(true)
    try {
      onSettingsChange(await window.nexora.settings.saveSteamCredentials(steamId.trim(), apiKey.trim()))
      setApiKey('')
      onToast('Accès Steam Web API enregistré de manière chiffrée')
    } catch (error) {
      onError(messageOf(error, 'Les identifiants Steam n’ont pas pu être enregistrés.'))
    } finally {
      setSavingSteam(false)
    }
  }

  async function clearSteam(): Promise<void> {
    try {
      onSettingsChange(await window.nexora.settings.clearSteamCredentials())
      setApiKey('')
      onToast('Identifiants Steam supprimés')
    } catch (error) {
      onError(messageOf(error, 'Les identifiants Steam n’ont pas pu être supprimés.'))
    }
  }

  async function saveIgdb(): Promise<void> {
    setSavingIgdb(true)
    try {
      onSettingsChange(await window.nexora.settings.saveIgdbCredentials(igdbClientId.trim(), igdbSecret.trim()))
      setIgdbSecret('')
      onArtworkReset()
      onToast('Identifiants IGDB vérifiés et enregistrés de manière chiffrée')
    } catch (error) {
      onError(messageOf(error, 'Les identifiants IGDB n’ont pas pu être vérifiés.'))
    } finally {
      setSavingIgdb(false)
    }
  }

  async function clearIgdb(): Promise<void> {
    try {
      onSettingsChange(await window.nexora.settings.clearIgdbCredentials())
      setIgdbSecret('')
      onArtworkReset()
      onToast('Identifiants IGDB supprimés')
    } catch (error) {
      onError(messageOf(error, 'Les identifiants IGDB n’ont pas pu être supprimés.'))
    }
  }

  async function saveSteamGridDb(): Promise<void> {
    setSavingSgdb(true)
    try {
      onSettingsChange(await window.nexora.settings.saveSteamGridDbKey(sgdbKey.trim()))
      setSgdbKey('')
      onArtworkReset()
      onToast('Clé SteamGridDB vérifiée et enregistrée de manière chiffrée')
    } catch (error) {
      onError(messageOf(error, 'La clé SteamGridDB n’a pas pu être vérifiée.'))
    } finally {
      setSavingSgdb(false)
    }
  }

  async function clearSteamGridDb(): Promise<void> {
    try {
      onSettingsChange(await window.nexora.settings.clearSteamGridDbKey())
      setSgdbKey('')
      onArtworkReset()
      onToast('Clé SteamGridDB supprimée')
    } catch (error) {
      onError(messageOf(error, 'La clé SteamGridDB n’a pas pu être supprimée.'))
    }
  }

  async function saveDeepL(): Promise<void> {
    setSavingDeepL(true)
    try {
      onSettingsChange(await window.nexora.settings.saveDeepLKey(deepLKey.trim()))
      setDeepLKey('')
      onToast('Clé DeepL vérifiée et enregistrée de manière chiffrée')
    } catch (error) {
      onError(messageOf(error, 'La clé DeepL n’a pas pu être vérifiée.'))
    } finally {
      setSavingDeepL(false)
    }
  }

  async function clearDeepL(): Promise<void> {
    try {
      onSettingsChange(await window.nexora.settings.clearDeepLKey())
      setDeepLKey('')
      onToast('Clé DeepL supprimée')
    } catch (error) {
      onError(messageOf(error, 'La clé DeepL n’a pas pu être supprimée.'))
    }
  }

  async function chooseCacheDirectory(): Promise<void> {
    try {
      onSettingsChange(await window.nexora.settings.chooseCacheDirectory())
      onToast('Dossier de cache mis à jour')
    } catch (error) {
      onError(messageOf(error, 'Le dossier de cache n’a pas pu être modifié.'))
    }
  }

  async function refreshAllArtwork(): Promise<void> {
    setRefreshing(true)
    try {
      const count = await window.nexora.artwork.refreshAll()
      onArtworkReset()
      onToast(`Illustrations réinitialisées pour ${count} jeu${count > 1 ? 'x' : ''} (vos images personnalisées sont conservées)`)
    } catch (error) {
      onError(messageOf(error, 'Les illustrations n’ont pas pu être actualisées.'))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="page settings-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Personnalisation</p>
          <h1>Paramètres</h1>
          <p className="page-sub">Ajustez l’affichage, les illustrations et les comptes connectés.</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head"><span className="panel-icon"><SlidersHorizontal size={18} /></span><div><h2>Interface</h2><p>Affichage de la bibliothèque</p></div></div>
          <div className="setting">
            <div><strong>Taille des jaquettes</strong><small>Densité de la grille</small></div>
            <div className="setting-control">
              <input type="range" min="120" max="256" step="8" value={settings.cardSize} aria-label="Taille des jaquettes" onChange={(event) => void onUpdateSetting('cardSize', Number(event.target.value))} />
              <output>{settings.cardSize}px</output>
            </div>
          </div>
          <div className="setting">
            <div><strong>Densité de l’interface</strong><small>Espacement des cartes, des listes et des panneaux</small></div>
            <select className="select" value={settings.density} aria-label="Densité de l’interface" onChange={(event) => void onUpdateSetting('density', event.target.value as Density)}>
              <option value="compact">Compacte</option>
              <option value="comfortable">Confortable</option>
              <option value="spacious">Spacieuse</option>
            </select>
          </div>
          <div className="setting">
            <div><strong>Animations</strong><small>Transitions de page et apparition des cartes. « Selon le système » suit le réglage de Windows.</small></div>
            <select className="select" value={settings.motion} aria-label="Animations" onChange={(event) => void onUpdateSetting('motion', event.target.value as MotionMode)}>
              <option value="system">Selon le système</option>
              <option value="full">Activées</option>
              <option value="reduced">Réduites</option>
            </select>
          </div>
          <div className="setting">
            <div><strong>Vue par défaut</strong><small>Grille visuelle ou liste détaillée</small></div>
            <select className="select" value={settings.viewMode} aria-label="Vue par défaut" onChange={(event) => void onUpdateSetting('viewMode', event.target.value as ViewMode)}>
              <option value="grid">Grille</option>
              <option value="list">Liste</option>
            </select>
          </div>
          <div className="setting">
            <div><strong>Tri par défaut</strong><small>Ordre d’affichage des jeux</small></div>
            <select className="select" value={settings.sortMode} aria-label="Tri par défaut" onChange={(event) => void onUpdateSetting('sortMode', event.target.value as SortMode)}>
              <option value="lastPlayed">Dernière utilisation</option>
              <option value="playCount">Plus lancés</option>
              <option value="title">Nom du jeu</option>
              <option value="added">Date d’ajout</option>
            </select>
          </div>
          <div className="setting">
            <div><strong>Lancer au démarrage</strong><small>Ouvrir Nexora avec Windows</small></div>
            <button
              className="switch"
              role="switch"
              aria-checked={settings.launchAtStartup}
              aria-label="Lancer Nexora au démarrage de Windows"
              onClick={() => void onUpdateSetting('launchAtStartup', !settings.launchAtStartup)}
            ><span /></button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><span className="panel-icon"><ImageIcon size={18} /></span><div><h2>Illustrations</h2><p>Cache et actualisation des images</p></div></div>
          <div className="cache-box">
            <span>Dossier de cache</span>
            <code>{settings.cacheDirectory || 'Chargement…'}</code>
            <button className="btn" onClick={() => void chooseCacheDirectory()}><FolderOpen size={15} />Choisir un dossier</button>
          </div>
          <div className="setting">
            <div><strong>Actualiser toutes les illustrations</strong><small>Relance la recherche d’images pour chaque jeu. Vos images personnalisées sont conservées.</small></div>
            <button className="btn" disabled={refreshing} onClick={() => void refreshAllArtwork()}>
              {refreshing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Actualiser
            </button>
          </div>
          <p className="panel-note">Les images sont téléchargées à la demande, au fil du défilement, sans bloquer le démarrage. Depuis la fiche d’un jeu, vous pouvez aussi choisir votre propre jaquette ou bannière.</p>
        </section>

        <section className="panel">
          <div className="panel-head"><span className="panel-icon steam"><Monitor size={18} /></span><div><h2>Steam</h2><p>Import des jeux possédés via l’API officielle</p></div></div>
          <div className="notice"><ShieldCheck size={16} /><span>La clé API est chiffrée avec le stockage sécurisé de Windows et n’est jamais exposée à l’interface.</span></div>
          <label className="field"><span>Steam ID 64</span><input value={steamId} onChange={(event) => setSteamId(event.target.value)} inputMode="numeric" placeholder="7656119… (17 chiffres)" maxLength={17} /></label>
          <label className="field"><span>Clé Steam Web API</span><input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" autoComplete="new-password" placeholder={settings.hasSteamApiKey ? 'Clé enregistrée — saisir pour remplacer' : '32 caractères hexadécimaux'} maxLength={32} /></label>
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={savingSteam || !steamId || !apiKey} onClick={() => void saveSteam()}>
              {savingSteam ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{settings.hasSteamApiKey ? 'Mettre à jour' : 'Enregistrer'}
            </button>
            {settings.hasSteamApiKey && <button className="btn" onClick={() => void clearSteam()}>Supprimer la clé</button>}
          </div>
          <p className="panel-note">Créez une clé sur steamcommunity.com/dev/apikey. Un profil privé ne permet pas l’import des jeux possédés.</p>
        </section>

        <section className="panel">
          <div className="panel-head"><span className="panel-icon igdb"><KeyRound size={18} /></span><div><h2>IGDB</h2><p>Correspondance, description et images (jeux locaux, Epic, Riot…)</p></div></div>
          <div className="notice"><ShieldCheck size={16} /><span>Le Client Secret est vérifié auprès de Twitch avant d’être chiffré localement.</span></div>
          <label className="field"><span>Client ID Twitch</span><input value={igdbClientId} onChange={(event) => setIgdbClientId(event.target.value)} autoComplete="off" placeholder="Client ID de votre application Twitch" maxLength={128} /></label>
          <label className="field"><span>Client Secret Twitch</span><input value={igdbSecret} onChange={(event) => setIgdbSecret(event.target.value)} type="password" autoComplete="new-password" placeholder={settings.hasIgdbCredentials ? 'Secret enregistré — saisir pour remplacer' : 'Client Secret de votre application Twitch'} maxLength={128} /></label>
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={savingIgdb || !igdbClientId || !igdbSecret} onClick={() => void saveIgdb()}>
              {savingIgdb ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{settings.hasIgdbCredentials ? 'Vérifier et remplacer' : 'Vérifier et enregistrer'}
            </button>
            {settings.hasIgdbCredentials && <button className="btn" onClick={() => void clearIgdb()}>Supprimer les identifiants</button>}
          </div>
          <p className="panel-note">Créez une application de type Confidential sur dev.twitch.tv/console/apps (redirection : localhost). L’API IGDB est gratuite pour un usage non commercial.</p>
        </section>

        <section className="panel">
          <div className="panel-head"><span className="panel-icon sgdb"><ImageIcon size={18} /></span><div><h2>SteamGridDB</h2><p>Jaquettes et bannières de la communauté</p></div></div>
          <div className="notice"><ShieldCheck size={16} /><span>La clé est vérifiée puis chiffrée avec le stockage sécurisé de Windows. Nexora n’accepte que des images sans contenu adulte ni humoristique.</span></div>
          <label className="field"><span>Clé d’API SteamGridDB</span><input value={sgdbKey} onChange={(event) => setSgdbKey(event.target.value)} type="password" autoComplete="new-password" placeholder={settings.hasSteamGridDbKey ? 'Clé enregistrée — saisir pour remplacer' : 'Clé de votre profil SteamGridDB'} maxLength={64} /></label>
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={savingSgdb || !sgdbKey} onClick={() => void saveSteamGridDb()}>
              {savingSgdb ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{settings.hasSteamGridDbKey ? 'Vérifier et remplacer' : 'Vérifier et enregistrer'}
            </button>
            {settings.hasSteamGridDbKey && <button className="btn" onClick={() => void clearSteamGridDb()}>Supprimer la clé</button>}
          </div>
          <p className="panel-note">Clé gratuite dans votre profil sur steamgriddb.com (Préférences → API). Elle sert de source d’images pour les jeux Steam, Riot et locaux (jamais pour les jeux Epic, qui n’utilisent qu’egdata).</p>
        </section>

        <section className="panel">
          <div className="panel-head"><span className="panel-icon igdb"><KeyRound size={18} /></span><div><h2>DeepL</h2><p>Traduction française des descriptions</p></div></div>
          <div className="notice"><ShieldCheck size={16} /><span>Les descriptions egdata et IGDB sont en anglais : elles sont traduites une seule fois puis conservées sur le disque. Sans clé, seules les descriptions déjà en français (Steam) s’affichent.</span></div>
          <label className="field"><span>Clé d’API DeepL</span><input value={deepLKey} onChange={(event) => setDeepLKey(event.target.value)} type="password" autoComplete="new-password" placeholder={settings.hasDeepLKey ? 'Clé enregistrée — saisir pour remplacer' : 'Clé DeepL API Free (se termine par :fx)'} maxLength={80} /></label>
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={savingDeepL || !deepLKey} onClick={() => void saveDeepL()}>
              {savingDeepL ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{settings.hasDeepLKey ? 'Vérifier et remplacer' : 'Vérifier et enregistrer'}
            </button>
            {settings.hasDeepLKey && <button className="btn" onClick={() => void clearDeepL()}>Supprimer la clé</button>}
          </div>
          <p className="panel-note">Clé gratuite (500 000 caractères par mois) sur deepl.com/pro-api.</p>
        </section>

        <UpdatePanel onToast={onToast} onError={onError} />
      </div>

      <section className="panel integrations">
        <h2>Comment Nexora trouve images et descriptions</h2>
        <p>Chaque plateforme a ses propres sources. <strong>Steam</strong> : identifiant officiel (visuels de la bibliothèque Steam, description française du magasin), puis <strong>SteamGridDB</strong> et <strong>IGDB</strong> en complément. <strong>Epic</strong> : namespace identifié via <strong>egdata</strong> uniquement (images et description). <strong>Riot</strong> : visuel officiel, puis <strong>egdata</strong>, puis IGDB / SteamGridDB. <strong>Jeux locaux</strong> : IGDB, Steam et SteamGridDB par nom identique. Si rien n’est sûr, rien n’est deviné et vous pouvez choisir le bon jeu depuis sa fiche. Toutes les descriptions sont affichées en français (traduction DeepL si besoin).</p>
      </section>
    </section>
  )
}
