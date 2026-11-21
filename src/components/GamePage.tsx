import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CircleCheck,
  CircleHelp,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  ImageOff,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Artwork } from './Artwork'
import { MatchPicker } from './MatchPicker'
import { MediaGallery } from './MediaGallery'
import { formatBytes, formatDate, formatRelative } from '../lib/format'
import { isLaunchable, platformLogos, toArtworkPlatform } from '../lib/platforms'
import type { CustomArtworkKind, GameDetails, GameMatch, GameRecord, MatchCandidate } from '../shared/types'

interface GamePageProps {
  game: GameRecord
  version: number
  launching: boolean
  busy: boolean
  onBack: () => void
  onLaunch: () => void
  onFavorite: () => void
  onToggleHidden: () => void
  /** Renvoie true si le renommage a réussi. `null` rétablit le nom d'origine. */
  onRename: (title: string | null) => Promise<boolean>
  onOpenFolder: () => void
  onUninstall: () => void
  onRemove: () => void
  onChooseArtwork: (kind: CustomArtworkKind) => void
  onClearArtwork: () => void
  /** Appelé après toute action qui change les images (actualisation, choix d'une correspondance). */
  onArtworkChanged: () => void
  onToast: (message: string) => void
  onError: (message: string) => void
}

const sourceNames = { steam: 'Steam', igdb: 'IGDB', epic: 'le catalogue Epic Games (egdata)' } as const

function describeMatch(match: GameMatch): { tone: 'ok' | 'warn' | 'none'; title: string; text: string } {
  if (match.status === 'none') {
    return {
      tone: 'none',
      title: 'Aucune correspondance fiable',
      text: 'Relay ne devine pas : sans nom identique ou identifiant certain, aucune image ni description n’est associée. Choisissez le bon jeu pour corriger.',
    }
  }
  if (match.status === 'matched') {
    return {
      tone: 'warn',
      title: 'Trouvé automatiquement',
      text: `Correspondance par nom exact${match.source && match.source !== 'manual' ? ` via ${sourceNames[match.source]}` : ''}. Si les images ne sont pas les bonnes, corrigez-la.`,
    }
  }
  if (match.source === 'manual') return { tone: 'ok', title: 'Choisi par vous', text: 'Cette correspondance reste fixée même après une actualisation.' }
  if (match.source === 'epic') return { tone: 'ok', title: 'Identifié avec certitude', text: 'Jeu reconnu grâce à l’identifiant Epic de son installation.' }
  return { tone: 'ok', title: 'Identifié avec certitude', text: 'Identifiant Steam du jeu connu.' }
}

