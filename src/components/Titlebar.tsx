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
      <div className="titlebar-brand"><span className="brand-mark" aria-hidden="true">N</span><span>Nexora</span></div>
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
        <button aria-label="Réduire" onClick={() => window.nexora.window.minimize()}><Minus size={15} /></button>
        <button aria-label="Agrandir" onClick={() => window.nexora.window.toggleMaximize()}><Square size={12} /></button>
        <button aria-label="Fermer" className="window-close" onClick={() => window.nexora.window.close()}><X size={16} /></button>
      </div>
    </header>
  )
}
