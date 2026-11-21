import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, Play, X } from 'lucide-react'
import type { GameMedia, MediaSourceId } from '../shared/types'
import './MediaGallery.css'

interface MediaGalleryProps {
  gameId: string
  /** Change quand la correspondance ou les images du jeu changent : la galerie se recharge. */
  version: number
  onError: (message: string) => void
}

const sourceNames: Record<MediaSourceId, string> = { steam: 'Steam', igdb: 'IGDB', egdata: 'Epic Games (egdata)' }

/** Charge une image par identifiant (le processus principal la télécharge : la CSP interdit les images distantes). */
function useMediaImage(gameId: string, id: string, size: 'thumb' | 'full', enabled = true): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: '', url: null, failed: false })
  const key = `${gameId}:${id}:${size}`
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    window.relay.media.image(gameId, id, size)
      .then((url) => { if (!cancelled) setState({ key, url, failed: url === null }) })
      .catch(() => { if (!cancelled) setState({ key, url: null, failed: true }) })
    return () => { cancelled = true }
  }, [gameId, id, size, enabled, key])
  return state.key === key ? { url: state.url, failed: state.failed } : { url: null, failed: false }
}

function Thumb({ gameId, id, label, video, onClick }: {
  gameId: string
  id: string
  label: string
  video: boolean
  onClick: () => void
}) {
  const { url, failed } = useMediaImage(gameId, id, 'thumb')
  return (
    <button type="button" className={`mg-thumb${video ? ' is-video' : ''}`} onClick={onClick} aria-label={label} title={label}>
      {url ? <img src={url} alt="" draggable={false} /> : failed ? <ImageOff size={20} /> : <span className="mg-skeleton" />}
      {video && <span className="mg-play"><Play size={18} fill="currentColor" /></span>}
    </button>
  )
}

function Lightbox({ gameId, media, index, onIndex, onClose }: {
  gameId: string
  media: GameMedia
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const shot = media.screenshots[index]
  const count = media.screenshots.length
  const { url, failed } = useMediaImage(gameId, shot?.id ?? '', 'full', Boolean(shot))
  const previous = useCallback(() => onIndex((index - 1 + count) % count), [count, index, onIndex])
  const next = useCallback(() => onIndex((index + 1) % count), [count, index, onIndex])

  useEffect(() => {
    // Phase de capture : la touche Échap ne doit fermer que la visionneuse, pas la fiche du jeu.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') previous()
      else if (event.key === 'ArrowRight') next()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, previous, next])

  if (!shot) return null

  return (
    <div className="mg-lightbox" role="dialog" aria-modal="true" aria-label="Capture d’écran" onClick={onClose}>
      <button type="button" className="mg-close" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
      {count > 1 && (
        <button type="button" className="mg-nav mg-prev" onClick={(event) => { event.stopPropagation(); previous() }} aria-label="Image précédente">
          <ChevronLeft size={26} />
        </button>
      )}
      <figure className="mg-figure" onClick={(event) => event.stopPropagation()}>
        {url ? <img src={url} alt={`Capture ${index + 1} sur ${count}`} /> : failed ? <div className="mg-fail"><ImageOff size={28} /><span>Image indisponible</span></div> : <span className="mg-spinner" />}
        <figcaption>{index + 1} / {count} · {sourceNames[shot.source]}</figcaption>
      </figure>
      {count > 1 && (
        <button type="button" className="mg-nav mg-next" onClick={(event) => { event.stopPropagation(); next() }} aria-label="Image suivante">
          <ChevronRight size={26} />
        </button>
      )}
    </div>
  )
}

/** Captures d'écran (Steam, IGDB, egdata) et bandes-annonces. Les vidéos s'ouvrent dans le navigateur. */
export function MediaGallery({ gameId, version, onError }: MediaGalleryProps) {
  const [loaded, setLoaded] = useState<{ key: string; media: GameMedia } | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const key = `${gameId}:${version}`

  useEffect(() => {
    let cancelled = false
    setOpenIndex(null)
    window.relay.media.list(gameId)
      .then((media) => { if (!cancelled) setLoaded({ key, media }) })
      .catch(() => { if (!cancelled) setLoaded({ key, media: { screenshots: [], videos: [] } }) })
    return () => { cancelled = true }
  }, [gameId, key])

  const media = loaded?.key === key ? loaded.media : null
  if (!media || (media.screenshots.length === 0 && media.videos.length === 0)) return null

  function playVideo(id: string): void {
    window.relay.media.openVideo(gameId, id).catch(() => onError('La vidéo n’a pas pu être ouverte.'))
  }

  return (
    <section className="mg" aria-label="Médias">
      <h3 className="mg-title">Médias</h3>
      {media.videos.length > 0 && (
        <>
          <h4 className="mg-sub">Bandes-annonces</h4>
          <div className="mg-row">
            {media.videos.map((video) => (
              <Thumb key={video.id} gameId={gameId} id={video.id} video label={`Regarder : ${video.title} (${sourceNames[video.source]})`} onClick={() => playVideo(video.id)} />
            ))}
          </div>
          <p className="mg-note">Les vidéos s’ouvrent dans votre navigateur.</p>
        </>
      )}
      {media.screenshots.length > 0 && (
        <>
          <h4 className="mg-sub">Captures d’écran</h4>
          <div className="mg-row">
            {media.screenshots.map((shot, index) => (
              <Thumb key={shot.id} gameId={gameId} id={shot.id} video={false} label={`Capture ${index + 1} (${sourceNames[shot.source]})`} onClick={() => setOpenIndex(index)} />
            ))}
          </div>
        </>
      )}
      {openIndex !== null && media.screenshots[openIndex] && (
        <Lightbox gameId={gameId} media={media} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </section>
  )
}
