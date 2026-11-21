import { Minus, Search, Square, X } from 'lucide-react'
import type { RefObject } from 'react'

interface TitlebarProps {
  search: string
  searchRef: RefObject<HTMLInputElement | null>
  onSearch: (value: string) => void
}

export function Titlebar({ search, searchRef, onSearch }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none">
            <defs>
              <linearGradient id="relay-titlebar-mark" x1="4" y1="4" x2="43" y2="44" gradientUnits="userSpaceOnUse">
                <stop stopColor="#B9F36B" />
                <stop offset="1" stopColor="#7F70FF" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="44" height="44" rx="14" fill="#121713" />
            <path d="M14 36V12h11a7 7 0 0 1 0 14H14m11 0 10 10" stroke="url(#relay-titlebar-mark)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>Relay</span>
      </div>
      <label className="titlebar-search">
        <Search size={15} />
        <input
          ref={searchRef}
          type="search"
          value={search}
          placeholder="Rechercher un jeu, un genre, une plateforme…"
          aria-label="Rechercher un jeu"
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search) {
              event.stopPropagation()
              onSearch('')
            }
          }}
        />
        {search ? <button aria-label="Effacer la recherche" onClick={() => onSearch('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}
      </label>
      <div className="titlebar-drag" />
      <div className="window-controls">
        <button aria-label="Réduire" onClick={() => window.relay.window.minimize()}><Minus size={15} /></button>
        <button aria-label="Agrandir" onClick={() => window.relay.window.toggleMaximize()}><Square size={12} /></button>
        <button aria-label="Fermer" className="window-close" onClick={() => window.relay.window.close()}><X size={16} /></button>
      </div>
    </header>
  )
}