export function GamePage({
  game,
  version,
  launching,
  busy,
  onBack,
  onLaunch,
  onFavorite,
  onToggleHidden,
  onRename,
  onOpenFolder,
  onUninstall,
  onRemove,
  onChooseArtwork,
  onClearArtwork,
  onArtworkChanged,
  onToast,
  onError,
}: GamePageProps) {
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [detailsError, setDetailsError] = useState('')
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [picker, setPicker] = useState(false)
  const [working, setWorking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(game.title)
  const [saving, setSaving] = useState(false)
  const [installSize, setInstallSize] = useState<{ id: string; bytes: number | null } | null>(null)

  const launchable = isLaunchable(game.platform)
  const canEditArtwork = toArtworkPlatform(game.platform) !== null
  const canCorrectMatch = canEditArtwork && game.platform !== 'steam'
  const renamed = game.title !== game.originalTitle

  useEffect(() => {
    let cancelled = false
    setLoadingDetails(true)
    setDetailsError('')
    window.relay.metadata.get(game.id)
      .then((loaded) => {
        if (!cancelled) setDetails(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setDetailsError(loadError instanceof Error ? loadError.message : 'Les informations du jeu n’ont pas pu être chargées.')
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false)
      })
    return () => {
      cancelled = true
    }
  }, [game.id, game.title, version])

  /* Taille du dossier d'installation : calculé en arrière-plan par le processus principal (mis en cache quelques minutes). */
  useEffect(() => {
    if (!game.installed || !game.installPath) return
    let cancelled = false
    window.relay.library.installSize(game.id)
      .then((bytes) => {
        if (!cancelled) setInstallSize({ id: game.id, bytes })
      })
      .catch(() => {
        if (!cancelled) setInstallSize({ id: game.id, bytes: null })
      })
    return () => {
      cancelled = true
    }
  }, [game.id, game.installed, game.installPath])

  async function runMetadataAction(action: () => Promise<GameDetails>, success: string): Promise<void> {
    setWorking(true)
    try {
      setDetails(await action())
      onArtworkChanged()
      onToast(success)
    } catch (actionError) {
      onError(actionError instanceof Error ? actionError.message : 'L’action a échoué.')
    } finally {
      setWorking(false)
    }
  }

  function chooseMatch(candidate: MatchCandidate): void {
    setPicker(false)
    void runMetadataAction(
      () => window.relay.metadata.setMatch(game.id, candidate.source, candidate.id, candidate.name),
      `Correspondance : « ${candidate.name} »`,
    )
  }

  async function submitRename(): Promise<void> {
    const next = draft.trim()
    if (!next) return
    setSaving(true)
    try {
      if (await onRename(next === game.originalTitle ? null : next)) setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function openSteamDb(): Promise<void> {
    try {
      await window.relay.library.openSteamDb(game.id)
    } catch (openError) {
      onError(openError instanceof Error ? openError.message : 'SteamDB n’a pas pu être ouvert.')
    }
  }

  const matchInfo = details ? describeMatch(details.match) : null
  const paragraphs = details?.description ? details.description.split(/\n{2,}/).filter((part) => part.trim()) : []
  const longText = (details?.description?.length ?? 0) > 700
  const sizeLabel = installSize?.id !== game.id ? 'Calcul en cours…' : installSize.bytes === null ? 'Indisponible' : formatBytes(installSize.bytes)
  const rows: Array<[string, string]> = [
    ['Plateforme', game.platformLabel],
    ['État', game.installed ? 'Installé' : 'Non installé'],
    ...(game.installed && game.installPath ? [['Taille sur le disque', sizeLabel] as [string, string]] : []),
    ['Dernier lancement', game.lastPlayedAt ? formatRelative(game.lastPlayedAt) : 'Jamais'],
    ['Lancements via Relay', String(game.launchCount)],
    ['Ajouté le', formatDate(game.addedAt)],
  ]
  if (details?.releaseDate) rows.push(['Sortie', details.releaseDate])
  const developers = details?.developers.length ? details.developers : game.developer ? [game.developer] : []
  const publishers = details?.publishers.length ? details.publishers : game.publisher ? [game.publisher] : []
  if (developers.length) rows.push(['Développeur', developers.join(', ')])
  if (publishers.length) rows.push(['Éditeur', publishers.join(', ')])
  if (renamed) rows.push(['Nom d’origine', game.originalTitle])
  const disabled = busy || working

  return (
    <article className="gp">
      <header className="gp-hero">
        <Artwork game={game} kind="hero" alt="" className="gp-hero-art" version={version} />
        <div className="gp-hero-shade" />
        <button className="btn btn-glass gp-back" onClick={onBack}><ArrowLeft size={16} />Retour</button>
        <div className="gp-hero-body">
          <div className="gp-cover"><Artwork game={game} kind="cover" alt={`Jaquette de ${game.title}`} version={version} /></div>
          <div className="gp-heading">
            <div className="gp-tags">
              <span className="chip"><img src={platformLogos[game.platform]} alt="" />{game.platformLabel}</span>
              <span className={`chip${game.installed ? ' chip-ok' : ''}`}>{game.installed ? 'Installé' : 'Non installé'}</span>
              {details?.genres.slice(0, 4).map((genre) => <span key={genre} className="chip chip-soft">{genre}</span>)}
            </div>
            <h1>{game.title}</h1>
            <p className="gp-meta">
              {[developers.join(', '), details?.releaseDate].filter(Boolean).join(' · ') || (game.installed ? 'Installé sur cet ordinateur' : 'Dans votre bibliothèque')}
            </p>
            <div className="gp-actions">
              {launchable ? (
                <button className="btn btn-primary btn-lg" disabled={launching} onClick={onLaunch}>
                  {launching ? <LoaderCircle size={18} className="spin" /> : game.installed ? <Play size={18} fill="currentColor" /> : <Download size={18} />}
                  {game.installed ? 'Jouer' : `Installer via ${game.platformLabel}`}
                </button>
              ) : <span className="muted-note">Lancement indisponible pour cette plateforme.</span>}
              <button className={`btn btn-lg btn-glass${game.favorite ? ' is-on' : ''}`} aria-pressed={game.favorite} onClick={onFavorite}>
                <Star size={17} fill={game.favorite ? 'currentColor' : 'none'} />{game.favorite ? 'Dans les favoris' : 'Favori'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="gp-grid">
        <section className="gp-main">
          <h2>À propos du jeu</h2>
          {loadingDetails && !details && (
            <div className="skeleton-lines" aria-busy="true"><span /><span /><span /><span style={{ width: '60%' }} /></div>
          )}
          {detailsError && <p className="gp-empty is-error">{detailsError}</p>}
          {details && paragraphs.length > 0 && (
            <>
              {details.summary && details.description !== details.summary && <p className="gp-lead">{details.summary}</p>}
              <div className={`gp-text${longText && !expanded ? ' is-clamped' : ''}`}>
                {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </div>
              {longText && <button className="link-btn" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Réduire' : 'Lire la suite'}</button>}
              {details.descriptionSource && <p className="gp-source">Description : {details.descriptionSource === 'steam' ? 'Steam' : details.descriptionSource === 'epic' ? 'Epic Games Store (egdata)' : 'IGDB'}</p>}
            </>
          )}
          {details && paragraphs.length === 0 && (
            <p className="gp-empty">
              <CircleHelp size={18} />
              <span>
                {details.translationUnavailable
                  ? 'La description de ce jeu n’existe qu’en anglais et n’a pas pu être traduite. Ajoutez ou vérifiez votre clé DeepL dans Paramètres → DeepL (le quota mensuel est peut-être atteint), puis actualisez.'
                  : `Aucune description trouvée pour ce jeu. ${canCorrectMatch ? 'Utilisez « Corriger la correspondance » pour lier le bon jeu.' : 'Vérifiez votre connexion ou actualisez.'}`}
              </span>
            </p>
          )}
          {canEditArtwork && <MediaGallery gameId={game.id} version={version} onError={onError} />}
        </section>

        <aside className="gp-side">
          <section className="panel">
            <h3>Informations</h3>
            <dl className="info-list">
              {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              {game.installPath && <div className="info-path"><dt>Dossier</dt><dd><code>{game.installPath}</code></dd></div>}
            </dl>
          </section>

          {canEditArtwork && (
            <section className="panel">
              <h3>Correspondance et images</h3>
              {matchInfo ? (
                <div className={`match match-${matchInfo.tone}`}>
                  {matchInfo.tone === 'ok' ? <CircleCheck size={18} /> : matchInfo.tone === 'warn' ? <TriangleAlert size={18} /> : <CircleHelp size={18} />}
                  <div>
                    <strong>{matchInfo.title}{details?.match.name ? ` : ${details.match.name}` : ''}</strong>
                    <p>{matchInfo.text}</p>
                  </div>
                </div>
              ) : <p className="panel-note">{loadingDetails ? 'Recherche de la correspondance…' : 'Correspondance indisponible.'}</p>}
              <div className="action-grid">
                {canCorrectMatch && <button className="btn" disabled={disabled} onClick={() => setPicker(true)}><Search size={15} />Corriger la correspondance</button>}
                {details?.match.source === 'manual' && (
                  <button className="btn" disabled={disabled} onClick={() => void runMetadataAction(() => window.relay.metadata.clearMatch(game.id), 'Détection automatique rétablie')}><RefreshCw size={15} />Détection automatique</button>
                )}
                <button className="btn" disabled={disabled} onClick={() => void runMetadataAction(() => window.relay.metadata.refresh(game.id), 'Informations et images actualisées')}>
                  {working ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Actualiser
                </button>
                <button className="btn" disabled={disabled} onClick={() => onChooseArtwork('cover')}><ImagePlus size={15} />Ma jaquette…</button>
                <button className="btn" disabled={disabled} onClick={() => onChooseArtwork('hero')}><ImagePlus size={15} />Ma bannière…</button>
                <button className="btn" disabled={disabled} onClick={onClearArtwork}><ImageOff size={15} />Retirer mes images</button>
                {details?.match.steamAppId && <button className="btn" onClick={() => void openSteamDb()}><ExternalLink size={15} />SteamDB</button>}
              </div>
              <p className="panel-note">Sources d’images selon la plateforme : Steam (Steam, SteamGridDB, IGDB), Epic (egdata), Riot (visuel officiel, egdata, IGDB). Vos images personnalisées (JPEG, PNG, WebP, 8 Mo max) restent prioritaires.</p>
            </section>
          )}

          <section className="panel">
            <h3>Gestion</h3>
            {editing && (
              <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void submitRename() }}>
                <label htmlFor="rename-input">Nom affiché dans Relay</label>
                <div className="rename-row">
                  <input id="rename-input" autoFocus value={draft} maxLength={200} onChange={(event) => setDraft(event.target.value)} />
                  <button type="submit" className="btn btn-primary" disabled={saving || !draft.trim()}>{saving ? <LoaderCircle size={15} className="spin" /> : 'OK'}</button>
                  <button type="button" className="btn" disabled={saving} onClick={() => { setEditing(false); setDraft(game.title) }}>Annuler</button>
                </div>
              </form>
            )}
            <div className="action-grid">
              <button className="btn" disabled={disabled} onClick={() => { setDraft(game.title); setEditing(true) }}><Pencil size={15} />Renommer</button>
              {renamed && <button className="btn" disabled={disabled} onClick={() => void onRename(null)}><RefreshCw size={15} />Nom d’origine</button>}
              <button className="btn" disabled={disabled} onClick={onToggleHidden}>{game.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{game.hidden ? 'Afficher' : 'Masquer'}</button>
              <button className="btn" disabled={disabled || !game.installed || !game.installPath} onClick={onOpenFolder}><FolderOpen size={15} />Ouvrir le dossier</button>
              {game.platform === 'steam' && game.installed && <button className="btn btn-danger" disabled={disabled} onClick={onUninstall}><Trash2 size={15} />Désinstaller</button>}
              {game.platform === 'local' && <button className="btn btn-danger" disabled={disabled} onClick={onRemove}><Trash2 size={15} />Retirer de Relay</button>}
            </div>
          </section>
        </aside>
      </div>

      {picker && <MatchPicker gameId={game.id} initialQuery={game.originalTitle} onSelect={chooseMatch} onClose={() => setPicker(false)} />}
    </article>
  )
}
