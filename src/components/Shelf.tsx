import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ShelfProps {
  title: string
  subtitle?: string
  onSeeAll?: () => void
  children: ReactNode
}

/** Rangée horizontale défilante (accueil). */
export function Shelf({ title, subtitle, onSeeAll, children }: ShelfProps) {
  const track = useRef<HTMLDivElement>(null)
  const [canPrevious, setCanPrevious] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const update = useCallback(() => {
    const element = track.current
    if (!element) return
    setCanPrevious(element.scrollLeft > 4)
    setCanNext(element.scrollLeft + element.clientWidth < element.scrollWidth - 4)
  }, [])

  useEffect(() => {
    update()
    const element = track.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [update, children])

  function scroll(direction: -1 | 1): void {
    const element = track.current
    element?.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <section className="shelf">
      <header className="shelf-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="shelf-tools">
          {onSeeAll && <button className="link-btn" onClick={onSeeAll}>Tout voir</button>}
          <button className="icon-btn" aria-label="Précédent" disabled={!canPrevious} onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
          <button className="icon-btn" aria-label="Suivant" disabled={!canNext} onClick={() => scroll(1)}><ChevronRight size={18} /></button>
        </div>
      </header>
      <div ref={track} className="shelf-track" onScroll={update}>{children}</div>
    </section>
  )
}
