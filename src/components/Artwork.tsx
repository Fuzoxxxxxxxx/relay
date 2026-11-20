import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { loadArtwork } from '../lib/artworkCache'
import { initials, textHue } from '../lib/format'
import { toArtworkPlatform } from '../lib/platforms'
import type { ArtworkKind, GameRecord } from '../shared/types'

/** fill : image plein cadre · wide : paysage affiché en entier sur un fond flouté · icon : petite icône centrée. */
type Layout = 'fill' | 'wide' | 'icon'

interface ArtworkProps {
  game: Pick<GameRecord, 'platform' | 'externalId' | 'title'>
  kind: ArtworkKind
  alt: string
  className?: string
  /** Incrémenté pour forcer le rechargement après une actualisation. */
  version?: number
}

function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || visible) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '320px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, visible])
  return visible
}

export function Artwork({ game, kind, alt, className = '', version = 0 }: ArtworkProps) {
  const element = useRef<HTMLDivElement>(null)
  const visible = useVisible(element)
  const artworkPlatform = toArtworkPlatform(game.platform)
  const requestKey = `${game.platform}:${game.externalId}:${game.title}:${kind}:${version}`
  const [result, setResult] = useState<{ key: string; url: string | null }>({ key: '', url: null })
  const [layout, setLayout] = useState<{ key: string; value: Layout }>({ key: '', value: 'fill' })
  const [brokenKey, setBrokenKey] = useState('')

  useEffect(() => {
    if (!visible) return
    if (!artworkPlatform) {
      setResult({ key: requestKey, url: null })
      return
    }
    let cancelled = false
    loadArtwork(artworkPlatform, game.externalId, game.title, kind)
      .then((url) => {
        if (!cancelled) setResult({ key: requestKey, url })
      })
      .catch(() => {
        if (!cancelled) setResult({ key: requestKey, url: null })
      })
    return () => {
      cancelled = true
    }
  }, [artworkPlatform, game.externalId, game.title, kind, requestKey, visible])

  const ready = result.key === requestKey
  const url = ready && brokenKey !== requestKey ? result.url : null
  const layoutValue = layout.key === requestKey ? layout.value : 'fill'

  return (
    <div
      ref={element}
      className={`art art-${kind} ${className}`}
      data-layout={layoutValue}
      style={{ '--hue': textHue(game.title) } as CSSProperties}
    >
      {url && layoutValue === 'wide' && (
        <div className="art-backdrop" style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />
      )}
      {url ? (
        <img
          className="art-image"
          src={url}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            let value: Layout = 'fill'
            if (kind === 'cover' && naturalWidth > 0 && naturalHeight > 0) {
              const ratio = naturalWidth / naturalHeight
              if (Math.max(naturalWidth, naturalHeight) <= 256 && ratio > 0.75 && ratio < 1.35) value = 'icon'
              else if (ratio > 0.92) value = 'wide'
            }
            setLayout({ key: requestKey, value })
          }}
          onError={() => setBrokenKey(requestKey)}
        />
      ) : (
        <div className="art-fallback" aria-hidden="true"><span>{initials(game.title)}</span></div>
      )}
      {visible && !ready && <div className="art-skeleton" aria-hidden="true" />}
    </div>
  )
}
