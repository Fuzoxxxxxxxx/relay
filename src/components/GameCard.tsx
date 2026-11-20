import { Download, LoaderCircle, MoreHorizontal, Play, Star } from 'lucide-react'
import { Artwork } from './Artwork'
import { formatRelative } from '../lib/format'
import { isLaunchable, platformLogos } from '../lib/platforms'
import type { GameRecord, ViewMode } from '../shared/types'

interface GameCardProps {
  game: GameRecord
  view: ViewMode
  /** wide : vignette paysage (rangées de l'accueil). */
  variant?: 'poster' | 'wide'
  version: number
  launching: boolean
  onOpen: (game: GameRecord) => void
  onFavorite: (game: GameRecord) => void
  onLaunch: (game: GameRecord) => void
  onMenu: (game: GameRecord, x: number, y: number) => void
}

export function GameCard({ game, view, variant = 'poster', version, launching, onOpen, onFavorite, onLaunch, onMenu }: GameCardProps) {
  const launchable = isLaunchable(game.platform)
  const launchLabel = game.installed ? `Jouer à ${game.title}` : `Installer ${game.title}`
  const launchIcon = launching
    ? <LoaderCircle size={18} className="spin" />
    : game.installed ? <Play size={18} fill="currentColor" /> : <Download size={18} />

  return (
    <article
      className={`card${view === 'list' ? ' card-list' : ''}${variant === 'wide' ? ' card-wide' : ''}${game.hidden ? ' is-hidden' : ''}`}
      tabIndex={0}
      aria-label={`${game.title}, ${game.platformLabel}`}
      onClick={() => onOpen(game)}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(game, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(game)
        }
      }}
    >
      <div className="card-cover">
        <Artwork game={game} kind={variant === 'wide' ? 'hero' : 'cover'} alt={`Visuel de ${game.title}`} version={version} />
        <div className="card-scrim" />
        {!game.installed && <span className="card-flag">Non installé</span>}
        <button
          className={`card-fav${game.favorite ? ' is-on' : ''}`}
          aria-label={game.favorite ? `Retirer ${game.title} des favoris` : `Ajouter ${game.title} aux favoris`}
          aria-pressed={game.favorite}
          onClick={(event) => {
            event.stopPropagation()
            onFavorite(game)
          }}
        >
          <Star size={16} fill={game.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className="card-more"
          aria-label={`Plus d’actions pour ${game.title}`}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(game, rect.left, rect.bottom + 4)
          }}
        >
          <MoreHorizontal size={16} />
        </button>
        {launchable && (
          <button
            className="card-play"
            aria-label={launchLabel}
            disabled={launching}
            onClick={(event) => {
              event.stopPropagation()
              onLaunch(game)
            }}
          >
            {launchIcon}
          </button>
        )}
        <span className="card-platform" title={game.platformLabel}><img src={platformLogos[game.platform]} alt="" /></span>
      </div>

      <div className="card-meta">
        <strong title={game.title}>{game.title}</strong>
        <span>{game.lastPlayedAt ? `Joué · ${formatRelative(game.lastPlayedAt).toLocaleLowerCase('fr')}` : game.developer || game.platformLabel}</span>
      </div>

      {view === 'list' && (
        <>
          <span className="card-col card-col-platform"><img src={platformLogos[game.platform]} alt="" />{game.platformLabel}</span>
          <span className={`card-col card-col-state${game.installed ? ' is-installed' : ''}`}>{game.installed ? 'Installé' : 'Non installé'}</span>
          <span className="card-col card-col-played">{formatRelative(game.lastPlayedAt)}</span>
          <span className="card-col card-col-count">{game.launchCount}</span>
          <span className="card-actions">
            {launchable && (
              <button
                className="btn btn-sm"
                disabled={launching}
                onClick={(event) => {
                  event.stopPropagation()
                  onLaunch(game)
                }}
              >
                {game.installed ? 'Jouer' : 'Installer'}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label={`Plus d’actions pour ${game.title}`}
              onClick={(event) => {
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                onMenu(game, rect.left, rect.bottom + 4)
              }}
            >
              <MoreHorizontal size={17} />
            </button>
          </span>
        </>
      )}
    </article>
  )
}
